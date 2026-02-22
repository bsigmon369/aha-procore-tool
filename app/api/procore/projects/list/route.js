export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export async function GET() {
  const companyId = process.env.PROCORE_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing PROCORE_COMPANY_ID" }, { status: 500 });
  }

  const r = await procoreFetchSafe(`/rest/v1.0/projects?company_id=${companyId}`, {
    headers: { "Procore-Company-Id": String(companyId) },
  });

  // return only a sample to keep payload small
  const sample =
    Array.isArray(r.data) ? r.data.slice(0, 5).map(p => ({
      id: p.id,
      project_number: p.project_number,
      name: p.name
    })) : r.data;

  return NextResponse.json({ ok: r.ok, status: r.status, companyId, sample });
}
