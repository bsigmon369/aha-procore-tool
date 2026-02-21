export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getAccessToken } from "../../../../lib/procoreAuth";

export async function GET() {
  try {
    // Force refresh by busting cache (module-level cache)
    // We can’t access the `cached` object directly here, so we force a refresh by calling token endpoint indirectly:
    // easiest: temporarily set a query flag in procoreAuth later, but for now just call getAccessToken() and see if it fails.
    const token = await getAccessToken();
    return NextResponse.json({ ok: true, tokenLength: token.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
