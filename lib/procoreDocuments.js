// lib/procoreDocuments.js
import { procoreFetchSafe } from "./procoreAuth";

/**
 * Normalize folder names to avoid Procore UI vs API mismatches:
 * - trims
 * - normalizes unicode
 * - converts curly apostrophes to straight apostrophe
 * - collapses whitespace
 * - lowercases
 */
function normalizeFolderSegment(s) {
  return String(s || "")
    .trim()
    .normalize("NFKC")
    .replace(/[’‘‛`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getFolderDisplayName(folder) {
  return folder?.name ?? folder?.title ?? folder?.display_name ?? folder?.displayName ?? "";
}

function looksLikeFile(item) {
  if (item?.file_versions) return true;
  if (item?.download_url) return true;
  if (item?.checksum) return true;
  return false;
}

function isFolderish(item) {
  if (!item) return false;
  if (item.is_folder === true) return true;
  if (item.folder === true) return true;
  if ((item.type || "").toLowerCase() === "folder") return true;
  if (looksLikeFile(item)) return false;

  // If it has id + a name/title and doesn't look like a file, treat as folder-ish.
  return Boolean(item.id && (item.name || item.title || item.display_name || item.displayName));
}

/**
 * Extract child folders from any of Procore's common shapes.
 */
function extractChildFolders(payload) {
  const items =
    // "show folder" responses often expose folders separately
    (Array.isArray(payload?.folders) && payload.folders) ||
    (Array.isArray(payload?.subfolders) && payload.subfolders) ||
    (Array.isArray(payload?.children) && payload.children) ||
    // sometimes it's nested
    (Array.isArray(payload?.folder?.folders) && payload.folder.folders) ||
    (Array.isArray(payload?.folder?.children) && payload.folder.children) ||
    // "list root" often returns array OR {files:[...]} (mixed files+folders)
    (Array.isArray(payload?.files) && payload.files) ||
    (Array.isArray(payload) && payload) ||
    [];

  return items.filter(isFolderish);
}

/**
 * Procore GET returning parsed JSON via your existing procoreFetchSafe helper.
 */
async function procoreGetJson({ path, companyId, userId }) {
  const r = await procoreFetchSafe(path, { method: "GET" }, companyId, userId);

  if (!r.ok) {
    throw new Error(`Procore API error ${r.status} on ${r.url}: ${JSON.stringify(r.data)}`);
  }

  return r.data;
}

/**
 * List immediate children folders for:
 * - root: GET /rest/v1.0/folders?project_id=...
 * - folder: GET /rest/v1.0/folders/{id}?project_id=...
 */
async function listFolderChildren({ companyId, userId, projectId, folderId }) {
  const path = folderId
    ? `/rest/v1.0/folders/${encodeURIComponent(folderId)}?project_id=${encodeURIComponent(projectId)}`
    : `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}`;

  const payload = await procoreGetJson({ path, companyId, userId });
  return extractChildFolders(payload);
}

/**
 * Core walk: resolves by matching each segment against folder display names.
 * Returns {id, name} or null.
 */
async function resolveFolderByPath({ companyId, userId, projectId, pathSegments }) {
  if (!companyId || !projectId || !Array.isArray(pathSegments) || pathSegments.length === 0) {
    return null;
  }

  let currentFolderId = null;
  let children = await listFolderChildren({ companyId, userId, projectId, folderId: null });

  for (const seg of pathSegments) {
    const target = normalizeFolderSegment(seg);

    const found = children.find((f) => normalizeFolderSegment(getFolderDisplayName(f)) === target);
    if (!found) return null;

    currentFolderId = found.id;

    // IMPORTANT: next level may come back under `folders` not `files`
    children = await listFolderChildren({ companyId, userId, projectId, folderId: currentFolderId });
  }

  if (!currentFolderId) return null;

  // Refetch final folder for stable shape across tenants
  const finalPayload = await procoreGetJson({
    path: `/rest/v1.0/folders/${encodeURIComponent(currentFolderId)}?project_id=${encodeURIComponent(projectId)}`,
    companyId,
    userId,
  });

  const folderObj = finalPayload?.id ? finalPayload : finalPayload?.folder ?? null;
  if (!folderObj?.id) return null;

  return {
    id: folderObj.id,
    name: folderObj.name ?? folderObj.title ?? folderObj.display_name ?? folderObj.displayName ?? "",
  };
}

/**
 * Public export used by your route.js.
 *
 * Signature your route uses:
 *   resolveFolderWithDocumentsFix({ scope:"project", projectId, companyId, userId, rawSegments })
 */
export async function resolveFolderWithDocumentsFix(args = {}) {
  const { scope, projectId, companyId, userId, rawSegments, pathSegments } = args;

  if (scope && scope !== "project") {
    throw new Error(`resolveFolderWithDocumentsFix: unsupported scope "${scope}" (expected "project")`);
  }

  const segments = Array.isArray(pathSegments)
    ? pathSegments
    : Array.isArray(rawSegments)
    ? rawSegments
    : null;

  if (!segments || segments.length === 0) return null;

  return await resolveFolderByPath({
    companyId,
    userId,
    projectId,
    pathSegments: segments,
  });
}
