import AppShell from "./AppShell";

function isNumericId(v: unknown) {
  return typeof v === "string" && /^[0-9]+$/.test(v);
}

export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const rawCompanyId = typeof searchParams.company_id === "string" ? searchParams.company_id : undefined;
  const rawProjectId = typeof searchParams.project_id === "string" ? searchParams.project_id : undefined;
  const rawUserId = typeof searchParams.user_id === "string" ? searchParams.user_id : undefined;

  const companyId = isNumericId(rawCompanyId) ? rawCompanyId : undefined;
  const projectId = isNumericId(rawProjectId) ? rawProjectId : undefined;
  const userId = isNumericId(rawUserId) ? rawUserId : undefined;

  const mode: "embedded" | "standalone" = companyId ? "embedded" : "standalone";

  return <AppShell mode={mode} context={{ companyId, projectId, userId }} />;
}
