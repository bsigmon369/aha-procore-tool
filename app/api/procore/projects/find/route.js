export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const targetProjectId = searchParams.get("projectId");
  if (!targetProjectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const companiesResp = await procoreFetchSafe("/rest/v1.0/companies");
  if (!companiesResp.ok) {
    return NextResponse.json({ step: "companies", ...companiesResp }, { status: 500 });
  }

  const companies = companiesResp.data || [];
  const tried = [];

  for (const c of companies) {
    const r = await procoreFetchSafe(
      `/rest/v1.0/projects/${targetProjectId}?company_id=${c.id}`,
      { headers: { "Procore-Company-Id": String(c.id) } }
    );

    tried.push({
      companyId: c.id,
      companyName: c.name,
      ok: r.ok,
      status: r.status,
      sample: r.ok ? { id: r.data?.id, name: r.data?.name } : r.data,
    });

    if (r.ok) {
      return NextResponse.json({
        ok: true,
        projectId: targetProjectId,
        matchedCompany: { id: c.id, name: c.name },
        project: r.data,
        tried,
      });
    }
  }

  return NextResponse.json({
    ok: false,
    projectId: targetProjectId,
    message: "Project not found under any accessible company context for this token.",
    tried,
  });
}
