export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../lib/procoreAuth";

export async function GET() {
  try {
    const resp = await procoreFetch("/rest/v1.0/companies");
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
