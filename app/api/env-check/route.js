export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasRefreshToken: Boolean(process.env.PROCORE_REFRESH_TOKEN),
    refreshTokenLength: process.env.PROCORE_REFRESH_TOKEN?.length || 0,
    redirectUri: process.env.PROCORE_REDIRECT_URI || null,
    clientIdPresent: Boolean(process.env.PROCORE_CLIENT_ID),
    baseUrl: process.env.PROCORE_BASE_URL || null,
  });
}
