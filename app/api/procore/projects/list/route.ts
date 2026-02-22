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

  const r = await procoreFetchSafe("/rest/v1.0/projects?per_page=25", {}, companyId, session.userId);

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: "Procore error", details: r }, { status: 500 });
  }

  // return a small sample so UI is stable
  const sample =
    Array.isArray(r.data)
      ? r.data.slice(0, 10).map((p: any) => ({
          id: p.id,
          project_number: p.project_number,
          name: p.name,
        }))
      : r.data;

  return NextResponse.json({ ok: true, sample });
}
