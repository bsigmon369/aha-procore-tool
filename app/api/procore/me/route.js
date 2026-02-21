export const dynamic = "force-dynamic";
export const revalidate = 0;
import { NextResponse } from "next/server";
import { procoreFetch } from "../../../../lib/procoreAuth";

export async function GET() {
  // Procore "me" endpoint (returns the user tied to the token)
  const resp = await procoreFetch("/rest/v1.0/me");
  const data = await resp.json();
  return NextResponse.json(data);
}
