"use client";

import { useEffect, useState } from "react";

type Mode = "embedded" | "standalone";

type Context = {
  companyId?: string;
  projectId?: string;
  userId?: string;
};

type Project = {
  id: number;
  project_number: string;
  name: string;
};

export default function AppShell({
  mode,
  context,
}: {
  mode: Mode;
  context: Context;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "needsAuth">("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setError(null);

      // Embedded mode (launched from Procore)
      if (mode === "embedded") {
        const { companyId, userId } = context;

        if (!companyId || !userId) {
          setStatus("needsAuth");
          return;
        }

        // 1) Bootstrap (ensures refresh token exists + can mint access token)
        const res = await fetch(
          `/api/procore/auth/embedded-bootstrap?company_id=${companyId}&user_id=${userId}`,
          { cache: "no-store" }
        );

        if (res.ok) {
          // 2) Load projects after bootstrap succeeds
          const pr = await fetch(
            `/api/procore/projects/list?company_id=${companyId}&user_id=${userId}`,
            { cache: "no-store" }
          );

          const pj = await pr.json();

          if (pj?.ok && Array.isArray(pj.sample)) {
            setProjects(pj.sample);
          } else {
            setError(pj?.sample?.error?.message || pj?.error || "Failed to load projects");
          }

          setStatus("ready");
          return;
        }

        // No refresh token yet → auto start OAuth (no button in embedded)
        if (res.status === 401) {
          window.location.href = `/api/oauth/start?company_id=${companyId}`;
          return;
        }

        setStatus("needsAuth");
        return;
      }

      // Standalone mode
      setStatus("needsAuth");
    };

    run();
  }, [mode, context.companyId, context.userId]);

  if (status === "loading") {
    return <div style={{ padding: 40 }}>Loading AHA Builder…</div>;
  }

  if (status === "needsAuth" && mode === "standalone") {
    return (
      <div style={{ padding: 40 }}>
        <h1>AHA Builder</h1>
        <button onClick={() => (window.location.href = "/api/oauth/start")}>
          Connect Procore
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>AHA Builder</h1>
      <p>Mode: {mode}</p>
      <p>Company: {context.companyId || "N/A"}</p>
      <p>Project: {context.projectId || "N/A"}</p>
      <p>User: {context.userId || "N/A"}</p>

      <hr />

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
                  {p.project_number} — {p.name} (#{p.id})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
