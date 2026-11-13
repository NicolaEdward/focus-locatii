import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CrmWorkspaceV4 } from "@/components/admin/CrmWorkspaceV4";
import { crmWorkspaceInitialState } from "@/lib/crm-workspace-state";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasGlobalDataAccess, hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function CrmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["leads.view", "leads.view.own"])) redirect("/admin/dashboard");
  return <>
    <AdminHeader session={session} />
    <CrmWorkspaceV4
      canViewTeam={hasGlobalDataAccess(session.role)}
      canEdit={hasAnyPermission(session.role, ["leads.manage", "leads.manage.own"])}
      canAssignOwners={hasPermission(session.role, "leads.manage")}
      sessionUserId={session.id}
      initialState={crmWorkspaceInitialState(await searchParams)}
    />
  </>;
}
