import { NextResponse } from "next/server";

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
  return NextResponse.json(data);
}
