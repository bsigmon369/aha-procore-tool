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

// --- resolve helpers (same behavior as your resolve route) ---
async function procoreGet({ companyId, userId, url }) {
  const r = await procoreFetchSafe(url, { method: "GET" }, companyId, userId);
  if (!r.ok) {
    const msg = r?.data?.message || JSON.stringify(r?.data || {});
    throw new Error(`Procore GET failed ${r.status} ${url}: ${msg}`);
  }
  return r.data;
}

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

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
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

function findFolderByName(children, targetName) {
  const t = String(targetName || "").trim();
  const exact = children.find((c) => String(c.name || "").trim() === t);
  if (exact) return exact;
  const tl = t.toLowerCase();
  return children.find((c) => String(c.name || "").trim().toLowerCase() === tl) || null;
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

// --- PDF field helpers (mirrors aha-fill route style) ---
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

// --- Procore direct upload workflow (non-segmented) ---
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

  // expected: { uuid, url, fields }
  return r.data;
}

async function s3PostUpload({ uploadUrl, fields, fileBytes, filename }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) {
    fd.append(k, String(v));
  }
  // IMPORTANT: key must be "file"
  fd.append("file", new Blob([fileBytes], { type: "application/pdf" }), filename);

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: fd,
    // DO NOT send Authorization headers to S3
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Storage upload failed ${res.status}: ${text.slice(0, 500)}`);
  }
}

async function procoreCreateProjectFile({ companyId, userId, projectId, parentFolderId, uploadUuid, filename }) {
  // Per Procore “Project Folders and Files” patterns: POST /rest/v1.0/files?project_id=...
  const pid = encodeURIComponent(String(projectId));
  const r = await procoreFetchSafe(
    `/rest/v1.0/files?project_id=${pid}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: {
          parent_id: String(parentFolderId),
          upload_id: String(uploadUuid),
          name: String(filename),
        },
      }),
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

// Keep GET for quick sanity/manual check if you ever hit it in a browser
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
    if (!session?.companyId || !session?.userId) {
      return jsonError(401, "Not authenticated");
    }
    if (String(session.companyId) !== String(companyId)) {
      return jsonError(401, "Session/company mismatch", {
        sessionCompanyId: String(session.companyId),
        requestCompanyId: String(companyId),
      });
    }

    // Resolve completed folder if not provided
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

    // Download template PDF bytes (from Procore file id)
    const cookieHeader = req.headers.get("cookie") || "";
    const pdfBytes = await fetchPdfBytes({
      origin: new URL(req.url).origin,
      companyId,
      projectId,
      fileId: templateFileId,
      cookieHeader,
    });

    // Fill PDF (same as aha-fill for now)
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    try {
      form.updateFieldAppearances(font);
    } catch {}

    // ===== HEADER =====
    safeSetText(form, "ActivityWork Task", clampOneLine(aha.header?.activityWorkTask, 60), { fontSize: 10 });
    safeSetText(form, "Project Location", clampOneLine(aha.header?.projectLocation, 40), { fontSize: 10 });
    safeSetText(form, "Contractor", clampOneLine(aha.header?.contractor, 28), { fontSize: 10 });
    safeSetText(form, "Date Prepared", clampOneLine(aha.header?.datePrepared, 12), { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", clampOneLine(aha.header?.preparedByNameTitle, 38), { fontSize: 10 });

    // Reviewed-by default logic (normalized compare)
    const preparedNorm = normalizeName(aha.header?.preparedByNameTitle);
    const reviewedDefault = preparedNorm === normalizeName("Pat Lowrie") ? "Bobby Sigmon" : "Pat Lowrie";
    const reviewedValue = cleanOneLine(aha.header?.reviewedByNameTitle) || reviewedDefault;
    safeSetText(form, "Reviewed by NameTitle", clampOneLine(reviewedValue, 38), { fontSize: 10 });

    safeSetText(
      form,
      "Notes Field Notes Review Comments",
      clampMulti(aha.header?.notes, 240),
      { multiline: true, fontSize: 9 }
    );

    // ===== JOB STEPS (still one-line clamps here; you’ll update wrapping in your main punchlist pass) =====
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

    try {
      form.updateFieldAppearances(font);
    } catch {}

    form.flatten();
    const filledBytes = await pdfDoc.save();

    // Build filename (simple + safe)
    const safeProjectId = String(projectId).replace(/[^\w.-]+/g, "-");
    const filename = `AHA-${safeProjectId}.pdf`;

    // 1) Create project upload instructions
    const upload = await procoreCreateProjectUpload({
      companyId,
      userId: session.userId,
      projectId,
      filename,
    });

    // 2) Upload to storage provider
    await s3PostUpload({
      uploadUrl: upload.url,
      fields: upload.fields,
      fileBytes: filledBytes,
      filename,
    });

    // 3) Move/associate into Procore Documents folder
    const createdFile = await procoreCreateProjectFile({
      companyId,
      userId: session.userId,
      projectId,
      parentFolderId: completedFolderId,
      uploadUuid: upload.uuid,
      filename,
    });

    return NextResponse.json({
      ok: true,
      filename,
      completedFolderId,
      uploadUuid: upload.uuid,
      file: createdFile,
    });
  } catch (err) {
    return jsonError(500, err?.message || "Unknown error");
  }
}
