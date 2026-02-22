export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "@/lib/procoreAuth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const companyId = searchParams.get("company_id");
  const userId = searchParams.get("user_id");

  if (!companyId || !userId) {
    return NextResponse.json(
      { ok: false, error: "Missing company_id or user_id" },
      { status: 400 }
    );
  }

  const r = await procoreFetchSafe(
  `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}`,
  {},
  companyId,
  userId
);

  const sample =
    Array.isArray(r.data)
      ? r.data.slice(0, 5).map((p: any) => ({
          id: p.id,
          project_number: p.project_number,
          name: p.name,
        }))
      : r.data;

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    companyId,
    userId,
    sample,
  });
}
