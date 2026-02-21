// lib/procoreDocuments.js
import { procoreFetch } from "./procoreAuth";

/**
 * Lists child folders/files under a parent folder.
 * For project: GET /rest/v1.0/folders?project_id=...&parent_id=...
 * For company: GET /rest/v1.0/companies/{company_id}/folders?parent_id=...
 *
 * Note: Procore responses vary slightly by account/version.
 * We filter for folder-ish items defensively.
 */
async function listChildren({ scope, projectId, companyId, parentId }) {
  if (scope === "project") {
    const qs = new URLSearchParams();
    qs.set("project_id", String(projectId));
    if (parentId != null) qs.set("parent_id", String(parentId));
    // If parent_id omitted, Procore treats it as root folder children (typical).
    return procoreFetch(`/rest/v1.0/folders?${qs.toString()}`);
  }

  if (scope === "company") {
    if (!companyId) throw new Error("companyId is required for company scope");
    const qs = new URLSearchParams();
    if (parentId != null) qs.set("parent_id", String(parentId));
    return procoreFetch(`/rest/v1.0/companies/${companyId}/folders?${qs.toString()}`);
  }

  throw new Error(`Unknown scope: ${scope}`);
}

function isFolderLike(item) {
  // Procore commonly uses `is_folder`, sometimes `folder` type-ish fields.
  if (!item || typeof item !== "object") return false;
  if (item.is_folder === true) return true;
  if (item.type && String(item.type).toLowerCase().includes("folder")) return true;
  // Some payloads might just return folders from /folders endpoints; assume ok if it has `name` + `id`.
  return typeof item.id !== "undefined" && typeof item.name === "string";
}

function findChildFolderByName(children, name) {
  const target = String(name).trim().toLowerCase();
  return (Array.isArray(children) ? children : [])
    .filter(isFolderLike)
    .find((c) => String(c.name || "").trim().toLowerCase() === target);
}

/**
 * Walks a folder path: ["09 Submittals","01 AHA's","01 AHA Template"]
 * Returns the final folder object or null if any segment missing.
 */
export async function resolveFolderByPath({ scope, projectId, companyId, pathSegments }) {
  let parentId = null; // "root"
  let lastFolder = null;

  for (const seg of pathSegments) {
    const children = await listChildren({ scope, projectId, companyId, parentId });
    const next = findChildFolderByName(children, seg);
    if (!next) return null;

    lastFolder = next;
    parentId = next.id;
  }

  return lastFolder;
}

/**
 * Procore UI shows a "Documents" header; it may NOT be a real folder node.
 * Strategy:
 * - Try with segments as given
 * - If first segment is "Documents", also try without it
 * - If the first attempt fails at the first hop, retry without "Documents" anyway
 */
export async function resolveFolderWithDocumentsFix({ scope, projectId, companyId, rawSegments }) {
  const segments = rawSegments.map(String);

  // Attempt #1: as-is
  const asIs = await resolveFolderByPath({ scope, projectId, companyId, pathSegments: segments });
  if (asIs) return asIs;

  const startsWithDocuments = segments[0]?.trim().toLowerCase() === "documents";
  const withoutDocuments = startsWithDocuments ? segments.slice(1) : segments;

  // Attempt #2: drop "Documents"
  if (withoutDocuments.length !== segments.length) {
    return resolveFolderByPath({ scope, projectId, companyId, pathSegments: withoutDocuments });
  }

  // Attempt #3: if it didn’t start with Documents, still retry dropping it if present somewhere obvious
  // (optional; keep simple: no extra heuristics)
  return null;
}
