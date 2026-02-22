import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { refreshAccessToken } from "../../../../../lib/procore/procoreAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const userId = searchParams.get("user_id");

  if (!companyId || !userId) {
    return NextResponse.json({ error: "Missing company_id or user_id" }, { status: 400 });
  }

  const key = `procore:rt:${companyId}:${userId}`;
  const refreshToken = await kv.get<string>(key);

  if (!refreshToken) {
    // This tells the client: "no token yet, run OAuth"
    return NextResponse.json({ ok: false, reason: "no_refresh_token" }, { status: 401 });
  }

  const token = await refreshAccessToken(refreshToken);

  // If Procore rotates refresh tokens, update KV
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await kv.set(key, token.refresh_token);
  }

  // Return access token ONLY to server usage if you can.
  // If you must return to client, return short-lived token and keep scope minimal.
  return NextResponse.json({
    ok: true,
    companyId,
    userId,
    expires_in: token.expires_in,
    access_token: token.access_token,
  });
}
