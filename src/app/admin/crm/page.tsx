import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CrmWorkspace } from "@/components/admin/CrmWorkspace";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasGlobalDataAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["leads.view", "leads.view.own"])) redirect("/admin/dashboard");
  const params = await searchParams;
  return <>
    <AdminHeader session={session} />
    <CrmWorkspace
      currentUserId={session.id}
      canViewTeam={hasGlobalDataAccess(session.role)}
      initialLeadId={params.lead || null}
    />
  </>;
}
