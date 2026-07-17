import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ReceivablesWorkspace } from "@/components/admin/ReceivablesWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { listReceivablesWorkspace } from "@/lib/receivables-import-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReceivablesPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view")) redirect("/admin/dashboard");
  const workspace = await listReceivablesWorkspace({ take: 100 });
  return (
    <>
      <AdminHeader session={session} />
      <ReceivablesWorkspace
        initialWorkspace={workspace}
        canImport={hasPermission(session.role, "finance.upload")}
        canValidate={hasPermission(session.role, "finance.validate")}
        canConfirm={hasPermission(session.role, "finance.confirm")}
        canManage={hasPermission(session.role, "finance.manage")}
      />
    </>
  );
}
