import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const companyId =
    searchParams.get("company_id") ||
    process.env.PROCORE_COMPANY_ID ||
    process.env.PROCORE_DEFAULT_COMPANY_ID ||
    "";

  const returnTo = searchParams.get("return_to") || "/app";

  if (!companyId) {
    return NextResponse.json(
      {
        error:
          "Missing companyId. Provide ?company_id=### or set PROCORE_COMPANY_ID (or PROCORE_DEFAULT_COMPANY_ID) in env.",
      },
      { status: 400 }
    );
  }

  const baseUrl = process.env.PROCORE_BASE_URL!;
  const clientId = process.env.PROCORE_CLIENT_ID!;
  const redirectUri = process.env.PROCORE_REDIRECT_URI!;

  const nonce = crypto.randomUUID();

  await kv.set(
    `oauth:state:${nonce}`,
    { companyId: String(companyId), returnTo: String(returnTo) },
    { ex: 300 }
  );

  const state = Buffer.from(JSON.stringify({ nonce })).toString("base64url");

  const authorizeUrl =
    `${baseUrl}/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authorizeUrl);
}
