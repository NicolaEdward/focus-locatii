import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { FinancialReconciliationWorkspace } from "@/components/admin/FinancialReconciliationWorkspace";
import { getAuthSession } from "@/lib/auth";
import { financialReconciliationSummary, listFinancialReconciliation } from "@/lib/financial-reconciliation";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinancialReconciliationPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view")) redirect("/admin/dashboard");
  const [reconciliation, summary] = await Promise.all([
    listFinancialReconciliation({ page: 1, take: 30 }),
    financialReconciliationSummary({})
  ]);
  return <><AdminHeader session={session} /><FinancialReconciliationWorkspace
    initialData={{ reconciliation, summary }}
    canUpload={hasPermission(session.role, "finance.upload")}
    canValidate={hasPermission(session.role, "finance.validate")}
    canConfirm={hasPermission(session.role, "finance.confirm")}
    canManage={hasPermission(session.role, "finance.manage")}
  /></>;
}
