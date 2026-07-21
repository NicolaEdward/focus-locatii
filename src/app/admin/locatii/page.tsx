import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { getAdminSession } from "@/lib/auth";
import { getAdminLocationListItem, listAdminLocationPage, listCategories } from "@/lib/locations";
import { listReservationPage } from "@/lib/reservations";
import { hasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLocationsPage({ searchParams }: PageProps) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "inventory.view")) redirect("/admin/dashboard");
  const params = await searchParams;
  const query = scalar(params.q);
  const category = scalar(params.category);
  const status = scalar(params.status);
  const reservationQuery = scalar(params.rq);
  const reservationStatus = scalar(params.rstatus);
  const reservationScope = scalar(params.rscope) === "history" ? "history" : "active";
  const focusedLocationId = scalar(params.locationId);
  const focusedReservationId = scalar(params.reservationId);
  const newReservation = scalar(params.newReservation) === "1";

  const [locations, categories, reservationResult, focusedLocation] = await Promise.all([
    listAdminLocationPage({ query, category, lifecycleStatus: status, page: scalar(params.page) }),
    listCategories(),
    listReservationPage({
      query: reservationQuery,
      status: reservationStatus,
      scope: reservationScope,
      page: scalar(params.rpage)
    }, session),
    focusedLocationId ? getAdminLocationListItem(focusedLocationId) : Promise.resolve(null)
  ]);

  return (
    <>
      <AdminHeader session={session} />
      <AdminDashboard
        initialLocations={locations}
        categories={categories}
        initialReservations={reservationResult.page}
        initialOccupancySummary={reservationResult.summary}
        initialFocusedLocation={focusedLocation}
        initialWorkspaceRequest={focusedReservationId || newReservation ? { reservationId: focusedReservationId || undefined, newReservation } : null}
        initialFilters={{
          inventory: { query, category, status },
          reservations: { query: reservationQuery, status: reservationStatus, scope: reservationScope }
        }}
        session={session}
      />
    </>
  );
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
