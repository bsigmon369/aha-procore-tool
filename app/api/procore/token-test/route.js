export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getAccessToken } from "../../../../lib/procoreAuth";

export async function GET() {
  const fingerprint = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    refreshTokenLength: process.env.PROCORE_REFRESH_TOKEN?.length || 0,
    redirectUri: process.env.PROCORE_REDIRECT_URI || null,
  };

  try {
    const token = await getAccessToken();
    return NextResponse.json({ ...fingerprint, ok: true, tokenLength: token.length });
  } catch (err) {
    return NextResponse.json(
      { ...fingerprint, ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
