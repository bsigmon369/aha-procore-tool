"use client";

import { useEffect, useState } from "react";

type Mode = "embedded" | "standalone";

type Context = {
  companyId?: string;
  projectId?: string;
  userId?: string;
};

export default function AppShell({
  mode,
  context,
}: {
  mode: Mode;
  context: Context;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "needsAuth">("loading");

  useEffect(() => {
    const run = async () => {
      // Embedded mode (launched from Procore)
      if (mode === "embedded") {
        const { companyId, userId } = context;

        if (!companyId || !userId) {
          setStatus("needsAuth");
          return;
        }

        const res = await fetch(
          `/api/procore/auth/embedded-bootstrap?company_id=${companyId}&user_id=${userId}`,
          { cache: "no-store" }
        );

        if (res.ok) {
          setStatus("ready");
          return;
        }

        // No refresh token yet → auto start OAuth
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
    return <div>Loading AHA Builder…</div>;
  }

  if (status === "needsAuth" && mode === "standalone") {
    return (
      <div style={{ padding: 40 }}>
        <h1>AHA Builder</h1>
        <button
          onClick={() => {
            window.location.href = "/api/oauth/start";
          }}
        >
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

      <p>App initialized successfully.</p>
    </div>
  );
}
