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
    {
      ok: false,
      error: "Procore error",
      stage,
      message,
      status: safeStatus,
      url,
      data,
    },
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

function extractDocsRootId(project) {
  return (
    project?.root_folder_id ??
    project?.documents_folder_id ??
    project?.root_document_folder_id ??
    project?.document_root_folder_id ??
    null
  );
}

async function listChildFolders({ companyId, userId, projectId, parentId }) {
  const url =
    `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}` +
    `&parent_id=${encodeURIComponent(String(parentId))}`;

  const r = await procoreFetchSafe(url, { method: "GET" }, companyId, userId);
  if (!r.ok) {
    throw Object.assign(new Error("List folders failed"), {
      stage: "list_folders",
      status: r.status,
      url: r.url,
      data: r.data,
    });
  }

  const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : [];
  return rows
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ id: x.id, name: String(x.name || "") }));
}

function findFolderByName(children, targetName) {
  const exact = children.find((c) => c.name.trim() === targetName);
  if (exact) return exact;

  const t = targetName.trim().toLowerCase();
  return children.find((c) => c.name.trim().toLowerCase() === t) || null;
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

    const docsRootId = extractDocsRootId(projResp.data);
    if (!docsRootId) {
      return jsonError({
        stage: "project_docs_root_missing",
        status: 500,
        message: "Project missing documents root folder id",
        url: projResp.url || null,
        data: projResp.data || null,
      });
    }

    const templateFolderId = await resolvePath({
      companyId,
      userId: session.userId,
      projectId,
      startParentId: docsRootId,
      pathSegments: PATH_TEMPLATE,
    });

    const completedFolderId = await resolvePath({
      companyId,
      userId: session.userId,
      projectId,
      startParentId: docsRootId,
      pathSegments: PATH_COMPLETED,
    });

    return NextResponse.json({
      ok: true,
      docsRootId: String(docsRootId),
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
