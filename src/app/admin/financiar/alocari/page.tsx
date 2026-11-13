import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { BillingFinanceWorkspace } from "@/components/admin/BillingFinanceWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function CampaignFinancePage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view"))
    redirect("/admin/dashboard");
  const entities = await prisma.financialLegalEntity.findMany({
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });
  return (
    <>
      <AdminHeader session={session} />
      <BillingFinanceWorkspace
        mode="allocations"
        canWrite={hasAnyPermission(session.role, [
          "finance.validate",
          "finance.manage",
        ])}
        canApprove={hasAnyPermission(session.role, [
          "finance.confirm",
          "finance.manage",
        ])}
        entities={entities}
      />
    </>
  );
}
