import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CrmWorkspaceV4 } from "@/components/admin/CrmWorkspaceV4";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasGlobalDataAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["leads.view", "leads.view.own"])) redirect("/admin/dashboard");
  return <>
    <AdminHeader session={session} />
    <CrmWorkspaceV4
      canViewTeam={hasGlobalDataAccess(session.role)}
      sessionUserId={session.id}
    />
  </>;
}
