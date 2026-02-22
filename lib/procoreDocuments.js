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
  // Strong file hints:
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

  // Heuristic: if it has id + name/title and doesn't look like a file, treat as folder-ish.
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
    // Response-like
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
      headers: {
        "Procore-Company-Id": String(companyId),
      },
    });
    return await toJsonMaybe(respOrJson);
  }

  // Use procoreFetchSafe which returns { ok, data, status, url }
  const r = await procoreFetchSafe(
    path,
    { method: "GET" },
    companyId,
    userId
  );

  if (!r.ok) {
    throw new Error(
      `Procore API error ${r.status} on ${r.url}: ${JSON.stringify(r.data)}`
    );
  }

  return r.data;
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
 * List immediate children folders for:
 * - root: GET /rest/v1.0/folders?project_id=...
 * - folder: GET /rest/v1.0/folders/{id}?project_id=...
 */
async function listFolderChildren({ procoreFetch, companyId, userId, projectId, folderId }) {
  const path = folderId
    ? `/rest/v1.0/folders/${encodeURIComponent(folderId)}?project_id=${encodeURIComponent(projectId)}`
    : `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}`;

  const data = await procoreGetJson({ procoreFetch, path, companyId, userId });
  return extractChildFolders(data);
}

/**
 * Core resolver: walk path segments by name/title under the project documents root.
 * Returns { id, name } or null.
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

  // Best-effort: fetch folder details to return stable shape
  const finalData = await procoreGetJson({
    procoreFetch,
    path: `/rest/v1.0/folders/${encodeURIComponent(currentFolderId)}?project_id=${encodeURIComponent(projectId)}`,
    companyId,
    userId,
  });

  // Some tenants wrap as { folder: {...} }
  const folderObj = finalData?.id ? finalData : finalData?.folder ?? null;
  if (!folderObj?.id) return null;

  return { id: folderObj.id, name: folderObj.name ?? folderObj.title ?? folderObj.display_name ?? String(seg) };
}

/**
 * Public API — supports BOTH signatures:
 *
 * A) Your current route usage:
 *    resolveFolderWithDocumentsFix({ scope:"project", projectId, companyId, rawSegments, userId })
 *
 * B) Explicit fetch usage:
 *    resolveFolderWithDocumentsFix({ procoreFetch, projectId, companyId, pathSegments, userId })
 */
export async function resolveFolderWithDocumentsFix(args = {}) {
  // Legacy signature support
  const scope = args.scope;
  const rawSegments = args.rawSegments;
  const pathSegments = args.pathSegments;

  const companyId = args.companyId;
  const projectId = args.projectId;
  const userId = args.userId; // optional; works even if undefined in your current setup
  const procoreFetch = args.procoreFetch; // optional

  // You only use project scope today; keep it strict so failures are obvious.
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
