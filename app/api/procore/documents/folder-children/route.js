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
  const folderId = body.folder_id ?? body.folderId;

  const session = getSession();
  if (!session?.companyId || !session?.userId) {
    return NextResponse.json({ ok: false, stage: "auth", message: "Not authenticated" }, { status: 401 });
  }

  const userId = session.userId;

  const pid = encodeURIComponent(String(projectId));
  const fid = encodeURIComponent(String(folderId));

  const listUrl = `/rest/v1.0/folders?project_id=${pid}&parent_id=${fid}`;
  const showUrl = `/rest/v1.0/folders/${fid}?project_id=${pid}`;

  const listResp = await procoreFetchSafe(listUrl, { method: "GET" }, companyId, userId);
  const showResp = await procoreFetchSafe(showUrl, { method: "GET" }, companyId, userId);

  return NextResponse.json({
    ok: true,
    inputs: { companyId: String(companyId), projectId: String(projectId), folderId: String(folderId) },
    list: {
      ok: listResp.ok,
      status: listResp.status,
      url: listResp.url,
      type: Array.isArray(listResp.data) ? "array" : typeof listResp.data,
      keys: listResp.data && typeof listResp.data === "object" && !Array.isArray(listResp.data)
        ? Object.keys(listResp.data).slice(0, 30)
        : null,
      sample: listResp.data,
    },
    show: {
      ok: showResp.ok,
      status: showResp.status,
      url: showResp.url,
      type: Array.isArray(showResp.data) ? "array" : typeof showResp.data,
      keys: showResp.data && typeof showResp.data === "object" && !Array.isArray(showResp.data)
        ? Object.keys(showResp.data).slice(0, 30)
        : null,
      sample: showResp.data,
    },
  });
}
