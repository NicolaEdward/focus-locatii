import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { getAdminSession } from "@/lib/auth";
import { listAdminLocations, listCategories } from "@/lib/locations";
import { listOfferRequests } from "@/lib/offer-requests";
import { listReservations } from "@/lib/reservations";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminLocationsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "inventory.view")) redirect("/admin/dashboard");

  const [locations, categories, reservations, offerRequests] = await Promise.all([
    listAdminLocations(),
    listCategories(),
    listReservations({}, session, { includeDetails: false }),
    listOfferRequests(session)
  ]);

  return (
    <>
      <AdminHeader session={session} />
      <AdminDashboard
        initialLocations={locations}
        categories={categories}
        initialReservations={reservations}
        initialOfferRequests={offerRequests}
        session={session}
      />
    </>
  );
}
