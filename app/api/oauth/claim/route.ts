import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { createSessionValue, getSessionCookieName } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const nonce = searchParams.get("nonce") || "";
  const companyId = searchParams.get("company_id") || "";

  if (!nonce) {
    return NextResponse.json({ ok: false, error: "Missing nonce" }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing company_id" }, { status: 400 });
  }

  const claimKey = `oauth:claim:${nonce}`;
  const claim = (await kv.get(claimKey)) as any;

  if (!claim) {
    return NextResponse.json(
      { ok: false, error: "Claim not found or expired. Re-run OAuth.", nonce },
      { status: 400 }
    );
  }

  const claimCompanyId = String(claim.companyId || "");
  const userId = String(claim.userId || "");
  const returnTo = String(claim.returnTo || "/app");

  if (!claimCompanyId || !userId) {
    return NextResponse.json(
      { ok: false, error: "Invalid claim payload", claim },
      { status: 500 }
    );
  }

  // Prevent cross-company reuse
  if (String(companyId) !== claimCompanyId) {
    return NextResponse.json(
      { ok: false, error: "Company mismatch", companyId, claimCompanyId },
      { status: 401 }
    );
  }

  const sessionValue = createSessionValue({
    companyId: claimCompanyId,
    userId,
  });

  // IMPORTANT: In embedded iframes, you must use SameSite=None + Secure.
  // Partitioned helps in third-party iframe contexts (CHIPS).
  const cookieName = getSessionCookieName();
  const cookieValue = encodeURIComponent(sessionValue);

  const setCookie = [
    `${cookieName}=${cookieValue}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Partitioned",
  ].join("; ");

  const res = NextResponse.json({ ok: true, returnTo });

  res.headers.append("Set-Cookie", setCookie);

  // One-time use
  await kv.del(claimKey);

  return res;
}
