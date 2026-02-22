export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../../lib/procoreAuth";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    const companyId = process.env.PROCORE_COMPANY_ID;

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing PROCORE_COMPANY_ID env var" },
        { status: 500 }
      );
    }

    // Call Procore folders endpoint WITH company_id
    const resp = await procoreFetch(
      `/rest/v1.0/folders?project_id=${projectId}&company_id=${companyId}`
    );

    const data = await resp.json();

    return NextResponse.json({
      ok: true,
      companyId,
      projectId,
      folderCount: Array.isArray(data) ? data.length : null,
      folders: data,
    });

  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
