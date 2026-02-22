// lib/procoreDocuments.js
// lib/procoreDocuments.js

function normalizeFolderSegment(s) {
  return String(s || "")
    .trim()
    // normalize unicode (turns some “lookalikes” into consistent forms)
    .normalize("NFKC")
    // unify apostrophes/quotes to straight ASCII
    .replace(/[’‘‛`´]/g, "'")
    .replace(/[“”]/g, '"')
    // collapse whitespace
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getFolderDisplayName(folder) {
  // Procore folder objects commonly use `name`.
  // Some endpoints/versions may use `title`.
  return folder?.name ?? folder?.title ?? folder?.display_name ?? "";
}

async function listFolderChildren({ procoreFetch, companyId, projectId, folderId }) {
  // List root contents when folderId is null/undefined:
  // GET /rest/v1.0/folders?project_id=...
  // List a folder’s contents when folderId is provided:
  // GET /rest/v1.0/folders/{id}?project_id=...
  const path = folderId
    ? `/rest/v1.0/folders/${folderId}?project_id=${encodeURIComponent(projectId)}`
    : `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}`;

  const data = await procoreFetch(path, {
    method: "GET",
    headers: {
      "Procore-Company-Id": String(companyId),
    },
  });

  // Procore returns children in `files` for these endpoints (folders + files mixed).
  // We only care about folders while walking.
  const items = Array.isArray(data?.files) ? data.files : Array.isArray(data) ? data : [];
  const foldersOnly = items.filter((it) => it?.is_folder === true || it?.folder === true || it?.type === "folder");

  return foldersOnly;
}

/**
 * Resolves a folder by walking segments from the project documents root.
 * Returns the final folder object or null.
 */
export async function resolveFolderWithDocumentsFix({
  procoreFetch,
  companyId,
  projectId,
  pathSegments,
}) {
  if (!companyId || !projectId || !Array.isArray(pathSegments) || pathSegments.length === 0) {
    return null;
  }

  // 1) Start at project docs root
  let currentFolderId = null;
  let children = await listFolderChildren({ procoreFetch, companyId, projectId, folderId: null });

  // 2) Walk segments
  for (const seg of pathSegments) {
    const target = normalizeFolderSegment(seg);

    const found = children.find((f) => normalizeFolderSegment(getFolderDisplayName(f)) === target);

    if (!found) {
      return null;
    }

    currentFolderId = found.id;

    // Fetch next level
    children = await listFolderChildren({ procoreFetch, companyId, projectId, folderId: currentFolderId });
  }

  // 3) Return the final folder object (best effort: refetch last node so caller gets consistent shape)
  if (!currentFolderId) return null;

  const finalFolder = await procoreFetch(
    `/rest/v1.0/folders/${currentFolderId}?project_id=${encodeURIComponent(projectId)}`,
    {
      method: "GET",
      headers: { "Procore-Company-Id": String(companyId) },
    }
  );

  // Some responses return the folder itself, others wrap. Prefer the folder-ish object.
  return finalFolder?.id ? finalFolder : (finalFolder?.folder ?? null);
}
