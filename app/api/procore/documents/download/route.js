import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const fileId = searchParams.get("file_id") || searchParams.get("fileId") || "";

    if (!companyId || !projectId || !fileId) {
      return NextResponse.json(
        { ok: false, error: "Missing company_id, project_id, or file_id" },
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

    // Step 1: fetch file metadata to get a usable download URL
    // Procore file "show" endpoint:
    // GET /rest/v1.0/files/{id}?project_id=...
    const metaPath = `/rest/v1.0/files/${encodeURIComponent(fileId)}?project_id=${encodeURIComponent(projectId)}`;
    const meta = await procoreFetchSafe(metaPath, { method: "GET" }, companyId, session.userId);

    if (!meta.ok) {
      return NextResponse.json(
        { ok: false, error: "Procore file meta error", status: meta.status, url: meta.url, data: meta.data },
        { status: 500 }
      );
    }

    const file = meta.data;
    const downloadUrl =
      file?.download_url ||
      file?.downloadUrl ||
      file?.file_versions?.[0]?.download_url ||
      file?.file_versions?.[0]?.downloadUrl ||
      file?.file_versions?.[0]?.url ||
      file?.file_versions?.[0]?.prostore_file?.url ||
      file?.file_versions?.[0]?.prostore_file?.download_url ||
      null;

    if (!downloadUrl) {
      return NextResponse.json(
        { ok: false, error: "No download_url found on file metadata", file },
        { status: 500 }
      );
    }

    // Step 2: fetch the binary from Procore using the same auth wrapper
    // NOTE: procoreFetchSafe returns JSON; for binary we do a direct fetch with Authorization
    // We can get a fresh access token via procoreFetchSafe by requesting the download URL directly.
    // But procoreFetchSafe is built for API paths; so we do a normal fetch using the tool’s auth cookies is not possible.
    //
    // Instead: ask Procore API for a signed URL is already what download_url is.
    // download_url is typically a signed URL that does NOT require Authorization.
    const binRes = await fetch(downloadUrl, { method: "GET", cache: "no-store" });

    if (!binRes.ok) {
      const text = await binRes.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "Failed to download file binary", status: binRes.status, body: text.slice(0, 500) },
        { status: 500 }
      );
    }

    const arrayBuffer = await binRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const filename = file?.name || file?.filename || "template.pdf";

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
