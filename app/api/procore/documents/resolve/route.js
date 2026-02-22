export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveFolderWithDocumentsFix } from "../../../../../lib/procoreDocuments";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";

// IMPORTANT: ensure spelling matches Procore exactly.
// Your requested path includes "00 Preparation" (note spelling).
const TEMPLATE_PATH = ["09 Submittals", "00 Preparation", "01 AHA's", "01 AHA Template"];
const COMPLETED_PATH = ["09 Submittals", "00 Preparation", "01 AHA's", "02 Completed AHA's"];

function getIds(searchParams) {
  const projectId = searchParams.get("project_id") || searchParams.get("projectId") || "";
  const companyId =
    searchParams.get("company_id") ||
    searchParams.get("companyId") ||
    process.env.PROCORE_COMPANY_ID ||
    "";
  return { projectId, companyId };
}

function requireSession(companyId) {
  const raw = cookies().get(getSessionCookieName())?.value;
  const session = readSessionValue(raw);

  if (!session?.companyId || !session?.userId) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }
  if (String(session.companyId) !== String(companyId)) {
    return { ok: false, status: 401, error: "Session/company mismatch" };
  }
  return { ok: true, session };
}

async function resolveBoth({ projectId, companyId }) {
  const templateFolder = await resolveFolderWithDocumentsFix({
    scope: "project",
    projectId,
    companyId,
    rawSegments: TEMPLATE_PATH,
  });

  const completedFolder = await resolveFolderWithDocumentsFix({
    scope: "project",
    projectId,
    companyId,
    rawSegments: COMPLETED_PATH,
  });

  return {
    templateFolder: templateFolder ? { id: String(templateFolder.id), name: templateFolder.name } : null,
    completedFolder: completedFolder ? { id: String(completedFolder.id), name: completedFolder.name } : null,
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const { projectId, companyId } = getIds(searchParams);

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Missing company_id" }, { status: 400 });
    }

    const sessionCheck = requireSession(companyId);
    if (!sessionCheck.ok) {
      return NextResponse.json({ ok: false, error: sessionCheck.error }, { status: sessionCheck.status });
    }

    const { templateFolder, completedFolder } = await resolveBoth({ projectId, companyId });

    return NextResponse.json({
      ok: true,
      templateFolder,
      completedFolder,
      paths: { template: TEMPLATE_PATH, completed: COMPLETED_PATH },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id || body.projectId || "";
    const companyId = body.company_id || body.companyId || process.env.PROCORE_COMPANY_ID || "";

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Missing company_id" }, { status: 400 });
    }

    const sessionCheck = requireSession(companyId);
    if (!sessionCheck.ok) {
      return NextResponse.json({ ok: false, error: sessionCheck.error }, { status: sessionCheck.status });
    }

    const { templateFolder, completedFolder } = await resolveBoth({ projectId, companyId });

    return NextResponse.json({
      ok: true,
      templateFolder,
      completedFolder,
      paths: { template: TEMPLATE_PATH, completed: COMPLETED_PATH },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
// app/api/procore/documents/resolve/route.js

import { resolveFolderWithDocumentsFix } from "@/lib/procoreDocuments";

async function resolveWithTrace({ procoreFetch, companyId, projectId, pathSegments }) {
  // Clone resolver logic just enough to emit trace
  const trace = [];

  // root
  let folderId = null;

  // root children
  const root = await procoreFetch(`/rest/v1.0/folders?project_id=${projectId}`, {
    method: "GET",
    headers: { "Procore-Company-Id": String(companyId) },
  });

  let children = Array.isArray(root?.files) ? root.files : Array.isArray(root) ? root : [];
  children = children.filter((it) => it?.is_folder === true || it?.type === "folder");

  for (const seg of pathSegments) {
    trace.push({
      segment: seg,
      sampleChildren: children.slice(0, 25).map((c) => ({ id: c.id, name: c.name, title: c.title })),
    });

    // Let the fixed resolver do the real match logic by resolving prefix each time
    const prefix = pathSegments.slice(0, trace.length);
    const resolved = await resolveFolderWithDocumentsFix({
      procoreFetch,
      companyId,
      projectId,
      pathSegments: prefix,
    });

    if (!resolved) return { folder: null, trace, failedAt: seg };

    folderId = resolved.id;

    const next = await procoreFetch(`/rest/v1.0/folders/${folderId}?project_id=${projectId}`, {
      method: "GET",
      headers: { "Procore-Company-Id": String(companyId) },
    });

    children = Array.isArray(next?.files) ? next.files : [];
    children = children.filter((it) => it?.is_folder === true || it?.type === "folder");
  }

  const folder = await resolveFolderWithDocumentsFix({ procoreFetch, companyId, projectId, pathSegments });
  return { folder, trace, failedAt: null };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  const projectId = searchParams.get("project_id");

  // ... your session + procoreFetch creation here ...

  const templatePath = ["09 Submittals", "00 Preparation", "01 AHA's", "01 AHA Template"];
  const completedPath = ["09 Submittals", "00 Preparation", "01 AHA's", "02 Completed AHA's"];

  const template = await resolveWithTrace({ procoreFetch, companyId, projectId, pathSegments: templatePath });
  const completed = await resolveWithTrace({ procoreFetch, companyId, projectId, pathSegments: completedPath });

  return Response.json({
    ok: true,
    templateFolder: template.folder,
    completedFolder: completed.folder,
    debug: {
      template,
      completed,
    },
    paths: { template: templatePath, completed: completedPath },
  });
}
