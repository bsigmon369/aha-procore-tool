export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const parentId = searchParams.get("parentId"); // optional

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Try BOTH param styles (some accounts differ)
    const url =
      parentId
        ? `/rest/v1.0/folders?project_id=${projectId}&parent_folder_id=${parentId}`
        : `/rest/v1.0/folders?project_id=${projectId}`;

    const resp = await procoreFetch(url);
    const data = await resp.json();

    return NextResponse.json({ url, data });
  } catch (err) {
    // Surface the thrown message from procoreFetch()
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
