import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { BillingFinanceWorkspace } from "@/components/admin/BillingFinanceWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
export const dynamic = "force-dynamic";
export default async function BillingPlanPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view"))
    redirect("/admin/dashboard");
  return (
    <>
      <AdminHeader session={session} />
      <BillingFinanceWorkspace
        mode="plan"
        canWrite={hasAnyPermission(session.role, [
          "finance.validate",
          "finance.manage",
        ])}
        canApprove={hasAnyPermission(session.role, [
          "finance.confirm",
          "finance.manage",
        ])}
        entities={[]}
      />
    </>
  );
}
