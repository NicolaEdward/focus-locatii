import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ReceivablesWorkspace } from "@/components/admin/ReceivablesWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { listReceivableRegistry } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view")) redirect("/admin/dashboard");
  const params = await searchParams;
  const filters = {
    query: firstParam(params.q),
    status: firstParam(params.status),
    companyCode: firstParam(params.companyCode),
    currency: firstParam(params.currency)
  };
  const registry = await listReceivableRegistry({
    query: filters.query,
    status: filters.status,
    companyCode: filters.companyCode,
    currency: filters.currency,
    view: "open",
    page: Number(firstParam(params.page) || 1),
    take: 40
  });
  return (
    <>
      <AdminHeader session={session} />
      <ReceivablesWorkspace
        initialRegistry={registry}
        initialFilters={filters}
        canImport={hasPermission(session.role, "finance.upload")}
        canValidate={hasPermission(session.role, "finance.validate")}
        canConfirm={hasPermission(session.role, "finance.confirm")}
        canManage={hasPermission(session.role, "finance.manage")}
      />
    </>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
