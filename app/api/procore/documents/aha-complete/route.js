import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------- small helpers ----------
const cleanOneLine = (s) =>
  String(s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clampOneLine = (s, max) => {
  const t = cleanOneLine(s);
  if (!max || max <= 0) return t;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

const cleanMulti = (s) =>
  String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const clampMulti = (s, maxChars) => {
  const t = cleanMulti(s);
  if (!maxChars || maxChars <= 0) return t;
  return t.length > maxChars ? t.slice(0, maxChars - 1).trimEnd() + "…" : t;
};

function slugifyFilenamePart(s) {
  return cleanOneLine(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function nextVersionedName(baseName, existingNames) {
  if (!existingNames.has(baseName)) return baseName;

  const dot = baseName.lastIndexOf(".");
  const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot >= 0 ? baseName.slice(dot) : "";

  for (let v = 2; v < 100; v++) {
    const candidate = `${stem} (v${v})${ext}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

async function fetchTemplatePdfBytes({ origin, companyId, projectId, fileId, cookieHeader }) {
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

async function listFolderFiles({ companyId, userId, projectId, folderId }) {
  const r = await procoreFetchSafe(
    `/rest/v1.0/folders/${encodeURIComponent(folderId)}?project_id=${encodeURIComponent(projectId)}`,
    { method: "GET" },
    companyId,
    userId
  );
  if (!r.ok) throw new Error(`Folder list failed: ${r.status} ${JSON.stringify(r.data)}`);

  const files = Array.isArray(r.data?.files) ? r.data.files : [];
  return files.map((f) => ({
    id: f?.id ?? null,
    name: f?.name ?? f?.title ?? f?.display_name ?? f?.filename ?? "",
  }));
}

/**
 * STEP A: Create upload instructions + upload bytes to storage
 * STEP B: Create a Project File to "move" the uploaded binary into Documents tool
 *
 * This "create file" step is REQUIRED for the file to appear in Documents.
 */
async function procoreDirectUploadToFolder({ companyId, userId, projectId, folderId, filename, bytes }) {
  // A) create upload instructions (NO parent_id here)
  const create = await procoreFetchSafe(
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/uploads`,
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

  if (!create.ok) {
    throw new Error(`Create upload failed: ${create.status} ${JSON.stringify(create.data)}`);
  }

  const upload = create.data;
  const uploadUuid = upload?.uuid || upload?.id || null;

  if (!uploadUuid || !upload?.url || !upload?.fields) {
    throw new Error(`Upload instructions missing uuid/url/fields: ${JSON.stringify(upload)}`);
  }

  // B) POST multipart form-data to storage (S3)
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) {
    form.append(k, String(v));
  }
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

  const storage = await fetch(upload.url, { method: "POST", body: form, cache: "no-store" });
  if (!(storage.status === 204 || storage.status === 201)) {
    const text = await storage.text().catch(() => "");
    throw new Error(`Storage upload failed: ${storage.status} ${text.slice(0, 500)}`);
  }

  // C) Create Project File (associate upload UUID into Documents folder)
  // Procore endpoint is POST /rest/v1.0/files with project_id param and multipart form-data:
  // file[parent_id], file[name], file[upload_uuid]
  const createFileForm = new FormData();
  createFileForm.append("file[parent_id]", String(folderId));
  createFileForm.append("file[name]", String(filename));
  createFileForm.append("file[upload_uuid]", String(uploadUuid));

  const createFile = await procoreFetchSafe(
    `/rest/v1.0/files?project_id=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      body: createFileForm,
      // DO NOT set Content-Type; fetch will set multipart boundary
    },
    companyId,
    userId
  );

  if (!createFile.ok) {
    throw new Error(`Create file failed: ${createFile.status} ${JSON.stringify(createFile.data)}`);
  }

  const fileId = createFile.data?.id ?? createFile.data?.file?.id ?? null;

  return { uploadUuid, fileId };
}

// pdf-lib fill: copy of your existing safe setters (kept minimal)
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
    const body = await req.json().catch(() => ({}));
    const { company_id, project_id, template_file_id, completed_folder_id, aha, filename } = body;

    if (!company_id || !project_id || !template_file_id || !aha) {
      return NextResponse.json(
        { ok: false, error: "Missing company_id, project_id, template_file_id, or aha" },
        { status: 400 }
      );
    }

    // --- session ---
    const raw = cookies().get(getSessionCookieName())?.value;
    const session = readSessionValue(raw);

    if (!session?.companyId || !session?.userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (String(session.companyId) !== String(company_id)) {
      return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
    }

    // --- resolve completed folder if not provided ---
    let completedFolderId = completed_folder_id;
    if (!completedFolderId) {
      const origin = new URL(req.url).origin;
      const res = await fetch(new URL("/api/procore/documents/resolve", origin).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.get("cookie") || "" },
        body: JSON.stringify({ company_id, project_id }),
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok || !j?.completedFolder?.id) {
        return NextResponse.json(
          { ok: false, error: "Failed to resolve Completed folder", details: j },
          { status: 500 }
        );
      }
      completedFolderId = String(j.completedFolder.id);
    }

    // --- download template ---
    const templateBytes = await fetchTemplatePdfBytes({
      origin: new URL(req.url).origin,
      companyId: company_id,
      projectId: project_id,
      fileId: template_file_id,
      cookieHeader: req.headers.get("cookie") || "",
    });

    // --- fill ---
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    try {
      form.updateFieldAppearances(font);
    } catch {}

    // Header
    safeSetText(form, "ActivityWork Task", clampOneLine(aha?.header?.activityWorkTask, 60), { fontSize: 10 });
    safeSetText(form, "Project Location", clampOneLine(aha?.header?.projectLocation, 40), { fontSize: 10 });
    safeSetText(form, "Contractor", clampOneLine(aha?.header?.contractor, 28), { fontSize: 10 });
    safeSetText(form, "Date Prepared", clampOneLine(aha?.header?.datePrepared, 12), { fontSize: 10 });
    safeSetText(form, "Prepared by NameTitle", clampOneLine(aha?.header?.preparedByNameTitle, 38), { fontSize: 10 });
    safeSetText(form, "Reviewed by NameTitle", clampOneLine(aha?.header?.reviewedByNameTitle, 38), { fontSize: 10 });

    safeSetText(form, "Notes Field Notes Review Comments", clampMulti(aha?.header?.notes, 240), {
      multiline: true,
      fontSize: 9,
    });

    const rows = Array.isArray(aha?.jobStepRows) ? aha.jobStepRows : [];
    for (let i = 0; i < 5; i++) {
      const row = rows[i] || {};
      const idx = i + 1;
      safeSetText(form, `Job StepsRow${idx}`, clampOneLine(row.step, 55), { fontSize: 9 });
      safeSetText(form, `HazardsRow${idx}`, clampOneLine(row.hazards, 55), { fontSize: 9 });
      safeSetText(form, `ControlsRow${idx}`, clampOneLine(row.controls, 85), { fontSize: 9 });
      safeSetText(form, `RACRow${idx}`, clampOneLine(row.rac, 2), { fontSize: 9 });
    }

    const equipment = Array.isArray(aha?.resources?.equipmentToBeUsed) ? aha.resources.equipmentToBeUsed : [];
    const training = Array.isArray(aha?.resources?.training) ? aha.resources.training : [];
    const inspection = Array.isArray(aha?.resources?.inspectionRequirements)
      ? aha.resources.inspectionRequirements
      : [];

    for (let i = 0; i < 5; i++) {
      const idx = i + 1;
      safeSetText(form, `Equipment to be UsedRow${idx}`, clampOneLine(equipment[i], 40), { fontSize: 9 });
      safeSetText(form, `TrainingRow${idx}`, clampOneLine(training[i], 40), { fontSize: 9 });
      safeSetText(form, `Inspection RequirementsRow${idx}`, clampOneLine(inspection[i], 40), { fontSize: 9 });
    }

    try {
      form.updateFieldAppearances(font);
    } catch {}

    form.flatten();
    const filledBytes = await pdfDoc.save();

    // --- safe naming + versioning ---
    const date = cleanOneLine(aha?.header?.datePrepared) || new Date().toISOString().slice(0, 10);
    const activity = slugifyFilenamePart(aha?.header?.activityWorkTask || "aha");
    const baseName = filename ? String(filename) : `AHA-${date}-${activity || "activity"}.pdf`;

    const existing = await listFolderFiles({
      companyId: company_id,
      userId: session.userId,
      projectId: project_id,
      folderId: completedFolderId,
    });
    const existingNames = new Set(existing.map((x) => x.name));
    const finalName = nextVersionedName(baseName, existingNames);

    // --- upload + move into Procore ---
    let uploadRes;
    try {
      uploadRes = await procoreDirectUploadToFolder({
        companyId: company_id,
        userId: session.userId,
        projectId: project_id,
        folderId: completedFolderId,
        filename: finalName,
        bytes: new Uint8Array(filledBytes),
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: "Procore error during upload/create-file",
          stage: "upload_or_create_file",
          message: e?.message || String(e),
          completedFolderId,
          filename: finalName,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      completedFolderId,
      filename: finalName,
      upload: uploadRes, // includes uploadUuid + fileId
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
