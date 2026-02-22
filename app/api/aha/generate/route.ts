import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RacCode = "E" | "H" | "M" | "L";

function highestRac(rows: Array<{ rac?: RacCode }>): RacCode {
  // E > H > M > L
  const rank: Record<RacCode, number> = { E: 4, H: 3, M: 2, L: 1 };
  let best: RacCode = "L";
  for (const r of rows || []) {
    const v = r?.rac;
    if (v && rank[v] > rank[best]) best = v;
  }
  return best;
}

function extractJsonTextFromResponsesApi(payload: any): string | null {
  // The Responses API may return:
  // - payload.output_text (SDK convenience; may or may not be present)
  // - payload.output[].content[].text (common)
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const out = payload?.output;
  if (!Array.isArray(out)) return null;

  const chunks: string[] = [];
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      // Most common shape: { type: "output_text", text: "..." }
      if (typeof c?.text === "string" && c.text.trim()) chunks.push(c.text);
    }
  }

  const joined = chunks.join("\n").trim();
  return joined || null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const companyId = String(body?.companyId || "").trim();
    const projectId = String(body?.projectId || "").trim();
    const sentence = String(body?.sentence || "").trim();

    if (!companyId || !projectId || !sentence) {
      return NextResponse.json(
        { ok: false, error: "Missing companyId, projectId, or sentence" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    // Default model: fast + cost-effective for structured JSON.
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10); // YYYY-MM-DD

    // Strict JSON Schema for AHA v1
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["meta", "header", "jobStepRows", "resources", "competentQualified", "verificationSignatures", "modifiedReviewedSignatures"],
      properties: {
        meta: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "generatedAtIso", "sourceSentence", "companyId", "projectId"],
          properties: {
            schemaVersion: { type: "string", enum: ["1.0"] },
            generatedAtIso: { type: "string" },
            sourceSentence: { type: "string" },
            companyId: { type: "string" },
            projectId: { type: "string" },
          },
        },
        header: {
          type: "object",
          additionalProperties: false,
          required: [
            "activityWorkTask",
            "projectLocation",
            "contractor",
            "datePrepared",
            "preparedByNameTitle",
            "reviewedByNameTitle",
            "notes",
            "overallRac",
          ],
          properties: {
            activityWorkTask: { type: "string" },
            projectLocation: { type: "string" },
            contractor: { type: "string" },
            datePrepared: { type: "string" },
            preparedByNameTitle: { type: "string" },
            reviewedByNameTitle: { type: "string" },
            notes: { type: "string" },
            overallRac: { type: "string", enum: ["E", "H", "M", "L"] },
          },
        },
        jobStepRows: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["step", "hazards", "controls", "rac"],
            properties: {
              step: { type: "string" },
              hazards: { type: "string" },
              controls: { type: "string" },
              rac: { type: "string", enum: ["E", "H", "M", "L"] },
              probability: {
                type: "string",
                enum: ["Frequent", "Likely", "Occasional", "Seldom", "Unlikely"],
              },
              severity: {
                type: "string",
                enum: ["Catastrophic", "Critical", "Marginal", "Negligible"],
              },
            },
          },
        },
        resources: {
          type: "object",
          additionalProperties: false,
          required: ["equipmentToBeUsed", "training", "inspectionRequirements"],
          properties: {
            equipmentToBeUsed: { type: "array", items: { type: "string" } },
            training: { type: "array", items: { type: "string" } },
            inspectionRequirements: { type: "array", items: { type: "string" } },
          },
        },
        competentQualified: {
          type: "object",
          additionalProperties: false,
          required: ["rows"],
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["activity", "designatedPerson"],
                properties: {
                  activity: { type: "string" },
                  designatedPerson: { type: "string" },
                  proofRequired: { type: "boolean" },
                  proofNote: { type: "string" },
                },
              },
            },
          },
        },
        verificationSignatures: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["namePrint", "date"],
            properties: {
              namePrint: { type: "string" },
              signature: { type: "string" },
              date: { type: "string" },
            },
          },
        },
        modifiedReviewedSignatures: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["namePrint", "date"],
            properties: {
              namePrint: { type: "string" },
              signature: { type: "string" },
              date: { type: "string" },
            },
          },
        },
      },
    };

    const system = [
      "You are a construction safety professional generating an Activity Hazard Analysis (AHA) for a General Contractor.",
      "Return ONLY valid JSON matching the provided schema.",
      "Be specific, practical, and trade-appropriate. Prefer controls that are enforceable and verifiable (permits, inspections, competent person, barricades, PPE, LOTO, lifts, housekeeping, exclusion zones, etc.).",
      "Generate at least 3 job steps even if the input sentence is short.",
      "Use RAC codes: E (Extremely High), H (High), M (Moderate), L (Low).",
    ].join(" ");

    const user = [
      `Company ID: ${companyId}`,
      `Project ID: ${projectId}`,
      `Date Prepared: ${today}`,
      `One-sentence activity description: ${sentence}`,
      "",
      "If you must assume missing details, state them in header.notes.",
      "Set header.contractor to a reasonable value if unknown (e.g., 'Subcontractor').",
      "Set preparedByNameTitle and reviewedByNameTitle to placeholders if unknown.",
      "Project location can be 'On-site (see Procore project)' if unknown.",
    ].join("\n");

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // Structured Outputs (strict JSON Schema)
        text: {
  format: {
    type: "json_schema",
    name: "aha_v1",
    schema,
    strict: true,
  },
},
        // keep costs predictable
        temperature: 0.2,
      }),
    });

    const openaiPayload = await openaiRes.json();

if (!openaiRes.ok) {
  return NextResponse.json(
    { ok: false, error: "OpenAI error", details: openaiPayload },
    { status: 502 }
  );
}

// Try to find JSON text in the response
const jsonText =
  (typeof openaiPayload?.output_text === "string" && openaiPayload.output_text.trim()) ||
  (() => {
    const out = openaiPayload?.output;
    if (!Array.isArray(out)) return null;
    const chunks: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === "string" && c.text.trim()) chunks.push(c.text);
      }
    }
    const joined = chunks.join("\n").trim();
    return joined || null;
  })();

if (!jsonText) {
  // show payload so we can adjust extraction if OpenAI changes shape
  return NextResponse.json(
    { ok: false, error: "OpenAI returned no JSON text", details: openaiPayload },
    { status: 502 }
  );
}

let aha: any;
try {
  aha = JSON.parse(jsonText);
} catch {
  return NextResponse.json(
    { ok: false, error: "Failed to parse JSON from model output", raw: jsonText },
    { status: 502 }
  );
}
    // Server-side normalization (don’t trust the model for these fields)
    aha.meta = {
      schemaVersion: "1.0",
      generatedAtIso: nowIso,
      sourceSentence: sentence,
      companyId,
      projectId,
    };

    // Ensure required header fields exist (fallbacks)
    aha.header = aha.header || {};
    aha.header.datePrepared = aha.header.datePrepared || today;
    aha.header.projectLocation = aha.header.projectLocation || "On-site (see Procore project)";
    aha.header.contractor = aha.header.contractor || "Subcontractor";
    aha.header.preparedByNameTitle = aha.header.preparedByNameTitle || "TBD";
    aha.header.reviewedByNameTitle = aha.header.reviewedByNameTitle || "TBD";
    aha.header.notes = aha.header.notes || "";

    // Compute overallRac as the highest RAC found in jobStepRows
    const rows = Array.isArray(aha.jobStepRows) ? aha.jobStepRows : [];
    aha.header.overallRac = highestRac(rows);

    return NextResponse.json({ ok: true, aha });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
