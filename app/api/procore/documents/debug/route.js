export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  const fingerprint = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    refreshTokenLength: process.env.PROCORE_REFRESH_TOKEN?.length || 0,
    redirectUri: process.env.PROCORE_REDIRECT_URI || null,
  };

  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ ...fingerprint, error: "Missing projectId" }, { status: 400 });
    }

    const resp = await procoreFetch(`/rest/v1.0/folders?project_id=${projectId}`);
    const data = await resp.json();

    return NextResponse.json({ ...fingerprint, ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ...fingerprint, ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
