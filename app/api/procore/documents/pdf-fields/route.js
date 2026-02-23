import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionValue, getSessionCookieName } from "../../../../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchPdfBytes({ origin, companyId, projectId, fileId, cookieHeader }) {
  const url = new URL("/api/procore/documents/download", origin);
  url.searchParams.set("company_id", String(companyId));
  url.searchParams.set("project_id", String(projectId));
  url.searchParams.set("file_id", String(fileId));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Cookie: cookieHeader || "" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download route failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function GET(req) {
  try {
    const { searchParams, origin } = new URL(req.url);

    const companyId = searchParams.get("company_id") || "";
    const projectId = searchParams.get("project_id") || "";
    const fileId = searchParams.get("file_id") || "";

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

    const { PDFDocument } = await import("pdf-lib");

    const cookieHeader = req.headers.get("cookie") || "";
    const pdfBytes = await fetchPdfBytes({ origin, companyId, projectId, fileId, cookieHeader });

    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const out = fields.map((f) => {
      const type = f.constructor?.name || "UnknownField";
      let name = "";
      try {
        name = f.getName();
      } catch {
        name = "";
      }
      return { name, type };
    });

    return NextResponse.json({
      ok: true,
      fieldCount: out.length,
      fields: out,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
