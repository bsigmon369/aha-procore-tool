export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import { kv } from "@vercel/kv";

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const redirectUri = process.env.PROCORE_REDIRECT_URI || null;

  const kvToken = (await kv.get("procore:refresh_token")) || "";
  const envToken = process.env.PROCORE_REFRESH_TOKEN || "";
  const pick = kvToken || envToken;

  const fp = {
    commit,
    redirectUri,
    kvRefreshTokenLength: kvToken.length,
    kvRefreshTokenHash: kvToken ? crypto.createHash("sha256").update(kvToken).digest("hex").slice(0, 10) : null,
    envRefreshTokenLength: envToken.length,
    envRefreshTokenHash: envToken ? crypto.createHash("sha256").update(envToken).digest("hex").slice(0, 10) : null,
    using: kvToken ? "kv" : "env",
  };

  try {
    const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: pick,
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
      return NextResponse.json({ ...fp, ok: false, tokenEndpoint: tokenUrl, data }, { status: 500 });
    }

    // ✅ THIS IS THE KEY FIX: persist rotated token
    if (data.refresh_token && data.refresh_token !== pick) {
      await kv.set("procore:refresh_token", data.refresh_token);
    }

    return NextResponse.json({
      ...fp,
      ok: true,
      expires_in: data.expires_in,
      access_token_length: data.access_token?.length || 0,
      rotated_refresh_token_returned: Boolean(data.refresh_token),
      rotated_refresh_token_saved_to_kv: Boolean(data.refresh_token && data.refresh_token !== pick),
    });
  } catch (err) {
    return NextResponse.json({ ...fp, ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
