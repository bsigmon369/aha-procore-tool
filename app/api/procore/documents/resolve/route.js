export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveFolderWithDocumentsFix } from "../../../../../lib/procoreDocuments";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";

// IMPORTANT: ensure spelling matches Procore exactly.
// Your requested path includes "00 Preperation" (note spelling).
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
