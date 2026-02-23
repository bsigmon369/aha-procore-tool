// app/api/procore/documents/aha-complete/route.js
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import fs from "fs/promises";

/**
 * NOTE:
 * This route is not your primary production fill route (aha-fill is).
 * But it must still compile for Vercel builds.
 *
 * This version is pure JavaScript (no TS annotations).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadTemplatePdfBytes() {
  // IMPORTANT:
  // In Vercel serverless, you generally cannot rely on /mnt/data.
  // If you need this route in production, store the template in your repo
  // (e.g. /public/templates/...) or fetch from Procore Documents.
  //
  // Keeping your existing path as-is to avoid behavior changes.
  const templatePath = "/mnt/data/Hensel Phelps AHA Template.pdf";
  const file = await fs.readFile(templatePath);
  return new Uint8Array(file);
}

function safeSetTextField(form, fieldName, value) {
  try {
    form.getTextField(fieldName).setText(String(value ?? ""));
  } catch {
    // ignore missing fields
  }
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id") || "";
    const projectId = url.searchParams.get("project_id") || "";

    if (!companyId || !projectId) {
      return NextResponse.json(
        { ok: false, error: "Missing required query params: company_id, project_id" },
        { status: 400 }
      );
    }

    const templateBytes = await loadTemplatePdfBytes();
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Minimal example fields (keep or remove as you want)
    // These are placeholders; your production route is aha-fill.
    safeSetTextField(form, "Project Location", "");
    safeSetTextField(form, "Contractor", "");

    form.flatten();
    const outBytes = await pdfDoc.save();

    return new NextResponse(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="AHA-${projectId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
