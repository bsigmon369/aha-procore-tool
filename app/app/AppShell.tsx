"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "embedded" | "standalone";

type Context = {
  companyId?: string;
  projectId?: string;
  userId?: string; // ignored in embedded; kept for backward compatibility
};

type Project = {
  id: number;
  project_number?: string;
  name: string;
};

export default function AppShell({ mode, context }: { mode: Mode; context: Context }) {
  const [status, setStatus] = useState<"loading" | "ready" | "needsAuth">("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  const companyId = context.companyId;
  const projectId = context.projectId;

  const returnTo = useMemo(() => {
    const base = `/app?company_id=${encodeURIComponent(companyId || "")}`;
    return projectId ? `${base}&project_id=${encodeURIComponent(projectId)}` : base;
  }, [companyId, projectId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setStatus("loading");

      // Embedded mode: launched from Procore with company_id (+ project_id). No user_id expected.
      if (mode === "embedded") {
        if (!companyId) {
          if (!cancelled) setStatus("needsAuth");
          return;
        }

        // 1) Bootstrap: validates cookie session + can mint access token
        const boot = await fetch(
          `/api/procore/auth/embedded-bootstrap?company_id=${encodeURIComponent(companyId)}`,
          { cache: "no-store" }
        );

        if (boot.ok) {
          // 2) Load some projects (sample) to prove API calls work
          const pr = await fetch(
            `/api/procore/projects/list?company_id=${encodeURIComponent(companyId)}`,
            { cache: "no-store" }
          );

          const pj = await pr.json().catch(() => null);

          if (!cancelled) {
            if (pj?.ok && Array.isArray(pj.sample)) {
              setProjects(pj.sample);
              setStatus("ready");
            } else {
              setError(pj?.error || pj?.data?.error || "Failed to load projects");
              setStatus("ready");
            }
          }
          return;
        }

        // Not authenticated: go to OAuth immediately (no button in embedded)
        if (boot.status === 401) {
          window.location.href = `/api/oauth/start?company_id=${encodeURIComponent(
            companyId
          )}&return_to=${encodeURIComponent(returnTo)}`;
          return;
        }

        // Other failures
        const bootBody = await boot.json().catch(() => null);
        if (!cancelled) {
          setError(bootBody?.error || `Bootstrap failed (${boot.status})`);
          setStatus("needsAuth");
        }
        return;
      }

      // Standalone mode: show connect button
      if (!cancelled) setStatus("needsAuth");
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId, returnTo]);

  if (status === "loading") {
    return <div style={{ padding: 40 }}>Loading AHA Builder…</div>;
  }

  if (status === "needsAuth" && mode === "standalone") {
    return (
      <div style={{ padding: 40 }}>
        <h1>AHA Builder</h1>
        <p>Connect your Procore account to continue.</p>
        <button onClick={() => (window.location.href = "/api/oauth/start")}>Connect Procore</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>AHA Builder</h1>

      <div style={{ marginTop: 10 }}>
        <p>Mode: {mode}</p>
        <p>Company: {companyId || "N/A"}</p>
        <p>Project: {projectId || "N/A"}</p>
        <p>User: (resolved via session cookie)</p>
      </div>

      <hr style={{ margin: "16px 0" }} />

      {error ? (
        <div>
          <p style={{ color: "crimson" }}>Error: {error}</p>
        </div>
      ) : (
        <div>
          <h3>Projects (sample)</h3>
          {projects.length === 0 ? (
            <p>No projects returned.</p>
          ) : (
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  {(p.project_number ? `${p.project_number} — ` : "")}
                  {p.name} (#{p.id})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
