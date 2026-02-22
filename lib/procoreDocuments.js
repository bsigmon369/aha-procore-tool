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
