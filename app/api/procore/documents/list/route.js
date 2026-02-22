export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

/**
 * Lists folder contents in Procore Documents for a project.
 * If folderId is omitted, it lists the project root Documents folder contents.
 *
 * Query params supported:
 * - companyId / projectId (current deployed style)
 * - company_id / project_id (preferred)
 * - folderId / folder_id (optional)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const companyId =
      searchParams.get("company_id") ||
      searchParams.get("companyId") ||
      process.env.PROCORE_COMPANY_ID ||
      "";

    const projectId = searchParams.get("project_id") || searchParams.get("projectId") || "";
    const folderId = searchParams.get("folder_id") || searchParams.get("folderId") || "";

    if (!companyId || !projectId) {
      return NextResponse.json({ ok: false, error: "Missing companyId/company_id or projectId/project_id" }, { status: 400 });
    }

    const raw = cookies().get(getSessionCookieName())?.value;
    const session = readSessionValue(raw);

    if (!session?.companyId || !session?.userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (String(session.companyId) !== String(companyId)) {
      return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
    }

    // Procore documents listing
    const qs = new URLSearchParams();
    qs.set("project_id", String(projectId));
    if (folderId) qs.set("folder_id", String(folderId));

    const r = await procoreFetchSafe(`/rest/v1.0/folders?${qs.toString()}`, {}, companyId, session.userId);

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: "Procore error", details: r }, { status: 500 });
    }

    // Normalize for easier human scanning
    const items = Array.isArray(r.data) ? r.data : [];
    const out = items.map((x) => ({
      id: x?.id ?? x?.folder_id ?? x?.file_id ?? null,
      name: x?.name ?? "",
      isFolder: x?.is_folder ?? (x?.type === "folder") ?? null,
      type: x?.type ?? null,
    }));

    return NextResponse.json({ ok: true, count: out.length, items: out });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
