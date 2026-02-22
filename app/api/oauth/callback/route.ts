import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  // companyId MUST come from state (not redirect_uri query params)
  let companyId = process.env.PROCORE_DEFAULT_COMPANY_ID || "";
  if (state) {
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8")
      );
      if (decoded?.companyId) companyId = String(decoded.companyId);
    } catch {
      // ignore bad state
    }
  }

  if (!companyId) {
    return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
  }

  const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

  // IMPORTANT: redirect_uri must match authorize redirect_uri EXACTLY
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
    cache: "no-store",
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", data: tokenData },
      { status: 500 }
    );
  }

  // Fetch /me to get user_id
  const meRes = await fetch(`${process.env.PROCORE_BASE_URL}/rest/v1.0/me`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Procore-Company-Id": companyId,
    },
    cache: "no-store",
  });

  const me = await meRes.json();

  if (!meRes.ok || !me?.id) {
    return NextResponse.json(
      { error: "Failed to fetch /me", data: me },
      { status: 500 }
    );
  }

  // Store refresh token per company + user
  if (tokenData.refresh_token) {
    const key = `procore:rt:${companyId}:${me.id}`;
    await kv.set(key, tokenData.refresh_token);
  }

  // After success, redirect back to your app (recommended vs JSON)
  // This avoids users refreshing the callback URL and reusing the one-time code.
  const redirectTo = `/app?company_id=${encodeURIComponent(
    companyId
  )}&user_id=${encodeURIComponent(String(me.id))}`;

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
