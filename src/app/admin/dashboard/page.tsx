import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { RoleDashboard } from "@/components/admin/RoleDashboard";
import { getAuthSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  const data = await getDashboardData(session);
  return <><AdminHeader session={session} /><RoleDashboard session={session} data={data} /></>;
}
