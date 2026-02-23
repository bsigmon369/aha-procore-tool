// app/api/procore/documents/resolve/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Folder paths by NAME (project-specific IDs resolved at runtime)
const PATH_ROOT = ["09 Submittals", "00 Preparation", "01 AHA's"];
const PATH_TEMPLATE = [...PATH_ROOT, "01 AHA Template"];
const PATH_COMPLETED = [...PATH_ROOT, "02 Completed AHA's"];

async function getProjectDocumentsRootFolderId({ companyId, userId, projectId }) {
  const r = await procoreFetchSafe(
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}`,
    { method: "GET" },
    companyId,
    userId
  );

  if (!r.ok) {
    throw new Error(`Project fetch failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  // Procore project payloads can vary; try common fields.
  const root =
    r.data?.root_folder_id ||
    r.data?.documents_folder_id ||
    r.data?.root_document_folder_id ||
    r.data?.document_root_folder_id ||
    null;

  if (!root) {
    throw new Error(`Project is missing documents root folder id`);
  }

  return String(root);
}

async function listFoldersUnderParent({ companyId, userId, projectId, parentId }) {
  const url =
    `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}` +
    (parentId ? `&parent_id=${encodeURIComponent(parentId)}` : "");

  const r = await procoreFetchSafe(url, { method: "GET" }, companyId, userId);

  if (!r.ok) {
    throw new Error(`List folders failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : [];

  return rows
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      id: x.id,
      name: x.name,
    }));
}

async function resolvePathByName({ companyId, userId, projectId, pathSegments, startParentId }) {
  let parentId = startParentId;

  for (const seg of pathSegments) {
    const children = await listFoldersUnderParent({ companyId, userId, projectId, parentId });

    // Exact match first
    let hit = children.find((c) => String(c.name || "").trim() === seg);

    // Fallback: case-insensitive match (helps if someone changed casing)
    if (!hit) {
      const target = seg.trim().toLowerCase();
      hit = children.find((c) => String(c.name || "").trim().toLowerCase() === target);
    }

    if (!hit?.id) {
      const names = children.map((c) => c.name).filter(Boolean).slice(0, 80);
      throw new Error(
        `Folder not found: "${seg}" under parent_id=${parentId} in project_id=${projectId}. Found: ${names.join(
          ", "
        )}`
      );
    }

    parentId = String(hit.id);
  }

  return { id: String(parentId), name: pathSegments[pathSegments.length - 1] };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { company_id, project_id } = body;

    if (!company_id || !project_id) {
      return NextResponse.json({ ok: false, error: "Missing company_id or project_id" }, { status: 400 });
    }

    // --- session ---
    const raw = cookies().get(getSessionCookieName())?.value;
    const session = readSessionValue(raw);

    if (!session?.companyId || !session?.userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (String(session.companyId) !== String(company_id)) {
      return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
    }

    // --- documents root (PER PROJECT) ---
    const docsRootId = await getProjectDocumentsRootFolderId({
      companyId: company_id,
      userId: session.userId,
      projectId: project_id,
    });

    // --- resolve by folder names under documents root ---
    const templateFolder = await resolvePathByName({
      companyId: company_id,
      userId: session.userId,
      projectId: project_id,
      pathSegments: PATH_TEMPLATE,
      startParentId: docsRootId,
    });

    const completedFolder = await resolvePathByName({
      companyId: company_id,
      userId: session.userId,
      projectId: project_id,
      pathSegments: PATH_COMPLETED,
      startParentId: docsRootId,
    });

    return NextResponse.json({
      ok: true,
      docsRootId,
      templateFolder,
      completedFolder,
      path: {
        root: PATH_ROOT,
        template: PATH_TEMPLATE,
        completed: PATH_COMPLETED,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "Procore error",
        message: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}
