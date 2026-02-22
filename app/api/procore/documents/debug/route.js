export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const parentFolderId = searchParams.get("parentFolderId"); // optional

    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const qs = new URLSearchParams({ project_id: String(projectId) });
    if (parentFolderId) qs.set("parent_id", String(parentFolderId)); // try parent_id first

    const resp = await procoreFetch(`/rest/v1.0/folders?${qs.toString()}`);
    const data = await resp.json();

    return NextResponse.json({ ok: true, projectId, parentFolderId: parentFolderId || null, data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
