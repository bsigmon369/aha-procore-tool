import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

/**
 * MVP approach:
 * - List root folders
 * - Walk down by folder name segments
 * This avoids needing you to know folder IDs up front.
 */
async function listFolders(projectId, parentFolderId = null) {
  const qs = new URLSearchParams();
  if (parentFolderId) qs.set("parent_folder_id", parentFolderId);

  const path = `/rest/v1.0/projects/${projectId}/folders?${qs.toString()}`;
  const resp = await procoreFetch(path);
  return await resp.json();
}

async function findFolderByPath(projectId, folderPath) {
  const parts = folderPath.split("/").map(s => s.trim()).filter(Boolean);

  let parentId = null;
  let current = null;

  for (const name of parts) {
    const folders = await listFolders(projectId, parentId);
    current = folders.find(f => (f.name || "").trim() === name);

    if (!current) {
      return null;
    }
    parentId = current.id;
  }

  return current; // {id, name, ...}
}

export async function POST(request) {
  const body = await request.json();
  const projectId = body.projectId;

  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const templatePath = "Documents / 09 Submittals / 01 AHA's / 01 AHA Template";
  const completedPath = "Documents / 09 Submittals / 01 AHA's / 02 Completed AHA's";

  const templateFolder = await findFolderByPath(projectId, templatePath);
  const completedFolder = await findFolderByPath(projectId, completedPath);

  return NextResponse.json({
    templateFolder,
    completedFolder
  });
}
