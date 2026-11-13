import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { OperationsControlWorkspace } from "@/components/admin/OperationsControlWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { getOperationsControls } from "@/lib/operations-controls";
export const dynamic = "force-dynamic";
export default async function OperationsControlPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "audit.view")) redirect("/admin/dashboard");
  return <><AdminHeader session={session} /><OperationsControlWorkspace initialState={await getOperationsControls()} role={session.role} /></>;
}
