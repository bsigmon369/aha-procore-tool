export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../lib/procoreAuth"; // you already added this earlier

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  // 1) list companies this token can access
  const companies = await procoreFetchSafe("/rest/v1.0/companies");
  if (!companies.ok) {
    return NextResponse.json({ step: "companies", ...companies }, { status: 500 });
  }

  // 2) try each company context until project resolves
  for (const c of companies.data || []) {
    const attempt = await procoreFetchSafe(`/rest/v1.0/projects/${projectId}`, {
      headers: { "Procore-Company-Id": String(c.id) },
    });

    if (attempt.ok) {
      return NextResponse.json({
        ok: true,
        projectId,
        company: { id: c.id, name: c.name },
        project: attempt.data,
      });
    }
  }

  return NextResponse.json(
    { ok: false, projectId, error: "Project not found in any accessible company for this token." },
    { status: 404 }
  );
}
