import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminReservationsPanel } from "@/components/admin/AdminReservationsPanel";
import { FieldWorkInbox } from "@/components/admin/FieldWorkInbox";
import { OperationalAssignmentBoard } from "@/components/admin/OperationalAssignmentBoard";
import { getAdminSession } from "@/lib/auth";
import {
  isOperationalAssignmentManager,
  listFieldOperators,
  listOperationalAssignmentTasks,
  operationalAssignmentEnabled
} from "@/lib/operational-assignment";
import { listOperationReservations } from "@/lib/reservations";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AdminOperationalPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["dashboard.operations.view", "campaigns.operate", "reservations.view", "reservations.view.own", "inventory.view"])) {
    redirect("/admin/dashboard");
  }

  const assignmentEnabled = operationalAssignmentEnabled();
  const isField = session.role === "FIELD_OPERATOR";
  const isAssignmentManager = isOperationalAssignmentManager(session);
  const [operationReservations, assignmentTasks, fieldUsers] = await Promise.all([
    isField ? Promise.resolve([]) : listOperationReservations(session),
    assignmentEnabled && (isField || isAssignmentManager)
      ? listOperationalAssignmentTasks({ session, includeCompleted: isField })
      : Promise.resolve([]),
    assignmentEnabled && isAssignmentManager ? listFieldOperators() : Promise.resolve([])
  ]);

  return (
    <>
      <AdminHeader session={session} />
      <main className="focus-shell py-8">
        <section className="focus-container grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          {isField ? (
            assignmentEnabled
              ? <FieldWorkInbox initialTasks={assignmentTasks} />
              : <FieldPilotDisabled />
          ) : (
            <>
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-focus-yellow">Workspace operational</p>
              <h1 className="font-display text-4xl font-black uppercase">Operational</h1>
              <p className="mt-2 max-w-full break-words text-sm text-slate-400 sm:max-w-2xl">
                Urmareste inchirierile viitoare, decorarile, neutralizarile si taskurile operationale existente.
              </p>
            </div>
          </div>
          {isAssignmentManager && assignmentEnabled ? <OperationalAssignmentBoard tasks={assignmentTasks} fieldUsers={fieldUsers} /> : null}
          <AdminReservationsPanel
            locations={[]}
            initialReservations={operationReservations}
            initialOfferRequests={[]}
            session={session}
            workspace="operational"
          />
            </>
          )}
        </section>
      </main>
    </>
  );
}

function FieldPilotDisabled() {
  return (
    <section className="mx-auto w-full max-w-xl rounded-lg border border-slate-700 bg-focus-navy p-6 text-center">
      <p className="text-xs font-black uppercase text-focus-yellow">Munca mea</p>
      <h1 className="mt-2 text-3xl font-black text-white">Assignmentul nu este activ</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">Contul de teren nu afiseaza rezervari generale. Lucrarile vor aparea aici numai dupa activarea pilotului si atribuirea lor explicita de catre COO.</p>
    </section>
  );
}
