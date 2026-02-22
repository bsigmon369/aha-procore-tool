import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "@/lib/session";
import { procoreFetchSafe } from "@/lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id") || "";

  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing company_id" }, { status: 400 });
  }

  const raw = cookies().get(getSessionCookieName())?.value;
  const session = readSessionValue(raw);

  if (!session?.companyId || !session?.userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  if (String(session.companyId) !== String(companyId)) {
    return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
  }

  const me = await procoreFetchSafe("/rest/v1.0/me", {}, companyId, session.userId);

  if (!me.ok) {
    return NextResponse.json({ ok: false, error: "Token invalid", details: me }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    companyId: String(companyId),
    userId: String(session.userId),
    me: me.data,
  });
}
