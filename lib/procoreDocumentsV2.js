import { procoreFetchSafe } from "./procoreAuth";

function normalizeName(s) {
  return (s || "").trim();
}

/**
 * Procore v2 Project Documents:
 * GET /rest/v2.0/projects/{project_id}/documents
 * Returns folders/files. We'll filter folders and walk by parent reference.
 */
export async function listProjectDocumentsV2(projectId) {
  const r = await procoreFetchSafe(`/rest/v2.0/projects/${projectId}/documents`);
  return r;
}

/**
 * Build a folder tree index from v2 documents response.
 * We handle multiple possible shapes to be safe:
 * - array of items
 * - { data: [...] }
 * - { items: [...] }
 */
function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.data && Array.isArray(payload.data)) return payload.data;
  if (payload?.items && Array.isArray(payload.items)) return payload.items;
  return [];
}

function isFolder(item) {
  const t = (item?.type || item?.item_type || item?.resource_type || "").toLowerCase();
  return t.includes("folder") || item?.is_folder === true;
}

function getParentId(item) {
  // handle common variants
  return (
    item?.parent_id ??
    item?.parent_folder_id ??
    item?.parentFolderId ??
    item?.parent?.id ??
    null
  );
}

export function findFolderByPathV2(items, pathSegments) {
  const folders = items.filter(isFolder);

  // index folders by parentId -> list
  const byParent = new Map();
  for (const f of folders) {
    const pid = getParentId(f);
    const key = pid == null ? "root" : String(pid);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }

  let currentParentKey = "root";
  let currentFolder = null;

  for (const seg of pathSegments) {
    const wanted = normalizeName(seg);
    const candidates = byParent.get(currentParentKey) || [];

    const next = candidates.find((x) => normalizeName(x.name) === wanted);
    if (!next) return null;

    currentFolder = next;
    currentParentKey = String(next.id);
  }

  return currentFolder
    ? { id: currentFolder.id, name: currentFolder.name }
    : null;
}
