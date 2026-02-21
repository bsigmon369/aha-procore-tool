// app/api/procore/documents/resolve/route.js
import { NextResponse } from "next/server";
import { resolveFolderWithDocumentsFix } from "@/lib/procoreDocuments";

/**
 * Your required paths (WITHOUT assuming "Documents" is a real folder node).
 */
const TEMPLATE_PATH = ["09 Submittals", "01 AHA's", "01 AHA Template"];
const COMPLETED_PATH = ["09 Submittals", "01 AHA's", "02 Completed AHA's"];

/**
 * GET /api/procore/documents/resolve?projectId=XXXX&companyId=YYYY (companyId optional)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const companyId = searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || null;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required query param: projectId" },
        { status: 400 }
      );
    }

    // Project scope: resolve both folders in the project’s Documents tool
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
    return NextResponse.json(
      { error: err?.message || "Unknown error", stack: process.env.NODE_ENV === "development" ? err?.stack : undefined },
      { status: 500 }
    );
  }
}

/**
 * POST { projectId, companyId? }
 * Same response as GET.
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = body.projectId;
    const companyId = body.companyId || process.env.PROCORE_COMPANY_ID || null;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required JSON body field: projectId" },
        { status: 400 }
      );
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
    return NextResponse.json(
      { error: err?.message || "Unknown error", stack: process.env.NODE_ENV === "development" ? err?.stack : undefined },
      { status: 500 }
    );
  }
}
