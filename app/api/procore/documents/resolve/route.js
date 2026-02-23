// app/api/procore/documents/resolve/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PATH_ROOT = ["09 Submittals", "00 Preparation", "01 AHA's"];
const PATH_TEMPLATE = [...PATH_ROOT, "01 AHA Template"];
const PATH_COMPLETED = [...PATH_ROOT, "02 Completed AHA's"];

function jsonError({ stage, status = 500, message, url = null, data = null }) {
  const safeStatus = Number.isFinite(status) ? status : 500;

  return NextResponse.json(
    { ok: false, error: "Procore error", stage, message, status: safeStatus, url, data },
    { status: safeStatus >= 400 && safeStatus <= 599 ? safeStatus : 500 }
  );
}

function getSession() {
  const raw = cookies().get(getSessionCookieName())?.value || "";
  return readSessionValue(raw);
}

async function fetchProject({ companyId, userId, projectId }) {
  const pid = encodeURIComponent(String(projectId));
  const cid = encodeURIComponent(String(companyId));

  const attempts = [
    { stage: "project_fetch", path: `/rest/v1.0/projects/${pid}` },
    { stage: "project_fetch_with_company_id", path: `/rest/v1.0/projects/${pid}?company_id=${cid}` },
  ];

  let last = null;

  for (const a of attempts) {
    const r = await procoreFetchSafe(a.path, { method: "GET" }, companyId, userId);
    last = { ...r, stage: a.stage };
    if (r.ok) return last;

    const payload = JSON.stringify(r.data || {});
    const isMissingContext =
      r.status === 400 &&
      (payload.includes("Missing Project or Company ID") ||
        payload.includes("Missing Project ID") ||
        payload.includes("Missing Company ID"));

    if (!isMissingContext) break;
  }

  return last;
}

function normalizeFolderRows(payload) {
  // List folders endpoint shapes:
  // A) [ {id,name,...}, ... ]
  // B) { data: [ ... ] }
  // C) { folders: [ ... ] }  (THIS tenant returns a single root folder object w/ folders[])
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.folders)) return payload.folders;
  }
  return [];
}

async function procoreGet({ companyId, userId, url, stage }) {
  const r = await procoreFetchSafe(url, { method: "GET" }, companyId, userId);
  if (!r.ok) {
    throw Object.assign(new Error(`${stage} failed`), {
      stage,
      status: r.status,
      url: r.url,
      data: r.data,
    });
  }
  return r.data;
}

/**
 * Critical: determine the numeric "project documents root folder id"
 * for this tenant/project. The API returns a single root folder object.
 */
async function getProjectRootFolderId({ companyId, userId, projectId }) {
  const base = `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}`;

  const candidates = [
    { stage: "folders_root_no_parent", url: base },
    { stage: "folders_root_ROOT", url: `${base}&parent_id=ROOT` },
    { stage: "folders_root_0", url: `${base}&parent_id=0` },
  ];

  let lastErr = null;

  for (const c of candidates) {
    try {
      const data = await procoreGet({ companyId, userId, url: c.url, stage: c.stage });

      // If Procore returns a single root folder object, it will have an id and folders/files arrays.
      if (data && typeof data === "object" && !Array.isArray(data) && data.id) {
        return String(data.id);
      }

      // If it returns an array, take the first root-like folder.
      if (Array.isArray(data) && data.length > 0 && data[0]?.id) {
        return String(data[0].id);
      }

      // If it returns { data: [...] }
      if (data && typeof data === "object" && Array.isArray(data.data) && data.data[0]?.id) {
        return String(data.data[0].id);
      }

      // Otherwise try next candidate
    } catch (e) {
      lastErr = e;
    }
  }

  throw Object.assign(new Error("Unable to determine project root folder id"), {
    stage: "root_anchor",
    status: lastErr?.status || 500,
    url: lastErr?.url || null,
    data: lastErr?.data || null,
  });
}

async function listChildFolders({ companyId, userId, projectId, parentId }) {
  const url =
    `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}` +
    `&parent_id=${encodeURIComponent(String(parentId))}`;

  const data = await procoreGet({ companyId, userId, url, stage: "list_folders" });

  const rows = normalizeFolderRows(data);
  return rows
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ id: x.id, name: String(x.name || "") }));
}

function findFolderByName(children, targetName) {
  const targetTrim = String(targetName || "").trim();

  const exact = children.find((c) => String(c.name || "").trim() === targetTrim);
  if (exact) return exact;

  const t = targetTrim.toLowerCase();
  return children.find((c) => String(c.name || "").trim().toLowerCase() === t) || null;
}

async function resolvePath({ companyId, userId, projectId, startParentId, pathSegments }) {
  let parentId = String(startParentId);

  for (const seg of pathSegments) {
    const children = await listChildFolders({ companyId, userId, projectId, parentId });
    const hit = findFolderByName(children, seg);

    if (!hit?.id) {
      const found = children.map((c) => c.name).filter(Boolean).slice(0, 80);
      throw Object.assign(new Error(`Folder not found: "${seg}" under parent_id=${parentId}`), {
        stage: "resolve_path",
        status: 404,
        url: null,
        data: { projectId: String(projectId), parentId, expected: seg, found },
      });
    }

    parentId = String(hit.id);
  }

  return parentId;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id ?? body.companyId;
    const projectId = body.project_id ?? body.projectId;

    if (!companyId || !projectId) {
      return jsonError({
        stage: "validate_input",
        status: 400,
        message: "Missing company_id or project_id",
        data: { received: body },
      });
    }

    const session = getSession();

    if (!session?.companyId || !session?.userId) {
      return jsonError({ stage: "auth", status: 401, message: "Not authenticated" });
    }

    if (String(session.companyId) !== String(companyId)) {
      return jsonError({
        stage: "auth",
        status: 401,
        message: "Session/company mismatch",
        data: { sessionCompanyId: String(session.companyId), requestCompanyId: String(companyId) },
      });
    }

    // keep this for auth sanity; not used for docs root
    const projResp = await fetchProject({ companyId, userId: session.userId, projectId });
    if (!projResp?.ok) {
      return jsonError({
        stage: projResp?.stage || "project_fetch",
        status: projResp?.status || 500,
        message: `Project fetch failed: ${projResp?.status} ${JSON.stringify(projResp?.data || {})}`,
        url: projResp?.url || null,
        data: projResp?.data || null,
      });
    }

    // Key fix: numeric root folder id (project root)
    const projectRootFolderId = await getProjectRootFolderId({
      companyId,
      userId: session.userId,
      projectId,
    });

    const templateFolderId = await resolvePath({
      companyId,
      userId: session.userId,
      projectId,
      startParentId: projectRootFolderId,
      pathSegments: PATH_TEMPLATE,
    });

    const completedFolderId = await resolvePath({
      companyId,
      userId: session.userId,
      projectId,
      startParentId: projectRootFolderId,
      pathSegments: PATH_COMPLETED,
    });

    return NextResponse.json({
      ok: true,
      projectRootFolderId,
      templateFolder: { id: String(templateFolderId), path: PATH_TEMPLATE },
      completedFolder: { id: String(completedFolderId), path: PATH_COMPLETED },
    });
  } catch (e) {
    return jsonError({
      stage: e?.stage || "resolve",
      status: e?.status || 500,
      message: e?.message || "Unknown error",
      url: e?.url || null,
      data: e?.data || null,
    });
  }
}
