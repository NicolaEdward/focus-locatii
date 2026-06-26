import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { GpsAuditDashboard } from "@/components/admin/GpsAuditDashboard";
import { getAdminSession } from "@/lib/auth";
import { listAdminLocations } from "@/lib/locations";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function GpsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "inventory.manage")) redirect("/admin/dashboard");

  const locations = await listAdminLocations();

  return (
    <>
      <AdminHeader session={session} />
      <GpsAuditDashboard initialLocations={locations} />
    </>
  );
}
