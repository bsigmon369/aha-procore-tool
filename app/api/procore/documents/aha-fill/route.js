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

function asString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join("\n");
  return String(v);
}

function clampText(s, maxChars) {
  const t = asString(s);
  if (!maxChars || t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1) + "…";
}

/**
 * Safe field set that also forces appearance for problematic fields.
 * - Forces font size when requested (prevents giant text rendering)
 * - Enables multiline when requested (Notes)
 */
function safeSetText(form, name, value, opts = {}) {
  try {
    const field = form.getTextField(name);

    if (opts.multiline) {
      try {
        field.enableMultiline();
      } catch {}
    }

    if (opts.fontSize) {
      try {
        field.setFontSize(opts.fontSize);
      } catch {}
    }

    field.setText(asString(value));
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

    const { PDFDocument, StandardFonts } = await import("pdf-lib");

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

    // Force consistent appearance across viewers (prevents huge/odd rendering)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    try {
      form.updateFieldAppearances(font);
    } catch {}

    // ===== HEADER =====
    safeSetText(form, "ActivityWork Task", aha.header?.activityWorkTask, { fontSize: 10 });
    safeSetText(form, "Project Location", aha.header?.projectLocation, { fontSize: 10 });
    safeSetText(form, "Contractor", aha.header?.contractor, { fontSize: 10 });
    safeSetText(form, "Date Prepared", aha.header?.datePrepared, { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", aha.header?.preparedByNameTitle, { fontSize: 10 });
    safeSetText(form, "Reviewed by NameTitle", aha.header?.reviewedByNameTitle, { fontSize: 10 });

    // Notes is the problem child: multiline + smaller font + cap length
    safeSetText(
      form,
      "Notes Field Notes Review Comments",
      clampText(aha.header?.notes, 650),
      { multiline: true, fontSize: 9 }
    );

    // ===== JOB STEPS (Rows 1–5) =====
    const rows = Array.isArray(aha.jobStepRows) ? aha.jobStepRows : [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const index = i + 1;

      safeSetText(form, `Job StepsRow${index}`, row.step, { fontSize: 9 });
      safeSetText(form, `HazardsRow${index}`, row.hazards, { fontSize: 9 });
      safeSetText(form, `ControlsRow${index}`, row.controls, { fontSize: 9 });
      safeSetText(form, `RACRow${index}`, row.rac, { fontSize: 9 });
    }

    // ===== EQUIPMENT / TRAINING / INSPECTION =====
    const equipment = Array.isArray(aha.resources?.equipmentToBeUsed) ? aha.resources.equipmentToBeUsed : [];
    const training = Array.isArray(aha.resources?.training) ? aha.resources.training : [];
    const inspection = Array.isArray(aha.resources?.inspectionRequirements) ? aha.resources.inspectionRequirements : [];

    for (let i = 0; i < 5; i++) {
      const index = i + 1;
      safeSetText(form, `Equipment to be UsedRow${index}`, equipment[i], { fontSize: 9 });
      safeSetText(form, `TrainingRow${index}`, training[i], { fontSize: 9 });
      safeSetText(form, `Inspection RequirementsRow${index}`, inspection[i], { fontSize: 9 });
    }

    // Re-apply appearances after setting text (important for consistent rendering)
    try {
      form.updateFieldAppearances(font);
    } catch {}

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
