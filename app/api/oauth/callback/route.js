import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // TEMP: in your current setup, you can pass company_id through state or query.
  // For now, fallback to env/default company id.
  const companyId =
    searchParams.get("company_id") ||
    process.env.PROCORE_DEFAULT_COMPANY_ID ||
    "";

  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

  const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.PROCORE_CLIENT_ID!,
    client_secret: process.env.PROCORE_CLIENT_SECRET!,
    redirect_uri: process.env.PROCORE_REDIRECT_URI!,
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", data: tokenData }, { status: 500 });
  }

  // Fetch /me to get user_id
  const meRes = await fetch(`${process.env.PROCORE_BASE_URL}/rest/v1.0/me`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Procore-Company-Id": companyId,
    },
  });

  const me = await meRes.json();
  if (!meRes.ok || !me?.id) {
    return NextResponse.json({ error: "Failed to fetch /me", data: me }, { status: 500 });
  }

  // Store refresh token per company+user
  if (tokenData.refresh_token) {
    const key = `procore:rt:${companyId}:${me.id}`;
    await kv.set(key, tokenData.refresh_token);
  }

  return NextResponse.json({
    ok: true,
    companyId,
    userId: me.id,
    storedInKV: Boolean(tokenData.refresh_token),
    expires_in: tokenData.expires_in,
    scope: tokenData.scope,
  });
}
