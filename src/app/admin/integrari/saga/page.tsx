import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { SagaIntegrationWorkspace } from "@/components/admin/SagaIntegrationWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getSagaIntegrationStatus } from "@/lib/integrations/saga/config";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SagaIntegrationPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.integrations.saga.view")) redirect("/admin/dashboard");
  return (
    <>
      <AdminHeader session={session} />
      <SagaIntegrationWorkspace
        initialStatus={getSagaIntegrationStatus()}
        canRun={hasAnyPermission(session.role, ["finance.integrations.saga.sync", "finance.integrations.saga.reconcile"])}
      />
    </>
  );
}
