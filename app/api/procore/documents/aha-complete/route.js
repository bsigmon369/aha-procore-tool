// app/api/procore/documents/aha-complete/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PATH_ROOT = ["09 Submittals", "00 Preparation", "01 AHA's"];
const PATH_COMPLETED = [...PATH_ROOT, "02 Completed AHA's"];

function jsonError(status, message, extra = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function getSession() {
  const raw = cookies().get(getSessionCookieName())?.value || "";
  return readSessionValue(raw);
}

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
    throw new Error(`Template download failed ${res.status}: ${text.slice(0, 500)}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

// --- Procore GET helper ---
async function procoreGet({ companyId, userId, url }) {
  const r = await procoreFetchSafe(url, { method: "GET" }, companyId, userId);
  if (!r.ok) {
    const msg = r?.data?.message || JSON.stringify(r?.data || {});
    throw new Error(`Procore GET failed ${r.status} ${url}: ${msg}`);
  }
  return r.data;
}

// --- resolve helpers ---
async function getProjectRootFolderId({ companyId, userId, projectId }) {
  const pid = encodeURIComponent(String(projectId));
  const rootObj = await procoreGet({
    companyId,
    userId,
    url: `/rest/v1.0/folders?project_id=${pid}`,
  });

  if (rootObj && typeof rootObj === "object" && !Array.isArray(rootObj) && rootObj.id) {
    return String(rootObj.id);
  }
  if (Array.isArray(rootObj) && rootObj[0]?.id) return String(rootObj[0].id);
  if (rootObj && typeof rootObj === "object" && Array.isArray(rootObj.data) && rootObj.data[0]?.id) {
    return String(rootObj.data[0].id);
  }

  throw new Error("Unable to determine project root folder id");
}

async function listChildFolders({ companyId, userId, projectId, parentId }) {
  const pid = encodeURIComponent(String(projectId));
  const fid = encodeURIComponent(String(parentId));
  const folderObj = await procoreGet({
    companyId,
    userId,
    url: `/rest/v1.0/folders/${fid}?project_id=${pid}`,
  });

  const folders = Array.isArray(folderObj?.folders) ? folderObj.folders : [];
  return folders
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ id: x.id, name: String(x.name || "") }));
}

// Alias-aware folder matching (fixes “Preparation” vs “Preperation”)
function findFolderByName(children, targetName) {
  const t = String(targetName || "").trim();
  if (!t) return null;

  const aliases = {
    "00 Preparation": ["00 Preperation"],
  };

  const candidates = [t, ...(aliases[t] || [])];

  for (const c of candidates) {
    const exact = children.find((x) => String(x.name || "").trim() === c);
    if (exact) return exact;
  }
  for (const c of candidates) {
    const cl = c.toLowerCase();
    const hit = children.find((x) => String(x.name || "").trim().toLowerCase() === cl);
    if (hit) return hit;
  }
  return null;
}

async function resolvePath({ companyId, userId, projectId, startParentId, pathSegments }) {
  let parentId = String(startParentId);

  for (const seg of pathSegments) {
    const children = await listChildFolders({ companyId, userId, projectId, parentId });
    const hit = findFolderByName(children, seg);
    if (!hit?.id) {
      const found = children.map((c) => c.name).filter(Boolean).slice(0, 80);
      throw new Error(`Folder not found: "${seg}" under parent_id=${parentId}. Found: ${found.join(", ")}`);
    }
    parentId = String(hit.id);
  }

  return parentId;
}

// --- PDF text helpers ---
function cleanOneLine(s) {
  return String(s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMulti(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampOneLine(s, max) {
  const t = cleanOneLine(s);
  if (!max || max <= 0) return t;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
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
  } catch {
    // Ignore if field does not exist
  }
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Project Location: Job# + Name, then City/ST
function buildProjectLocationTwoLine(project) {
  const jobNumber = String(project?.project_number || "").trim();
  const name = String(project?.name || "").trim();
  const city = String(project?.city || "").trim();
  const st = String(project?.state_code || "").trim();

  const line1 = [jobNumber, name].filter(Boolean).join(" – ");
  const line2 = city && st ? `${city}, ${st}` : city || st;

  if (line1 && line2) return `${line1}\n${line2}`;
  return line1 || line2 || "";
}

// Notes cleanup: remove “assumed/assuming/assumption”
function cleanNotes(text) {
  return cleanMulti(text)
    .replace(/\bassumed\b/gi, "")
    .replace(/\bassuming\b/gi, "")
    .replace(/\bassumption\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Compression to fit boxes (NO newlines added)
function compressForBox(text) {
  let t = cleanMulti(text);

  const replacements = [
    [/\bplease\b/gi, ""],
    [/\bensure that\b/gi, "ensure"],
    [/\bmake sure\b/gi, "ensure"],
    [/\bin order to\b/gi, "to"],
    [/\bprior to\b/gi, "before"],
    [/\bas needed\b/gi, ""],
    [/\bas appropriate\b/gi, ""],
    [/\bif applicable\b/gi, ""],
    [/\bwhen applicable\b/gi, ""],
    [/\bat all times\b/gi, "always"],
    [/\butilize\b/gi, "use"],
    [/\bapproximately\b/gi, "about"],
    [/\bwith the use of\b/gi, "using"],
    [/\bfor the purpose of\b/gi, "to"],
    [/\bshall\b/gi, "must"],
  ];
  for (const [re, sub] of replacements) t = t.replace(re, sub);

  // Remove article clutter
  t = t.replace(/\b(the|a|an)\b/gi, "");

  // Keep one paragraph; do not insert manual line breaks
  t = t
    .replace(/[;:]/g, ",")
    .replace(/\.\s+/g, "; ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();

  return t;
}

// ---------------------------------------------------
// DEBUG helper (easy to disable later):
// Flip this to false to silence FieldFit logs.
const DEBUG_FIELD_FIT = true;

function logFieldFit(fieldName, rect, fontSize, lineHeight, maxLines, wrappedLines) {
  if (!DEBUG_FIELD_FIT) return;
  console.log("FieldFit:", {
    field: fieldName,
    width: rect?.width,
    height: rect?.height,
    fontSize,
    lineHeight,
    maxLines,
    wrappedLines,
  });
}
// ---------------------------------------------------

// --- Wrapping engine (NO ellipsis; never silent truncate; throw if too long) ---

function toNumber(n) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : null;
}

/**
 * Robustly parse widget rectangle from pdf-lib.
 * Handles:
 * - Array form: [llx, lly, urx, ury]
 * - Object form: { x, y, width, height }
 * - Object form: { left, bottom, right, top }
 */
function getFirstWidgetRect(textField) {
  try {
    const widgets = textField?.acroField?.getWidgets?.();
    if (!widgets || !widgets.length) return null;

    const r = widgets[0].getRectangle();

    // Array-ish: [llx, lly, urx, ury]
    if (Array.isArray(r) && r.length >= 4) {
      const llx = toNumber(r[0]);
      const lly = toNumber(r[1]);
      const urx = toNumber(r[2]);
      const ury = toNumber(r[3]);
      if (llx == null || lly == null || urx == null || ury == null) return null;
      const width = urx - llx;
      const height = ury - lly;
      if (!(width > 0) || !(height > 0)) return null;
      return { x: llx, y: lly, width, height };
    }

    // Object form { x, y, width, height }
    if (r && typeof r === "object") {
      const x = toNumber(r.x ?? r.left);
      const y = toNumber(r.y ?? r.bottom);
      let width = toNumber(r.width);
      let height = toNumber(r.height);

      // Alternate { left, bottom, right, top }
      if ((width == null || height == null) && r.right != null && r.top != null && x != null && y != null) {
        const right = toNumber(r.right);
        const top = toNumber(r.top);
        if (right != null && top != null) {
          width = right - x;
          height = top - y;
        }
      }

      if (x == null || y == null || width == null || height == null) return null;
      if (!(width > 0) || !(height > 0)) return null;
      return { x, y, width, height };
    }

    return null;
  } catch {
    return null;
  }
}

function widthOfText(font, s, fontSize) {
  try {
    return font.widthOfTextAtSize(String(s || ""), fontSize);
  } catch {
    // Fallback: rough estimate
    return String(s || "").length * fontSize * 0.5;
  }
}

function wrapWordsToWidth(font, text, fontSize, maxWidth) {
  const words = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\s+/)
    .filter(Boolean);

  const lines = [];
  let line = "";

  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;

    if (widthOfText(font, candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);

    // hard-break a single long word if needed
    if (widthOfText(font, w, fontSize) > maxWidth) {
      let chunk = "";
      for (const ch of w) {
        const cand2 = chunk + ch;
        if (widthOfText(font, cand2, fontSize) <= maxWidth) {
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

function normalizeForWrap(value, { preserveNewlines }) {
  if (preserveNewlines) {
    // Keep explicit newlines (used by Project Location format),
    // but collapse runs of whitespace on each line.
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((ln) => ln.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // One paragraph only
  return cleanOneLine(value);
}

function buildWrappedLines(font, text, fontSize, maxWidth, { preserveNewlines }) {
  const t = normalizeForWrap(text, { preserveNewlines });

  if (!t) return [];

  if (!preserveNewlines) {
    return wrapWordsToWidth(font, t, fontSize, maxWidth);
  }

  // Preserve explicit newline breaks (each line is a paragraph segment)
  const parts = t.split("\n");
  const out = [];
  for (const part of parts) {
    const p = String(part || "").trim();
    if (!p) {
      // Keep an empty line if user intentionally passed one (rare here)
      out.push("");
      continue;
    }
    out.push(...wrapWordsToWidth(font, p, fontSize, maxWidth));
  }
  return out;
}

function safeSetWrappedTextNoEllipsis({
  form,
  fieldName,
  value,
  font,
  maxFontSize = 9,
  minFontSize = 6.5,
  fontStep = 0.25,
  paddingX = 1.5,
  paddingY = 1.5,
  lineHeightMult = 1.0,
  compress = true,
  preserveNewlines = false,
}) {
  // If field does not exist, ignore it.
  let field;
  try {
    field = form.getTextField(fieldName);
  } catch {
    return;
  }

  try {
    field.enableMultiline();
  } catch {}

  const rect = getFirstWidgetRect(field);

  const candidates = [];
  const base = String(value ?? "");
  candidates.push(base);
  if (compress) candidates.push(compressForBox(base));

  // If cannot measure widget rect, write best candidate and do not error
  if (!rect) {
    const v = candidates[candidates.length - 1] ?? "";
    try {
      field.setFontSize(maxFontSize);
    } catch {}
    field.setText(String(v));
    return;
  }

  const availWidth = Math.max(1, rect.width - paddingX * 2);
  const availHeight = Math.max(1, rect.height - paddingY * 2);

  // Guard: if numbers got weird, avoid false “too long”
  if (!Number.isFinite(availWidth) || !Number.isFinite(availHeight)) {
    const v = candidates[candidates.length - 1] ?? "";
    try {
      field.setFontSize(maxFontSize);
    } catch {}
    field.setText(String(v));
    return;
  }

  for (const candidateText of candidates) {
    for (let size = maxFontSize; size >= minFontSize; size = Math.round((size - fontStep) * 100) / 100) {
      const lineHeight = size * lineHeightMult;
      const maxLines = Math.max(1, Math.floor(availHeight / lineHeight));

      const lines = buildWrappedLines(font, candidateText, size, availWidth, { preserveNewlines });

      logFieldFit(fieldName, rect, size, lineHeight, maxLines, lines.length);

      if (lines.length <= maxLines) {
        try {
          field.setFontSize(size);
        } catch {}
        field.setText(lines.join("\n"));
        return;
      }

      // Safety to avoid infinite loops if fontStep is mis-set
      if (fontStep <= 0) break;
      if (size - fontStep < minFontSize) break;
    }
  }

  // Must throw if field exists but cannot fit
  throw new Error(`Text string too long: ${fieldName}`);
}

// --- filename helpers ---
function sanitizeFilePart(s) {
  return String(s || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Procore upload workflow ---
async function procoreCreateProjectUpload({ companyId, userId, projectId, filename }) {
  const pid = encodeURIComponent(String(projectId));
  const r = await procoreFetchSafe(
    `/rest/v1.1/projects/${pid}/uploads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_filename: filename,
        response_content_type: "application/pdf",
      }),
    },
    companyId,
    userId
  );

  if (!r.ok) {
    const msg = r?.data?.message || JSON.stringify(r?.data || {});
    throw new Error(`Create Upload failed ${r.status}: ${msg}`);
  }

  return r.data;
}

