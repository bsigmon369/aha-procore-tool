// app/api/procore/documents/resolve/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveFolderWithDocumentsFix } from "../../../../../lib/procoreDocuments";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";

// IMPORTANT: ensure spelling matches Procore exactly.
const TEMPLATE_PATH = ["09 Submittals", "00 Preparation", "01 AHA's", "01 AHA Template"];
const COMPLETED_PATH = ["09 Submittals", "00 Preparation", "01 AHA's", "02 Completed AHA's"];

function getIdsFromSearchParams(searchParams) {
  const projectId = searchParams.get("project_id") || searchParams.get("projectId") || "";
  const companyId =
    searchParams.get("company_id") ||
    searchParams.get("companyId") ||
    process.env.PROCORE_COMPANY_ID ||
    "";
  return { projectId, companyId };
}

function getIdsFromBody(body) {
  const projectId = body?.project_id || body?.projectId || "";
  const companyId =
    body?.company_id || body?.companyId || process.env.PROCORE_COMPANY_ID || "";
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

async function resolveBoth({ projectId, companyId, userId }) {
  // Optional hard-coded via env to avoid name-walking every request
  const TEMPLATE_ID = process.env.PROCORE_AHA_TEMPLATE_FOLDER_ID || "";
  const COMPLETED_ID = process.env.PROCORE_AHA_COMPLETED_FOLDER_ID || "";

  // If both IDs are set, skip API calls entirely
  if (TEMPLATE_ID && COMPLETED_ID) {
    return {
      templateFolder: { id: String(TEMPLATE_ID), name: "01 AHA Template" },
      completedFolder: { id: String(COMPLETED_ID), name: "02 Completed AHA's" },
    };
  }

  // Otherwise resolve by walking paths (fallback)
  const [templateFolder, completedFolder] = await Promise.all([
    TEMPLATE_ID
      ? { id: TEMPLATE_ID, name: "01 AHA Template" }
      : resolveFolderWithDocumentsFix({
          scope: "project",
          projectId,
          companyId,
          userId,
          rawSegments: TEMPLATE_PATH,
        }),
    COMPLETED_ID
      ? { id: COMPLETED_ID, name: "02 Completed AHA's" }
      : resolveFolderWithDocumentsFix({
          scope: "project",
          projectId,
          companyId,
          userId,
          rawSegments: COMPLETED_PATH,
        }),
  ]);

  return {
    templateFolder: templateFolder ? { id: String(templateFolder.id), name: templateFolder.name } : null,
    completedFolder: completedFolder ? { id: String(completedFolder.id), name: completedFolder.name } : null,
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const { projectId, companyId } = getIdsFromSearchParams(searchParams);

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

    const { templateFolder, completedFolder } = await resolveBoth({
      projectId,
      companyId,
      userId: sessionCheck.session.userId,
    });

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
    const { projectId, companyId } = getIdsFromBody(body);

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

    const { templateFolder, completedFolder } = await resolveBoth({
      projectId,
      companyId,
      userId: sessionCheck.session.userId,
    });

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
