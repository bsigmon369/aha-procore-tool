"use client";

import { useState } from "react";

export default function DebugFillPage() {
  const [companyId, setCompanyId] = useState("598134325682533");
  const [projectId, setProjectId] = useState("598134325942002");
  const [fileId, setFileId] = useState("598134507269529");
  const [jsonText, setJsonText] = useState(`{
  "header": {
    "activityWorkTask": "Installation of 24x24 fire damper in 2nd floor wall with fire caulk",
    "projectLocation": "Level 2 Corridor",
    "contractor": "Sessa Sheet Metal",
    "datePrepared": "2026-02-22",
    "preparedByNameTitle": "Bobby Sigmon, President",
    "reviewedByNameTitle": "Project Manager",
    "notes": "Standard fire damper install."
  },
  "jobStepRows": [
    {
      "step": "Access work area",
      "hazards": "Fall hazard",
      "controls": "Use ladder safely",
      "rac": "H"
    }
  ],
  "resources": {
    "equipmentToBeUsed": ["Ladder", "Fire damper"],
    "training": ["Working at heights"],
    "inspectionRequirements": ["Ladder inspection"]
  }
}`);

  const [status, setStatus] = useState<string>("");

  async function generate() {
    setStatus("Generating…");

    let ahaObj: any;
    try {
      ahaObj = JSON.parse(jsonText);
    } catch (e: any) {
      setStatus("JSON error: " + (e?.message || "invalid JSON"));
      return;
    }

    try {
      const res = await fetch("/api/procore/documents/aha-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          project_id: projectId,
          file_id: fileId,
          aha: ahaObj,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setStatus(`Server error ${res.status}: ${t}`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("Done. PDF opened in new tab.");
    } catch (e: any) {
      setStatus("Request failed: " + (e?.message || "unknown error"));
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Debug: Fill AHA PDF</h1>
      <p style={{ marginTop: 8, opacity: 0.85 }}>
        Paste AHA JSON → click Generate → a filled PDF opens in a new tab.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <label>
          Company ID
          <input
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <label>
          Project ID
          <input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <label>
          Template File ID
          <input
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <label>
          AHA JSON
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={18}
            style={{ display: "block", width: "100%", padding: 10, marginTop: 6, fontFamily: "monospace" }}
          />
        </label>

        <button
          onClick={generate}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: "pointer",
            width: 180,
          }}
        >
          Generate PDF
        </button>

        <div style={{ marginTop: 8, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{status}</div>
      </div>
    </div>
  );
}
