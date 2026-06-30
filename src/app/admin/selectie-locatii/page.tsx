import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminLocationSelectionPage } from "@/components/admin/location-selection/AdminLocationSelectionPage";
import { listLocationSelectionLocations } from "@/lib/location-selection";
import { getAdminSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminLocationSelectionRoute() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "inventory.view")) redirect("/admin/dashboard");

  const initialData = await listLocationSelectionLocations({ sort: "code" }, session);

  return (
    <>
      <AdminHeader session={session} />
      <AdminLocationSelectionPage
        initialData={initialData}
        session={session}
      />
    </>
  );
}
