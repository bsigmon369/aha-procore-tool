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

function toChildRows(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ id: x.id, name: String(x.name || "") }));
}

/**
 * Tenant behavior:
 * - /folders?project_id=... returns ONE project-root folder object (id + folders[])
 * - /folders?project_id=...&parent_id=CHILD_ID incorrectly returns the project-root folder object again
 * Fix: use /folders/:id?project_id=... to get children reliably.
 */
async function getProjectRootFolderId({ companyId, userId, projectId }) {
  const pid = encodeURIComponent(String(projectId));

  // Prefer the simplest call: returns project root folder object on your tenant
  const rootObj = await procoreGet({
    companyId,
    userId,
    url: `/rest/v1.0/folders?project_id=${pid}`,
    stage: "folders_root",
  });

  if (rootObj && typeof rootObj === "object" && !Array.isArray(rootObj) && rootObj.id) {
    return String(rootObj.id);
  }

  // Fallbacks (defensive)
  if (Array.isArray(rootObj) && rootObj[0]?.id) return String(rootObj[0].id);
  if (rootObj && typeof rootObj === "object" && Array.isArray(rootObj.data) && rootObj.data[0]?.id) {
    return String(rootObj.data[0].id);
  }

  throw Object.assign(new Error("Unable to determine project root folder id"), {
    stage: "root_anchor",
    status: 500,
    url: null,
    data: rootObj,
  });
}

async function listChildFolders({ companyId, userId, projectId, parentId }) {
  const pid = encodeURIComponent(String(projectId));
  const fid = encodeURIComponent(String(parentId));

  const toRows = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((x) => x && typeof x === "object")
      .map((x) => ({ id: x.id, name: String(x.name || "") }));

  const url = `/rest/v1.0/folders/${fid}?project_id=${pid}`;

  const folderObj = await procoreGet({
    companyId,
    userId,
    url,
    stage: "show_folder",
  });

  if (!folderObj || typeof folderObj !== "object") {
    throw Object.assign(new Error("Folder show returned invalid payload"), {
      stage: "show_folder_invalid",
      status: 502,
      url,
      data: folderObj,
    });
  }

  // TEMP DEBUG (remove after stabilization)
  // console.log("[resolve] show_folder children", {
  //   parentId: String(parentId),
  //   childNames: (folderObj?.folders || []).map((f) => f?.name).filter(Boolean).slice(0, 30),
  // });

  if (Array.isArray(folderObj.folders)) {
    return toRows(folderObj.folders);
  }

  return [];
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

    // Sanity check auth/token still valid for project
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
