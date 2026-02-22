"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "embedded" | "standalone";

type Context = {
  companyId?: string;
  projectId?: string;
  userId?: string;
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

function isNumericId(v?: string) {
  return typeof v === "string" && /^[0-9]+$/.test(v);
}

export default function AppShell({ mode, context }: { mode: Mode; context: Context }) {
  const companyId = context.companyId;
  const projectId = context.projectId;

  const [boot, setBoot] = useState<BootstrapState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);

  const [sentence, setSentence] = useState("");
  const [ahaJson, setAhaJson] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [showDebugProjects, setShowDebugProjects] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const returnTo = useMemo(() => {
    const base = `/app?company_id=${encodeURIComponent(companyId || "")}`;
    return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base;
  }, [companyId, projectId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setBoot({ status: "loading" });

      if (mode === "embedded") {
        if (!isNumericId(companyId)) {
          if (!cancelled) {
            setError("Embedded launch params were not resolved by Procore (company_id missing/invalid).");
            setBoot({ status: "needsAuth" });
          }
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
          window.location.href = `/api/oauth/start?company_id=${encodeURIComponent(
            companyId
          )}&return_to=${encodeURIComponent(returnTo)}`;
          return;
        }

        const bootBody = await bootRes.json().catch(() => null);
        if (!cancelled) {
          setError(bootBody?.error || `Bootstrap failed (${bootRes.status})`);
          setBoot({ status: "needsAuth" });
        }
        return;
      }

      if (!cancelled) setBoot({ status: "needsAuth" });
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId, returnTo]);

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

      setAhaJson(json);
    } catch (e: any) {
      setError(e?.message || "Generate failed");
    } finally {
      setIsGenerating(false);
    }
  };

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
        <p style={{ color: "crimson" }}>{error || "Authentication required."}</p>
        <p>
          This usually means the Procore embedded app URL parameters were not interpolated (example:
          company_id=%7B%7Bprocore.company.id%7D%7D).
        </p>
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
            border: "1px solid #ccc",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={generateAha}
            disabled={isGenerating || !sentence.trim() || !companyId || !projectId}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              cursor: isGenerating ? "not-allowed" : "pointer",
            }}
          >
            {isGenerating ? "Generating…" : "Generate AHA"}
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
              cursor: "pointer",
              background: "white",
            }}
          >
            Clear
          </button>
        </div>

        {ahaJson ? (
          <div style={{ marginTop: 14 }}>
            <h4 style={{ marginBottom: 8 }}>Generated (debug JSON)</h4>
            <pre
              style={{
                background: "#fafafa",
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 12,
                overflowX: "auto",
                fontSize: 12,
              }}
            >
              {JSON.stringify(ahaJson, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showDebugProjects}
            onChange={(e) => setShowDebugProjects(e.target.checked)}
          />
          Debug: show project list
        </label>

        {showDebugProjects ? (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={loadProjects}
              disabled={isLoadingProjects || !companyId}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ccc",
                cursor: "pointer",
              }}
            >
              {isLoadingProjects ? "Loading…" : "Load Projects (sample)"}
            </button>

            {projectsError ? <p style={{ color: "crimson" }}>{projectsError}</p> : null}

            {projects.length ? (
              <ul style={{ marginTop: 10 }}>
                {projects.map((p) => (
                  <li key={p.id}>
                    {(p.project_number ? `${p.project_number} — ` : "")}
                    {p.name} (#{p.id})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
