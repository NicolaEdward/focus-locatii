import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminReservationsPanel } from "@/components/admin/AdminReservationsPanel";
import { getAdminSession } from "@/lib/auth";
import { listAdminLocations } from "@/lib/locations";
import { listOfferRequests } from "@/lib/offer-requests";
import { listOperationReservations, listReservations } from "@/lib/reservations";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminOperationalPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["campaigns.operate", "reservations.view", "reservations.view.own", "inventory.view"])) {
    redirect("/admin/dashboard");
  }

  const [locations, reservations, operationReservations, offerRequests] = await Promise.all([
    listAdminLocations(),
    listReservations({}, session),
    listOperationReservations(),
    listOfferRequests(session)
  ]);

  return (
    <>
      <AdminHeader session={session} />
      <main className="focus-shell py-8">
        <section className="focus-container grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase text-focus-yellow">Workspace operational</p>
              <h1 className="font-display text-4xl font-black uppercase">Operational</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Urmareste inchirierile viitoare, decorarile, neutralizarile si taskurile operationale existente.
              </p>
            </div>
          </div>
          <AdminReservationsPanel
            locations={locations}
            initialReservations={reservations}
            operationReservations={operationReservations}
            initialOfferRequests={offerRequests}
            session={session}
            workspace="operational"
          />
        </section>
      </main>
    </>
  );
}
