import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Lists folder contents in Procore Documents for a project.
 *
 * Query params supported:
 * - company_id / companyId
 * - project_id / projectId
 * - folder_id / folderId (optional; if omitted, lists root)
 *
 * Returns:
 * { ok, folderId, count, items }
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const companyId =
      searchParams.get("company_id") ||
      searchParams.get("companyId") ||
      process.env.PROCORE_COMPANY_ID ||
      process.env.PROCORE_DEFAULT_COMPANY_ID ||
      "";

    const projectId = searchParams.get("project_id") || searchParams.get("projectId") || "";
    const folderId = searchParams.get("folder_id") || searchParams.get("folderId") || "";

    if (!companyId || !projectId) {
      return NextResponse.json(
        { ok: false, error: "Missing company_id/companyId or project_id/projectId" },
        { status: 400 }
      );
    }

    const raw = cookies().get(getSessionCookieName())?.value;
    const session = readSessionValue(raw);

    if (!session?.companyId || !session?.userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (String(session.companyId) !== String(companyId)) {
      return NextResponse.json({ ok: false, error: "Session/company mismatch" }, { status: 401 });
    }

    // Correct Procore endpoints:
    // - root:   /rest/v1.0/folders?project_id=...
    // - folder: /rest/v1.0/folders/{id}?project_id=...
    const path = folderId
      ? `/rest/v1.0/folders/${encodeURIComponent(folderId)}?project_id=${encodeURIComponent(projectId)}`
      : `/rest/v1.0/folders?project_id=${encodeURIComponent(projectId)}`;

    const r = await procoreFetchSafe(path, { method: "GET" }, companyId, session.userId);

    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: "Procore error", status: r.status, url: r.url, data: r.data },
        { status: 500 }
      );
    }

    // Procore shapes vary:
    // - root list can be array or {files:[...]}
    // - folder show is usually {files:[...]} (mixed files + folders)
    const payload = r.data;
    const itemsRaw = Array.isArray(payload?.files)
      ? payload.files
      : Array.isArray(payload)
      ? payload
      : [];

    const items = itemsRaw.map((x) => {
      const isFolder =
        x?.is_folder === true ||
        x?.folder === true ||
        String(x?.type || "").toLowerCase() === "folder";

      return {
        id: x?.id ?? null,
        name: x?.name ?? x?.title ?? x?.display_name ?? x?.filename ?? "",
        type: x?.type ?? (isFolder ? "folder" : "file"),
        isFolder,
        // helpful debugging fields:
        contentType: x?.content_type ?? null,
        updatedAt: x?.updated_at ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      folderId: folderId || null,
      count: items.length,
      items,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
