// app/api/procore/documents/aha-fill/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

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

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProjectLocationTwoLine(project) {
  const jobNumber = String(project?.project_number || "").trim();
  const city = String(project?.city || "").trim();
  const st = String(project?.state_code || "").trim();
  const cityState = city && st ? `${city}, ${st}` : city || st;
  if (jobNumber && cityState) return `${jobNumber}\n${cityState}`;
  return jobNumber || cityState || "";
}

function getFirstWidgetRect(textField) {
  try {
    const widgets = textField?.acroField?.getWidgets?.();
    if (!widgets || !widgets.length) return null;
    const r = widgets[0].getRectangle();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

function wrapWordsToWidth(font, text, fontSize, maxWidth) {
  const words = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\s+/)
    .filter(Boolean);

  const widthOf = (s) => {
    try {
      return font.widthOfTextAtSize(s, fontSize);
    } catch {
      return s.length * fontSize * 0.5;
    }
  };

  const lines = [];
  let line = "";

  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (widthOf(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);

    // If a single word is too long, hard-break it.
    if (widthOf(w) > maxWidth) {
      let chunk = "";
      for (const ch of w) {
        const cand2 = chunk + ch;
        if (widthOf(cand2) <= maxWidth) {
          chunk = cand2;
        } else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    } else {
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsizeToWidth(font, text, fontSize, maxWidth) {
  const t = String(text || "").trim();
  const ell = "…";

  const widthOf = (s) => {
    try {
      return font.widthOfTextAtSize(s, fontSize);
    } catch {
      return s.length * fontSize * 0.5;
    }
  };

  if (!t) return "";
  if (widthOf(t) <= maxWidth) return t;

  let out = t;
  while (out.length > 0 && widthOf(out + ell) > maxWidth) {
    out = out.slice(0, -1);
  }
  return (out.trimEnd() || "") + ell;
}

function safeSetWrappedText({ form, fieldName, value, font, maxFontSize = 9, minFontSize = 8, padding = 2 }) {
  try {
    const field = form.getTextField(fieldName);
    try {
      field.enableMultiline();
    } catch {}

    const rect = getFirstWidgetRect(field);
    if (!rect) {
      field.setText(cleanMulti(value));
      try {
        field.setFontSize(maxFontSize);
      } catch {}
      return;
    }

    const maxWidth = Math.max(1, rect.width - padding * 2);
    const maxHeight = Math.max(1, rect.height - padding * 2);

    const raw = cleanMulti(value);
    const paragraphs = raw ? raw.split(/\n{2,}/) : [""];

    for (let size = maxFontSize; size >= minFontSize; size -= 0.5) {
      const lineHeight = size * 1.15;
      const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));

      let lines = [];
      for (let p = 0; p < paragraphs.length; p++) {
        const para = paragraphs[p];
        const paraLines = wrapWordsToWidth(font, para, size, maxWidth);
        lines.push(...paraLines);
        if (p < paragraphs.length - 1) lines.push("");
      }

      if (lines.length <= maxLines) {
        try {
          field.setFontSize(size);
        } catch {}
        field.setText(lines.join("\n"));
        return;
      }
    }

    // Truncate at min font size
    const size = minFontSize;
    const lineHeight = size * 1.15;
    const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));

    let lines = [];
    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p];
      const paraLines = wrapWordsToWidth(font, para, size, maxWidth);
      lines.push(...paraLines);
      if (p < paragraphs.length - 1) lines.push("");
    }

    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsizeToWidth(font, lines[maxLines - 1], size, maxWidth);

    try {
      field.setFontSize(size);
    } catch {}
    field.setText(lines.join("\n"));
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
      return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
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

    // ===== HEADER (formatting punch list rules) =====
    // A) Project Location: Job Number + City/State from Procore project
    let projectLocation = "";
    try {
      const proj = await procoreFetchSafe(
        `/rest/v1.0/projects/${project_id}?company_id=${encodeURIComponent(String(company_id))}`,
        { method: "GET" },
        String(company_id),
        String(session.userId)
      );
      if (proj.ok) projectLocation = buildProjectLocationTwoLine(proj.data);
    } catch {}

    // B) Contractor: constant
    const contractor = "Sessa Sheet Metal Contractors, Inc.";

    // C) Prepared By: keep existing behavior (no Procore user lookup yet)
    const preparedBy = String(aha.header?.preparedByNameTitle || "").trim();

    // D) Reviewed By: Pat unless Prepared By is Pat, then Bobby
    const preparedNorm = normalizeName(preparedBy);
    const isPatPrepared = preparedNorm === "pat lowrie" || preparedNorm.startsWith("pat lowrie ");
    const reviewedBy = isPatPrepared ? "Bobby Sigmon" : "Pat Lowrie";

    safeSetText(form, "ActivityWork Task", clampOneLine(aha.header?.activityWorkTask, 60), { fontSize: 10 });
    safeSetWrappedText({
      form,
      fieldName: "Project Location",
      value: projectLocation || aha.header?.projectLocation || "",
      font,
      maxFontSize: 10,
      minFontSize: 9,
    });
    safeSetText(form, "Contractor", clampOneLine(contractor, 40), { fontSize: 10 });
    safeSetText(form, "Date Prepared", clampOneLine(aha.header?.datePrepared, 12), { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", clampOneLine(preparedBy, 38), { fontSize: 10 });
    safeSetText(form, "Reviewed by NameTitle", clampOneLine(reviewedBy, 38), { fontSize: 10 });

    // Notes is multiline; keep it sane and small font
    safeSetText(form, "Notes Field Notes Review Comments", clampMulti(aha.header?.notes, 240), {
      multiline: true,
      fontSize: 9,
    });

    // ===== JOB STEPS (Rows 1–5) — wrap cleanly inside boxes =====
    const rows = Array.isArray(aha.jobStepRows) ? aha.jobStepRows : [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const index = i + 1;

      safeSetWrappedText({ form, fieldName: `Job StepsRow${index}`, value: row.step, font, maxFontSize: 9, minFontSize: 8 });
      safeSetWrappedText({ form, fieldName: `HazardsRow${index}`, value: row.hazards, font, maxFontSize: 9, minFontSize: 8 });
      safeSetWrappedText({ form, fieldName: `ControlsRow${index}`, value: row.controls, font, maxFontSize: 9, minFontSize: 8 });
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
