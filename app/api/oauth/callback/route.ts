import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getSessionCookieName, createSessionValue } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  let companyId = searchParams.get("company_id") || process.env.PROCORE_DEFAULT_COMPANY_ID || "";
  let returnTo = searchParams.get("return_to") || "/app";

  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      if (decoded?.companyId) companyId = String(decoded.companyId);
      if (decoded?.returnTo) returnTo = String(decoded.returnTo);
    } catch {}
  }

  if (!companyId) {
    return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
  }

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
    cache: "no-store",
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", data: tokenData }, { status: 500 });
  }

  // Fetch /me to resolve Procore user id
  const meRes = await fetch(`${process.env.PROCORE_BASE_URL}/rest/v1.0/me`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Procore-Company-Id": companyId,
    },
    cache: "no-store",
  });

  const me = await meRes.json();

  if (!meRes.ok || !me?.id) {
    return NextResponse.json({ error: "Failed to fetch /me", data: me }, { status: 500 });
  }

  // Store refresh token per company+user (and company-level last)
  if (tokenData.refresh_token) {
    await kv.set(`procore:rt:${companyId}:${me.id}`, tokenData.refresh_token);
    await kv.set(`procore:rt:${companyId}`, tokenData.refresh_token);
  }

  // Set HttpOnly session cookie (so embedded mode does NOT need user_id in URL)
  const sessionValue = createSessionValue({
    companyId: String(companyId),
    userId: String(me.id),
  });

  const res = NextResponse.redirect(new URL(returnTo, request.url));
  res.cookies.set({
  name: getSessionCookieName(),
  value: sessionValue,
  httpOnly: true,
  sameSite: "none",
  secure: true,
  path: "/",
  });

  return res;
}
