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

  return Boolean(item.id && (item.name || item.title || item.display_name || item.displayName));
}

/**
 * If caller provides procoreFetch, it might return:
 * - a Response
 * - already-parsed JSON
 * We normalize to JSON object.
 */
async function toJsonMaybe(x) {
  if (!x) return x;
  if (typeof x.json === "function") {
    return await x.json().catch(() => null);
  }
  return x;
}

/**
 * Low-level fetch that returns parsed JSON.
 * Uses either:
 *  - explicit procoreFetch passed in (preferred when provided)
 *  - procoreFetchSafe from lib/procoreAuth
 */
async function procoreGetJson({ procoreFetch, path, companyId, userId }) {
  if (typeof procoreFetch === "function") {
    const respOrJson = await procoreFetch(path, {
      method: "GET",
      headers: { "Procore-Company-Id": String(companyId) },
    });
    return await toJsonMaybe(respOrJson);
  }

  // procoreFetchSafe returns { ok, data, status, url }
  const r = await procoreFetchSafe(path, { method: "GET" }, companyId, userId);

  if (!r.ok) {
    throw new Error(`Procore API error ${r.status} on ${r.url}: ${JSON.stringify(r.data)}`);
  }

  return r.data;
}

/**
 * Extract child folders from any of Procore's common shapes.
 */
function extractChildFolders(payload) {
  const items =
    (Array.isArray(payload?.folders) && payload.folders) ||
    (Array.isArray(payload?.subfolders) && payload.subfolders) ||
    (Array.isArray(payload?.children) && payload.children) ||
    (Array.isArray(payload?.folder?.folders) && payload.folder.folders) ||
    (Array.isArray(payload?.folder?.children) && payload.folder.children) ||
    // Some endpoints mix folders + files in `files`
    (Array.isArray(payload?.files) && payload.files) ||
    (Array.isArray(payload) && payload) ||
    [];

  return items.filter(isFolderish);
}

/**
 * List immediate child folders:
 * - root: GET /rest/v1.0/folders?project_id=...
 * - folder: GET /rest/v1.0/folders/{id}?project_id=...
 */
async function listFolderChildren({ procoreFetch, companyId, userId, projectId, folderId }) {
  const path = folderId
    ? `/rest/v1.0/folders/${encodeURIComponent(folderId)}?project_id=${encodeURIComponent(projectId)}`
    : `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}`;

  const payload = await procoreGetJson({ procoreFetch, path, companyId, userId });
  return extractChildFolders(payload);
}

/**
 * Core walk: resolves by matching each segment against folder display names.
 * Returns {id, name} or null.
 */
async function resolveFolderByPath({ procoreFetch, companyId, userId, projectId, pathSegments }) {
  if (!companyId || !projectId || !Array.isArray(pathSegments) || pathSegments.length === 0) {
    return null;
  }

  let currentFolderId = null;
  let children = await listFolderChildren({ procoreFetch, companyId, userId, projectId, folderId: null });

  for (const seg of pathSegments) {
    const target = normalizeFolderSegment(seg);
    const found = children.find((f) => normalizeFolderSegment(getFolderDisplayName(f)) === target);

    if (!found) return null;

    currentFolderId = found.id;
    children = await listFolderChildren({ procoreFetch, companyId, userId, projectId, folderId: currentFolderId });
  }

  if (!currentFolderId) return null;

  // Refetch final folder for stable shape across tenants
  const finalPayload = await procoreGetJson({
    procoreFetch,
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
 * Supports:
 *  - resolveFolderWithDocumentsFix({ scope:"project", projectId, companyId, rawSegments })
 *  - resolveFolderWithDocumentsFix({ procoreFetch, projectId, companyId, pathSegments })
 */
export async function resolveFolderWithDocumentsFix(args = {}) {
  const {
    scope,
    projectId,
    companyId,
    userId,
    rawSegments,
    pathSegments,
    procoreFetch,
  } = args;

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
    procoreFetch,
    companyId,
    userId,
    projectId,
    pathSegments: segments,
  });
}
