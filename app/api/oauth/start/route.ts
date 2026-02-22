import { NextResponse } from "next/server";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id") || "";

  const baseUrl = process.env.PROCORE_BASE_URL!;
  const clientId = process.env.PROCORE_CLIENT_ID!;
  const redirectUri = process.env.PROCORE_REDIRECT_URI!;

  const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");

  const authorizeUrl =
    `${baseUrl}/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authorizeUrl);
}
