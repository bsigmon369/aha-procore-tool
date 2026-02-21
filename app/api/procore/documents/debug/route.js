export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const parentId = searchParams.get("parentId");

  const qs = new URLSearchParams({ project_id: projectId });

  if (parentId) {
    qs.set("parent_folder_id", parentId); // ← IMPORTANT
  }

  const resp = await procoreFetch(`/rest/v1.0/folders?${qs.toString()}`);
  const data = await resp.json();
  return NextResponse.json(data);
}
