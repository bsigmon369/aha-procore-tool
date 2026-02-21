import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.PROCORE_CLIENT_ID,
    client_secret: process.env.PROCORE_CLIENT_SECRET,
    redirect_uri: process.env.PROCORE_REDIRECT_URI,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json({ error: "Token exchange failed", data }, { status: 500 });
  }

  // Store refresh token in KV (source of truth)
  if (data.refresh_token) {
    await kv.set("procore:refresh_token", data.refresh_token);
  }

  // Return safe confirmation (does NOT leak token)
  return NextResponse.json({
    ok: true,
    storedInKV: Boolean(data.refresh_token),
    refreshTokenLength: data.refresh_token?.length || 0,
    expires_in: data.expires_in,
    scope: data.scope,
  });
}
