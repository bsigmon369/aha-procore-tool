import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { procoreFetchSafe } from "@/lib/procoreAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing company_id" }, { status: 400 });
  }

  // Check if we have a company-scoped token (fallback)
  const companyKey = `procore:rt:${companyId}`;
  const hasCompanyToken = Boolean(await kv.get<string>(companyKey));

  // Check if we have any user-scoped token (we don't know the user id yet)
  // So we just report company token existence for now.

  // Try calling /me using companyId with userId omitted (will work only after we add company-scope fallback logic)
  const r = await procoreFetchSafe(`/rest/v1.0/me`, {}, companyId, undefined as any);

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    companyId,
    hasCompanyToken,
    me: r.data,
  });
}
