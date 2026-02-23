// app/api/procore/documents/aha-fill/route.js
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

function cleanOneLine(s) {
  return String(s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampOneLine(s, max) {
  const t = cleanOneLine(s);
  if (!max || max <= 0) return t;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function cleanMulti(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampMulti(s, maxChars) {
  const t = cleanMulti(s);
  if (!maxChars || maxChars <= 0) return t;
  return t.length > maxChars ? t.slice(0, maxChars - 1).trimEnd() + "…" : t;
}

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

    field.setText(String(value ?? ""));
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
    if (String(session.companyId) !== String(company_id)) {
      return NextResponse.json(
        { ok: false, error: "Session/company mismatch" },
        { status: 401 }
      );
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

    // Force consistent appearances (prevents giant text in some viewers)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    try {
      form.updateFieldAppearances(font);
    } catch {}

    // ===== HEADER (tight single-line boxes) =====
    safeSetText(form, "ActivityWork Task", clampOneLine(aha.header?.activityWorkTask, 60), { fontSize: 10 });
    safeSetText(form, "Project Location", clampOneLine(aha.header?.projectLocation, 40), { fontSize: 10 });
    safeSetText(form, "Contractor", clampOneLine(aha.header?.contractor, 28), { fontSize: 10 });
    safeSetText(form, "Date Prepared", clampOneLine(aha.header?.datePrepared, 12), { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", clampOneLine(aha.header?.preparedByNameTitle, 38), { fontSize: 10 });
    safeSetText(form, "Reviewed by NameTitle", clampOneLine(aha.header?.reviewedByNameTitle, 38), { fontSize: 10 });

    // Notes is multiline; keep it sane and small font
    safeSetText(
      form,
      "Notes Field Notes Review Comments",
      clampMulti(aha.header?.notes, 240),
      { multiline: true, fontSize: 9 }
    );

    // ===== JOB STEPS (Rows 1–5) =====
    const rows = Array.isArray(aha.jobStepRows) ? aha.jobStepRows : [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const index = i + 1;

      safeSetText(form, `Job StepsRow${index}`, clampOneLine(row.step, 55), { fontSize: 9 });
      safeSetText(form, `HazardsRow${index}`, clampOneLine(row.hazards, 55), { fontSize: 9 });
      safeSetText(form, `ControlsRow${index}`, clampOneLine(row.controls, 85), { fontSize: 9 });
      safeSetText(form, `RACRow${index}`, clampOneLine(row.rac, 2), { fontSize: 9 });
    }

    // ===== EQUIPMENT / TRAINING / INSPECTION =====
    const equipment = Array.isArray(aha.resources?.equipmentToBeUsed) ? aha.resources.equipmentToBeUsed : [];
    const training = Array.isArray(aha.resources?.training) ? aha.resources.training : [];
    const inspection = Array.isArray(aha.resources?.inspectionRequirements) ? aha.resources.inspectionRequirements : [];

    for (let i = 0; i < 5; i++) {
      const index = i + 1;
      safeSetText(form, `Equipment to be UsedRow${index}`, clampOneLine(equipment[i], 40), { fontSize: 9 });
      safeSetText(form, `TrainingRow${index}`, clampOneLine(training[i], 40), { fontSize: 9 });
      safeSetText(form, `Inspection RequirementsRow${index}`, clampOneLine(inspection[i], 40), { fontSize: 9 });
    }

    // Re-apply appearances after setting values
    try {
      form.updateFieldAppearances(font);
    } catch {}

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
