export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "Agora";

  const companiesResp = await procoreFetchSafe("/rest/v1.0/companies");
  if (!companiesResp.ok) return NextResponse.json(companiesResp, { status: 500 });

  const matches = [];

  for (const c of companiesResp.data || []) {
    const r = await procoreFetchSafe(`/rest/v1.0/projects?company_id=${c.id}`, {
      headers: { "Procore-Company-Id": String(c.id) },
    });

    if (!r.ok || !Array.isArray(r.data)) continue;

    for (const p of r.data) {
      const name = (p?.name || "").toLowerCase();
      const num = String(p?.project_number || "").toLowerCase();
      const id = String(p?.id || "");
      const qq = q.toLowerCase();

      if (name.includes(qq) || num.includes(qq) || id === q) {
        matches.push({
          companyId: c.id,
          companyName: c.name,
          id: p.id,
          project_number: p.project_number,
          name: p.name,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, q, matches });
}
