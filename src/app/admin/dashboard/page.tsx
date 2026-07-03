import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { RoleDashboard } from "@/components/admin/RoleDashboard";
import { getAuthSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";
import { dashboardPathForRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  const roleDashboardPath = dashboardPathForRole(session.role);
  if (roleDashboardPath !== "/admin/dashboard") redirect(roleDashboardPath);
  const data = await getDashboardData(session);
  return <><AdminHeader session={session} /><RoleDashboard session={session} data={data} /></>;
}
