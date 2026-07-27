import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { UserManagement } from "@/components/admin/UserManagement";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import { listUsers } from "@/lib/users";
import { authEmailCapability } from "@/lib/transactional-email";
import { syntheticAuthFlowAllowed } from "@/lib/auth-workflows";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["users.view", "users.manage"])) redirect("/admin/dashboard");
  const canManage = hasPermission(session.role, "users.manage");
  return <><AdminHeader session={session} /><UserManagement initialUsers={await listUsers()} currentUserId={session.id} invitesAvailable={canManage && (authEmailCapability().enabled || syntheticAuthFlowAllowed())} readOnly={!canManage} /></>;
}
