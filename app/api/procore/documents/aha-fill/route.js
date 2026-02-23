import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchPdfBytes({ origin, companyId, projectId, fileId, cookieHeader }) {
  const url = new URL("/api/procore/documents/download", origin);
  url.searchParams.set("company_id", String(companyId));
  url.searchParams.set("project_id", String(projectId));
  url.searchParams.set("file_id", String(fileId));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Cookie: cookieHeader || "" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed ${res.status}: ${text.slice(0, 500)}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

function safeSetText(form, name, value) {
  try {
    const field = form.getTextField(name);
    field.setText(value || "");
  } catch {}
}

export async function POST(req) {
  try {
    const body = await req.json();

    const { company_id, project_id, file_id, aha } = body;

    if (!company_id || !project_id || !file_id || !aha) {
      return NextResponse.json(
        { ok: false, error: "Missing company_id, project_id, file_id, or aha payload" },
        { status: 400 }
      );
    }

    const raw = cookies().get(getSessionCookieName())?.value;
    const session = readSessionValue(raw);

    if (!session?.companyId || !session?.userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const { PDFDocument } = await import("pdf-lib");

    const cookieHeader = req.headers.get("cookie") || "";
    const pdfBytes = await fetchPdfBytes({
      origin: new URL(req.url).origin,
      companyId: company_id,
      projectId: project_id,
      fileId: file_id,
      cookieHeader,
    });

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    // ===== HEADER =====
    safeSetText(form, "ActivityWork Task", aha.header?.activityWorkTask);
    safeSetText(form, "Project Location", aha.header?.projectLocation);
    safeSetText(form, "Contractor", aha.header?.contractor);
    safeSetText(form, "Date Prepared", aha.header?.datePrepared);
    safeSetText(form, "Prepared by NameTitle", aha.header?.preparedByNameTitle);
    safeSetText(form, "Reviewed by NameTitle", aha.header?.reviewedByNameTitle);
    safeSetText(form, "Notes Field Notes Review Comments", aha.header?.notes);

    // ===== JOB STEPS (Rows 1–5) =====
    const rows = aha.jobStepRows || [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const index = i + 1;

      safeSetText(form, `Job StepsRow${index}`, row.step);
      safeSetText(form, `HazardsRow${index}`, row.hazards);
      safeSetText(form, `ControlsRow${index}`, row.controls);
      safeSetText(form, `RACRow${index}`, row.rac);
    }

    // ===== EQUIPMENT / TRAINING / INSPECTION =====
    const equipment = aha.resources?.equipmentToBeUsed || [];
    const training = aha.resources?.training || [];
    const inspection = aha.resources?.inspectionRequirements || [];

    for (let i = 0; i < 5; i++) {
      const index = i + 1;
      safeSetText(form, `Equipment to be UsedRow${index}`, equipment[i]);
      safeSetText(form, `TrainingRow${index}`, training[i]);
      safeSetText(form, `Inspection RequirementsRow${index}`, inspection[i]);
    }

    // Flatten so fields become permanent text
    form.flatten();

    const filledBytes = await pdfDoc.save();

    return new NextResponse(filledBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="AHA-Filled.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
