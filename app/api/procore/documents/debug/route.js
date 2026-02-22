export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";
import { listProjectDocumentsV2 } from "../../../../../lib/procoreDocumentsV2";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // Probe legacy v1 folders (what you tried)
  const v1 = await procoreFetchSafe(`/rest/v1.0/folders?project_id=${projectId}`);

  // Probe v2 documents (newer)
  const v2 = await listProjectDocumentsV2(projectId);

  return NextResponse.json({
    ok: true,
    projectId,
    probes: {
      v1Folders: { ok: v1.ok, status: v1.status, url: v1.url, sample: v1.data },
      v2Documents: { ok: v2.ok, status: v2.status, url: v2.url, sample: v2.data },
    },
  });
}
