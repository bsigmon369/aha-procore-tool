import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { procoreFetchSafe } from "../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Template PDF location
 * - Replace this path with wherever you store the template in your project repo.
 * - If you are currently fetching the template from Procore Documents, swap this out later.
 */
async function loadTemplatePdfBytes(): Promise<Uint8Array> {
  // Example: keep a copy under /public/templates or /assets
  // const templatePath = path.join(process.cwd(), "public", "templates", "Hensel Phelps AHA Template.pdf");

  // For your sandbox/testing, you told me the mounted file exists here:
  // /mnt/data/Hensel Phelps AHA Template.pdf
  // In your real Vercel deployment, you should NOT rely on /mnt/data.
  const templatePath = "/mnt/data/Hensel Phelps AHA Template.pdf";

  const file = await fs.readFile(templatePath);
  return new Uint8Array(file);
}

type ProcoreProject = {
  id: number;
  project_number?: string | null;
  city?: string | null;
  state_code?: string | null;
};

/**
 * Fetch Procore project and return "JOB_NUMBER\nCity, ST"
 */
async function getProjectLocationString(companyId: string, projectId: string): Promise<string> {
  const endpoint = `/rest/v1.0/projects/${projectId}?company_id=${encodeURIComponent(companyId)}`;

  const res = await procoreFetchSafe(endpoint, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch project (${res.status}): ${text || "no body"}`);
  }

  const project = (await res.json()) as ProcoreProject;

  const jobNumber = (project.project_number || "").trim();
  const city = (project.city || "").trim();
  const st = (project.state_code || "").trim();

  const cityState = city && st ? `${city}, ${st}` : city || st;

  // Preferred: two-line format (fits the AHA header field better)
  if (jobNumber && cityState) return `${jobNumber}\n${cityState}`;

  // Fallbacks if Procore is missing some fields
  if (jobNumber) return jobNumber;
  if (cityState) return cityState;

  // Absolute last resort (should rarely happen)
  return "";
}

function setTextFieldSafe(form: any, fieldName: string, value: string) {
  try {
    const field = form.getTextField(fieldName);
    field.setText(value ?? "");
  } catch {
    // If the field name doesn’t match exactly, this prevents the route from hard-failing.
    // But you SHOULD fix the field name once confirmed.
  }
}

export async function GET(req: Request) {
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

    // 1) Pull Job Number + City/State from Procore
    const projectLocation = await getProjectLocationString(companyId, projectId);

    // 2) Load template PDF
    const templateBytes = await loadTemplatePdfBytes();

    // 3) Fill the PDF
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // IMPORTANT: field name must match your actual PDF form field name.
    // In your template list, it appears as "Project Location".
    // If your field is named "Project Location:" (with colon) then change it here.
    setTextFieldSafe(form, "Project Location", projectLocation);
    setTextFieldSafe(form, "Project Location:", projectLocation);

    // Optional: make text smaller if the field is tight
    // (pdf-lib supports it if you can access the field)
    // try { form.getTextField("Project Location").setFontSize(9); } catch {}

    form.flatten(); // locks the text in place; remove if you want editable PDFs

    const outBytes = await pdfDoc.save();

    return new NextResponse(outBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="AHA-${projectId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
