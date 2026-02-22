export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const companyId = process.env.PROCORE_COMPANY_ID;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ error: "Missing PROCORE_COMPANY_ID" }, { status: 500 });
    }

    // ✅ Correct Documents tool endpoint (project)
    const resp = await procoreFetch(`/rest/v1.0/projects/${projectId}/folders?company_id=${companyId}`);
    const data = await resp.json();

    return NextResponse.json({
      ok: true,
      projectId,
      companyId,
      count: Array.isArray(data) ? data.length : null,
      folders: data,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
