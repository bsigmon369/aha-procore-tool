import { NextResponse } from "next/server";
import { resolveFolderWithDocumentsFix } from "../../../../../lib/procoreDocuments";

const TEMPLATE_PATH = ["09 Submittals", "01 AHA's", "01 AHA Template"];
const COMPLETED_PATH = ["09 Submittals", "01 AHA's", "02 Completed AHA's"];

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const companyId = searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || null;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

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

    return NextResponse.json({
      templateFolder: templateFolder ? { id: templateFolder.id, name: templateFolder.name } : null,
      completedFolder: completedFolder ? { id: completedFolder.id, name: completedFolder.name } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId;
    const companyId = body.companyId || process.env.PROCORE_COMPANY_ID || null;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

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

    return NextResponse.json({
      templateFolder: templateFolder ? { id: templateFolder.id, name: templateFolder.name } : null,
      completedFolder: completedFolder ? { id: completedFolder.id, name: completedFolder.name } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
