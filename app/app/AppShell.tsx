"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "embedded" | "standalone";

type Context = {
  companyId?: string;
  projectId?: string;
  userId?: string; // ignored in embedded; kept for backward compat
};

type Project = {
  id: number;
  project_number?: string;
  name: string;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "needsAuth" }
  | { status: "ready"; me: any };

export default function AppShell({ mode, context }: { mode: Mode; context: Context }) {
  const companyId = context.companyId;
  const projectId = context.projectId;

  const [boot, setBoot] = useState<BootstrapState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);

  // AHA input/output
  const [sentence, setSentence] = useState("");
  const [ahaJson, setAhaJson] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Debug: projects list
  const [showDebugProjects, setShowDebugProjects] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const oauthInFlightRef = useRef(false);

  const returnTo = useMemo(() => {
    const base = `/app?company_id=${encodeURIComponent(companyId || "")}`;
    return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base;
  }, [companyId, projectId]);

 async function startEmbeddedOAuthPopup() {
  // Always derive IDs from the iframe URL first (most reliable inside Procore)
  const sp = new URLSearchParams(window.location.search);
  const cid = sp.get("company_id") || companyId || "";
  const pid = sp.get("project_id") || projectId || "";

  if (!cid) {
    setError("Missing company_id in embedded URL. Procore did not supply company_id.");
    return;
  }

  if (oauthInFlightRef.current) return;
  oauthInFlightRef.current = true;

  const rt = `/app?company_id=${encodeURIComponent(cid)}${pid ? `&project_id=${encodeURIComponent(pid)}` : ""}`;

  const popup = window.open(
    `/api/oauth/start?company_id=${encodeURIComponent(cid)}&return_to=${encodeURIComponent(rt)}`,
    "aha_procore_oauth",
    "width=520,height=720"
  );

  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    oauthInFlightRef.current = false;
  };

  const onMessage = async (evt: MessageEvent) => {
    if (evt.origin !== window.location.origin) return;
    const data: any = evt.data;
    if (!data || data.type !== "AHA_OAUTH_DONE") return;
    if (!data.nonce) return;

    try {
      const claim = await fetch(
        `/api/oauth/claim?nonce=${encodeURIComponent(data.nonce)}&company_id=${encodeURIComponent(cid)}`,
        { cache: "no-store" }
      );

      const cj = await claim.json().catch(() => null);
      if (!claim.ok || !cj?.ok) {
        setError(cj?.error || `OAuth claim failed (${claim.status})`);
        cleanup();
        return;
      }

      try {
        popup?.close();
      } catch {}

      cleanup();
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || "OAuth claim failed");
      cleanup();
    }
  };

  window.addEventListener("message", onMessage);

  setTimeout(() => {
    if (popup && popup.closed) {
      oauthInFlightRef.current = false;
      window.removeEventListener("message", onMessage);
    }
  }, 1500);
}

  // --- Embedded bootstrap ---
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setBoot({ status: "loading" });

      if (mode === "embedded") {
        if (!companyId) {
          if (!cancelled) setBoot({ status: "needsAuth" });
          return;
        }

        const bootRes = await fetch(
          `/api/procore/auth/embedded-bootstrap?company_id=${encodeURIComponent(companyId)}`,
          { cache: "no-store" }
        );

        if (bootRes.ok) {
          const bootJson = await bootRes.json().catch(() => null);
          if (!cancelled) setBoot({ status: "ready", me: bootJson?.me });
          return;
        }

        if (bootRes.status === 401) {
          // IMPORTANT: Do NOT redirect the iframe to Procore OAuth.
          // Use popup + claim so cookie is set in iframe context.
          if (!cancelled) {
            setBoot({ status: "needsAuth" });
            startEmbeddedOAuthPopup();
          }
          return;
        }

        const bootBody = await bootRes.json().catch(() => null);
        if (!cancelled) {
          setError(bootBody?.error || `Bootstrap failed (${bootRes.status})`);
          setBoot({ status: "needsAuth" });
        }
        return;
      }

      // Standalone mode: user clicks connect
      if (!cancelled) setBoot({ status: "needsAuth" });
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId, returnTo]);

  // --- Debug: load projects on demand ---
  const loadProjects = async () => {
    if (!companyId) return;
    setProjectsError(null);
    setIsLoadingProjects(true);
    try {
      const pr = await fetch(
        `/api/procore/projects/list?company_id=${encodeURIComponent(companyId)}`,
        { cache: "no-store" }
      );
      const pj = await pr.json().catch(() => null);
      if (pj?.ok && Array.isArray(pj.sample)) {
        setProjects(pj.sample);
      } else {
        setProjectsError(pj?.error || pj?.details?.data?.error?.message || "Failed to load projects");
      }
    } catch (e: any) {
      setProjectsError(e?.message || "Failed to load projects");
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // --- AHA generate ---
  const generateAha = async () => {
    if (!companyId || !projectId) {
      setError("Missing company_id or project_id in embedded context.");
      return;
    }
    if (!sentence.trim()) return;

    setError(null);
    setAhaJson(null);
    setIsGenerating(true);

    try {
      const res = await fetch("/api/aha/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          companyId,
          projectId,
          sentence: sentence.trim(),
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error || `Generate failed (${res.status})`);
      }

      setAhaJson(json?.aha ?? null);
    } catch (e: any) {
      setError(e?.message || "Generate failed");
    } finally {
      setIsGenerating(false);
    }
  };
  // --- AHA complete: resolve → list template folder → pick template pdf → fill+upload ---
  const completeAha = async () => {
    if (!companyId || !projectId) {
      setError("Missing company_id or project_id in embedded context.");
      return;
    }
    if (!ahaJson) {
      setError("Generate an AHA first.");
      return;
    }

    setError(null);
    setIsCompleting(true);

    try {
      // 1) resolve folders (Template + Completed)
      const rr = await fetch("/api/procore/documents/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ company_id: companyId, project_id: projectId }),
      });
      const rj = await rr.json().catch(() => null);
      if (!rr.ok || !rj?.ok || !rj?.templateFolder?.id) {
        throw new Error(rj?.error || `Resolve failed (${rr.status})`);
      }

      const templateFolderId = String(rj.templateFolder.id);

      // 2) list template folder contents
      const lr = await fetch(
        `/api/procore/documents/list?company_id=${encodeURIComponent(
          companyId
        )}&project_id=${encodeURIComponent(projectId)}&folder_id=${encodeURIComponent(templateFolderId)}`,
        { cache: "no-store" }
      );
      const lj = await lr.json().catch(() => null);
      if (!lr.ok || !lj?.ok || !Array.isArray(lj?.items)) {
        throw new Error(lj?.error || `List failed (${lr.status})`);
      }

      // 3) choose the PDF template file in "01 AHA Template"
      const files = lj.items.filter((x: any) => !x?.isFolder && typeof x?.name === "string");
      const pdfs = files.filter((x: any) => x.name.toLowerCase().endsWith(".pdf"));

      const preferred =
        pdfs.find((x: any) => x.name.toLowerCase().includes("template")) ||
        pdfs.find((x: any) => x.name.toLowerCase().includes("aha")) ||
        pdfs[0];

      if (!preferred?.id) {
        throw new Error("No PDF template found in: 01 AHA Template");
      }

      const templateFileId = String(preferred.id);

      // 4) fill + upload into "02 Completed AHA's"
      const cr = await fetch("/api/procore/documents/aha-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          company_id: companyId,
          project_id: projectId,
          template_file_id: templateFileId,
          aha: ahaJson,
          // completed_folder_id optional; route resolves if omitted
        }),
      });

      const cj = await cr.json().catch(() => null);
      if (!cr.ok || !cj?.ok) {
        throw new Error(cj?.error || `Complete failed (${cr.status})`);
      }

      // optional: surface success somewhere
      // setError(null);
      // alert(`Uploaded: ${cj.filename}`);
    } catch (e: any) {
      setError(e?.message || "Complete failed");
    } finally {
      setIsCompleting(false);
    }
  };
  // --- UI ---
  if (boot.status === "loading") {
    return <div style={{ padding: 40 }}>Loading AHA Builder…</div>;
  }

  if (boot.status === "needsAuth" && mode === "standalone") {
    return (
      <div style={{ padding: 40 }}>
        <h1>AHA Builder</h1>
        <p>Connect your Procore account to continue.</p>
        <a
          href="/api/oauth/start"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Connect Procore
        </a>
      </div>
    );
  }

  if (boot.status === "needsAuth" && mode === "embedded") {
    return (
      <div style={{ padding: 40 }}>
        <h1>AHA Builder</h1>
        <p>Connecting to Procore…</p>
        <button
          onClick={() => startEmbeddedOAuthPopup()}
          style={{
            display: "inline-block",
            padding: "10px 14px",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "white",
            cursor: "pointer",
          }}
        >
          Connect Procore
        </button>
        {error ? <p style={{ color: "crimson" }}>Error: {error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 900 }}>
      <h1>AHA Builder</h1>

      <div style={{ marginTop: 10 }}>
        <p>Mode: {mode}</p>
        <p>Company: {companyId || "N/A"}</p>
        <p>Project: {projectId || "N/A"}</p>
        <p>User: (resolved via session cookie)</p>
      </div>

      <hr style={{ margin: "16px 0" }} />

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: "crimson" }}>Error: {error}</p>
        </div>
      ) : null}

      <div style={{ padding: 14, border: "1px solid #e5e5e5", borderRadius: 10 }}>
        <h3 style={{ marginTop: 0 }}>Describe the activity</h3>
        <p style={{ marginTop: 6, color: "#444" }}>
          Type one sentence. We’ll generate a structured AHA and (next) fill & upload the PDF.
        </p>

        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder='Example: "Install 24x24 fire damper in corridor wall at Level 2 using Hilti anchors and seal with fire caulk."'
          rows={4}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid #ddd",
          }}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            disabled={isGenerating || !sentence.trim()}
            onClick={generateAha}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #111",
              background: isGenerating ? "#f5f5f5" : "#111",
              color: isGenerating ? "#111" : "#fff",
              cursor: isGenerating ? "not-allowed" : "pointer",
            }}
          >
            {isGenerating ? "Generating…" : "Generate AHA"}
          </button>
          <button
            disabled={isCompleting || !ahaJson}
            onClick={completeAha}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #111",
              background: isCompleting ? "#f5f5f5" : "#fff",
              color: "#111",
              cursor: isCompleting || !ahaJson ? "not-allowed" : "pointer",
            }}
            >
            {isCompleting ? "Uploading…" : "Fill & Upload PDF"}
          </button>
          
          <button
            onClick={() => {
              setSentence("");
              setAhaJson(null);
              setError(null);
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Clear
          </button>

          <button
            onClick={() => setShowDebugProjects((v) => !v)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Debug Projects
          </button>
        </div>
      </div>

      {ahaJson ? (
        <pre
          style={{
            marginTop: 16,
            padding: 14,
            background: "#f7f7f7",
            borderRadius: 10,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(ahaJson, null, 2)}
        </pre>
      ) : null}

      {showDebugProjects ? (
        <div style={{ marginTop: 16, padding: 14, border: "1px solid #eee", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Projects (debug)</h3>
          <button
            onClick={loadProjects}
            disabled={isLoadingProjects}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: isLoadingProjects ? "not-allowed" : "pointer",
            }}
          >
            {isLoadingProjects ? "Loading…" : "Load sample projects"}
          </button>

          {projectsError ? <p style={{ color: "crimson" }}>Error: {projectsError}</p> : null}

          {projects.length ? (
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  {p.project_number ? `${p.project_number} — ` : ""}
                  {p.name} (ID: {p.id})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
