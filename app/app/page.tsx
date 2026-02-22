import AppShell from "./AppShell";

export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const companyId =
    typeof searchParams.company_id === "string" ? searchParams.company_id : undefined;

  const projectId =
    typeof searchParams.project_id === "string" ? searchParams.project_id : undefined;

  const userId =
    typeof searchParams.user_id === "string" ? searchParams.user_id : undefined;

  const mode = companyId && userId ? "embedded" : "standalone";

  return <AppShell mode={mode} context={{ companyId, projectId, userId }} />;
}
