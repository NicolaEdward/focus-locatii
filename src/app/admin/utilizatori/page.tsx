import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { UserManagement } from "@/components/admin/UserManagement";
import { getAuthSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { listUsers } from "@/lib/users";
import { authEmailCapability } from "@/lib/transactional-email";
import { syntheticAuthFlowAllowed } from "@/lib/auth-workflows";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "users.manage")) redirect("/admin/dashboard");
  return <><AdminHeader session={session} /><UserManagement initialUsers={await listUsers()} currentUserId={session.id} invitesAvailable={authEmailCapability().enabled || syntheticAuthFlowAllowed()} /></>;
}
