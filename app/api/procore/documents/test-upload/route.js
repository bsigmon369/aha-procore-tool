import { NextResponse } from "next/server";
import { procoreFetchSafe } from "../../../../../lib/procoreAuth";

export async function POST(req) {
  try {
    const body = await req.json();
    const { companyId, projectId, folderId } = body;

    if (!companyId || !projectId || !folderId) {
      return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });
    }

    const content = Buffer.from("Test file from AHA tool\n", "utf8");

    // Step 1: Create upload
    const create = await procoreFetchSafe(
      `/rest/v1.0/projects/${projectId}/uploads`,
      {
        method: "POST",
        headers: { "Procore-Company-Id": String(companyId) },
        body: JSON.stringify({
          response_filename: "test.txt",
          parent_id: folderId,
        }),
      },
      companyId
    );

    if (!create.ok) {
      return NextResponse.json({ ok: false, stage: "create", data: create.data });
    }

    const upload = create.data;

    // Step 2: PUT file to S3
    const s3 = await fetch(upload.url, {
      method: "PUT",
      headers: upload.fields,
      body: content,
    });

    if (!s3.ok) {
      return NextResponse.json({ ok: false, stage: "s3", status: s3.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
