import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getAccessToken } from "@/lib/procoreAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const userId = searchParams.get("user_id");

  if (!companyId || !userId) {
    return NextResponse.json({ error: "Missing company_id or user_id" }, { status: 400 });
  }

  // For now: only check whether we already have a refresh token stored for this embedded user
  const key = `procore:rt:${companyId}:${userId}`;
  const refreshToken = await kv.get<string>(key);

  if (!refreshToken) {
    return NextResponse.json({ ok: false, reason: "no_refresh_token" }, { status: 401 });
  }

  // TEMP: this proves we can get an access token (your procoreAuth currently uses global KV/env token)
  // Next step will be refactoring procoreAuth to accept refreshToken/companyId/userId.
  await getAccessToken();

  return NextResponse.json({
    ok: true,
    companyId,
    userId,
  });
}
