import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSession() {
  const raw = cookies().get(getSessionCookieName())?.value || "";
  return readSessionValue(raw);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const companyId = body.company_id ?? body.companyId;
  const projectId = body.project_id ?? body.projectId;

  const session = getSession();
  if (!session?.companyId || !session?.userId) {
    return NextResponse.json({ ok: false, stage: "auth", error: "Not authenticated" }, { status: 401 });
  }

  const userId = session.userId;

  const urls = [
    {
      stage: "folders_root_no_parent",
      url: `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}`,
    },
    {
      stage: "folders_root_ROOT",
      url: `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}&parent_id=ROOT`,
    },
    {
      stage: "folders_root_0",
      url: `/rest/v1.0/folders?project_id=${encodeURIComponent(String(projectId))}&parent_id=0`,
    },
  ];

  const results = [];
  for (const u of urls) {
    const r = await procoreFetchSafe(u.url, { method: "GET" }, companyId, userId);
    results.push({
      stage: u.stage,
      ok: r.ok,
      status: r.status,
      url: r.url,
      sample: Array.isArray(r.data) ? r.data.slice(0, 5) : r.data,
    });
  }

  return NextResponse.json({ ok: true, companyId: String(companyId), projectId: String(projectId), results });
}