async function s3PostUpload({ uploadUrl, fields, fileBytes, filename }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  fd.append("file", new Blob([fileBytes], { type: "application/pdf" }), filename);

  const res = await fetch(uploadUrl, { method: "POST", body: fd });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Storage upload failed ${res.status}: ${text.slice(0, 500)}`);
  }
}

async function procoreCreateProjectFile({
  companyId,
  userId,
  projectId,
  parentFolderId,
  uploadId,
  uploadUuid,
  filename,
}) {
  const pid = encodeURIComponent(String(projectId));

  const filePayload = {
    parent_id: String(parentFolderId),
    name: String(filename),
  };

  if (uploadId) filePayload.upload_id = uploadId;
  if (uploadUuid) filePayload.upload_uuid = String(uploadUuid);

  const r = await procoreFetchSafe(
    `/rest/v1.0/files?project_id=${pid}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: filePayload }),
    },
    companyId,
    userId
  );

  if (!r.ok) {
    const msg = r?.data?.message || JSON.stringify(r?.data || {});
    throw new Error(`Create Project File failed ${r.status}: ${msg}`);
  }

  return r.data;
}

// Keep GET for sanity
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "aha-complete",
    note: "Use POST to generate + upload a completed AHA PDF.",
  });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const companyId = body.company_id ?? body.companyId;
    const projectId = body.project_id ?? body.projectId;
    const templateFileId = body.template_file_id ?? body.templateFileId;
    const completedFolderIdInput = body.completed_folder_id ?? body.completedFolderId;
    const aha = body.aha;

    if (!companyId || !projectId || !templateFileId || !aha) {
      return jsonError(400, "Missing company_id, project_id, template_file_id, or aha payload", { received: body });
    }

    const session = getSession();
    if (!session?.companyId || !session?.userId) return jsonError(401, "Not authenticated");
    if (String(session.companyId) !== String(companyId)) {
      return jsonError(401, "Session/company mismatch", {
        sessionCompanyId: String(session.companyId),
        requestCompanyId: String(companyId),
      });
    }

    let completedFolderId = completedFolderIdInput ? String(completedFolderIdInput) : null;

    if (!completedFolderId) {
      const rootId = await getProjectRootFolderId({
        companyId,
        userId: session.userId,
        projectId,
      });

      completedFolderId = await resolvePath({
        companyId,
        userId: session.userId,
        projectId,
        startParentId: rootId,
        pathSegments: PATH_COMPLETED,
      });
    }

    const cookieHeader = req.headers.get("cookie") || "";
    const pdfBytes = await fetchPdfBytes({
      origin: new URL(req.url).origin,
      companyId,
      projectId,
      fileId: templateFileId,
      cookieHeader,
    });

    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    try {
      form.updateFieldAppearances(font);
    } catch {}

    // Project data for location
    let projectLocation = "";
    try {
      const proj = await procoreFetchSafe(
        `/rest/v1.0/projects/${projectId}?company_id=${encodeURIComponent(String(companyId))}`,
        { method: "GET" },
        String(companyId),
        String(session.userId)
      );
      if (proj.ok) projectLocation = buildProjectLocationTwoLine(proj.data);
    } catch {}

    // Locked requirements
    const contractor = "Sessa Sheet Metal Contractors, Inc.";

    const preparedBy = String(aha.header?.preparedByNameTitle || "").trim();
    const preparedNorm = normalizeName(preparedBy);
    const isPatPrepared = preparedNorm === "pat lowrie" || preparedNorm.startsWith("pat lowrie ");
    const reviewedBy = isPatPrepared ? "Bobby Sigmon" : "Pat Lowrie";

    // Filename: AHA prefix + Activity + Date
    const activity = sanitizeFilePart(aha.header?.activityWorkTask) || "Activity";
    const date = sanitizeFilePart(aha.header?.datePrepared) || new Date().toISOString().slice(0, 10);
    const filename = `AHA - ${activity} - ${date}.pdf`;

    safeSetText(form, "ActivityWork Task", clampOneLine(aha.header?.activityWorkTask, 60), { fontSize: 10 });

    // Project Location: must be 2-line format; preserve newline between the two lines
    safeSetWrappedTextNoEllipsis({
      form,
      fieldName: "Project Location",
      value: projectLocation || aha.header?.projectLocation || "",
      font,
      maxFontSize: 10,
      minFontSize: 8,
      fontStep: 0.25,
      paddingX: 1.5,
      paddingY: 1.5,
      lineHeightMult: 1.0,
      compress: true,
      preserveNewlines: true,
    });

    safeSetText(form, "Contractor", clampOneLine(contractor, 40), { fontSize: 10 });
    safeSetText(form, "Date Prepared", clampOneLine(aha.header?.datePrepared, 12), { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", clampOneLine(preparedBy, 38), { fontSize: 10 });
    safeSetText(form, "Reviewed by NameTitle", clampOneLine(reviewedBy, 38), { fontSize: 10 });

    // Notes: clean + compress; must throw if too long
    const notesClean = cleanNotes(aha.header?.notes || "");
    safeSetWrappedTextNoEllipsis({
      form,
      fieldName: "Notes Field Notes Review Comments",
      value: notesClean,
      font,
      maxFontSize: 9,
      minFontSize: 6.5,
      fontStep: 0.25,
      paddingX: 2.0,
      paddingY: 2.0,
      lineHeightMult: 1.0,
      compress: true,
      preserveNewlines: false,
    });

    // Job Steps / Hazards / Controls: compress to fit; must throw if too long
    const rows = Array.isArray(aha.jobStepRows) ? aha.jobStepRows : [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const index = i + 1;

      safeSetWrappedTextNoEllipsis({
        form,
        fieldName: `Job StepsRow${index}`,
        value: row.step,
        font,
        maxFontSize: 9,
        minFontSize: 6.5,
        fontStep: 0.25,
        paddingX: 1.5,
        paddingY: 1.5,
        lineHeightMult: 1.0,
        compress: true,
        preserveNewlines: false,
      });

      safeSetWrappedTextNoEllipsis({
        form,
        fieldName: `HazardsRow${index}`,
        value: row.hazards,
        font,
        maxFontSize: 9,
        minFontSize: 6.5,
        fontStep: 0.25,
        paddingX: 1.5,
        paddingY: 1.5,
        lineHeightMult: 1.0,
        compress: true,
        preserveNewlines: false,
      });

      safeSetWrappedTextNoEllipsis({
        form,
        fieldName: `ControlsRow${index}`,
        value: row.controls,
        font,
        maxFontSize: 9,
        minFontSize: 6.5,
        fontStep: 0.25,
        paddingX: 1.5,
        paddingY: 1.5,
        lineHeightMult: 1.0,
        compress: true,
        preserveNewlines: false,
      });

      safeSetText(form, `RACRow${index}`, clampOneLine(row.rac, 2), { fontSize: 9 });
    }

    // Equipment / Training / Inspection: keep one-line, no ellipsis
    const equipment = Array.isArray(aha.resources?.equipmentToBeUsed) ? aha.resources.equipmentToBeUsed : [];
    const training = Array.isArray(aha.resources?.training) ? aha.resources.training : [];
    const inspection = Array.isArray(aha.resources?.inspectionRequirements) ? aha.resources.inspectionRequirements : [];

    for (let i = 0; i < 5; i++) {
      const index = i + 1;
      safeSetText(form, `Equipment to be UsedRow${index}`, clampOneLine(equipment[i], 40), { fontSize: 9 });
      safeSetText(form, `TrainingRow${index}`, clampOneLine(training[i], 40), { fontSize: 9 });
      safeSetText(form, `Inspection RequirementsRow${index}`, clampOneLine(inspection[i], 40), { fontSize: 9 });
    }

    try {
      form.updateFieldAppearances(font);
    } catch {}

    form.flatten();
    const filledBytes = await pdfDoc.save();

    // --- Procore upload workflow (unchanged) ---
    const upload = await procoreCreateProjectUpload({
      companyId: String(companyId),
      userId: String(session.userId),
      projectId: String(projectId),
      filename,
    });

    await s3PostUpload({
      uploadUrl: upload.url,
      fields: upload.fields,
      fileBytes: filledBytes,
      filename,
    });

    const createdFile = await procoreCreateProjectFile({
      companyId: String(companyId),
      userId: String(session.userId),
      projectId: String(projectId),
      parentFolderId: String(completedFolderId),
      uploadId: upload.id || upload.upload_id || upload.uploadId || null,
      uploadUuid: upload.uuid || null,
      filename,
    });

    return NextResponse.json({
      ok: true,
      filename,
      completedFolderId,
      upload: { id: upload.id || null, uuid: upload.uuid || null },
      file: createdFile,
    });
  } catch (err) {
    const msg = err?.message || "Unknown error";

    // Do NOT swallow this error
    if (msg.startsWith("Text string too long:")) {
      return jsonError(400, "Text string too long", {
        field: msg.replace("Text string too long:", "").trim(),
      });
    }

    return jsonError(500, msg);
  }
}
