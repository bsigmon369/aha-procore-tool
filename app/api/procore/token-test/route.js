export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  const refreshToken = process.env.PROCORE_REFRESH_TOKEN || "";
  const fingerprint = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    refreshTokenLength: refreshToken.length,
    refreshTokenHash: refreshToken ? crypto.createHash("sha256").update(refreshToken).digest("hex").slice(0, 10) : null,
    redirectUri: process.env.PROCORE_REDIRECT_URI || null,
  };

  try {
    const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.PROCORE_CLIENT_ID,
      client_secret: process.env.PROCORE_CLIENT_SECRET,
    });

    const r = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await r.json();

    if (!r.ok) {
      return NextResponse.json({ ...fingerprint, ok: false, tokenEndpoint: tokenUrl, data }, { status: 500 });
    }

    return NextResponse.json({
      ...fingerprint,
      ok: true,
      token_type: data.token_type,
      expires_in: data.expires_in,
      access_token_length: data.access_token?.length || 0,
    });
  } catch (err) {
    return NextResponse.json({ ...fingerprint, ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
