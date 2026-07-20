import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env");

async function main() {
  const [{ prisma }, taskDerivation] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/operation-tasks")
  ]);

  try {
    const [reservations, tasks, fieldUsers] = await Promise.all([
      prisma.reservation.findMany({
        select: {
          id: true,
          status: true,
          clientId: true,
          campaignId: true,
          locationId: true,
          periodStart: true,
          periodEnd: true,
          installationDate: true,
          neutralizationDate: true,
          productionNotes: true
        },
        orderBy: { id: "asc" }
      }),
      prisma.operationTask.findMany({
        select: {
          id: true,
          reservationId: true,
          dedupeKey: true,
          kind: true,
          status: true,
          assignedToUserId: true,
          reservation: { select: { status: true } }
        },
        orderBy: { id: "asc" }
      }),
      prisma.user.count({ where: { role: "FIELD_OPERATOR", active: true } })
    ]);

    const booked = reservations.filter((reservation) => reservation.status === "BOOKED");
    const currentDrafts = booked.flatMap((reservation) => [
      ...taskDerivation.deriveBaseTasksFromReservation(reservation).tasks,
      ...taskDerivation.parseLegacyOperationTasksForMigration(reservation).tasks
    ]).filter((task) => task.dedupeKey && task.scheduledFor);
    const currentKeys = new Set(currentDrafts.map((task) => String(task.dedupeKey)));
    const tasksByKey = new Map(tasks.filter((task) => task.dedupeKey).map((task) => [String(task.dedupeKey), task]));
    const currentMaterialized = currentDrafts.flatMap((draft) => {
      const task = tasksByKey.get(String(draft.dedupeKey));
      return task ? [task] : [];
    });
    const stale = tasks.filter((task) => task.reservation?.status !== "BOOKED" || (task.dedupeKey && !currentKeys.has(task.dedupeKey)));
    const missing = currentDrafts.filter((draft) => !tasksByKey.has(String(draft.dedupeKey)));

    const payload = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      featureFlagEnabled: ["1", "true", "yes"].includes(String(process.env.OPERATIONAL_ASSIGNMENT_ENABLED || "").toLowerCase()),
      fieldOperatorsActive: fieldUsers,
      reservations: {
        total: reservations.length,
        booked: booked.length,
        hold: reservations.filter((reservation) => reservation.status === "HOLD").length,
        reserved: reservations.filter((reservation) => reservation.status === "RESERVED").length
      },
      operationTasks: {
        total: tasks.length,
        assigned: tasks.filter((task) => task.assignedToUserId).length,
        unassigned: tasks.filter((task) => !task.assignedToUserId).length,
        linkedToBooked: tasks.filter((task) => task.reservation?.status === "BOOKED").length,
        linkedToNonBookedOrMissing: tasks.filter((task) => task.reservation?.status !== "BOOKED").length,
        byKind: countBy(tasks, (task) => task.kind),
        byStatus: countBy(tasks, (task) => task.status)
      },
      assignmentCutover: {
        currentDerivedTasks: currentDrafts.length,
        currentMaterialized: currentMaterialized.length,
        currentAssigned: currentMaterialized.filter((task) => task.assignedToUserId).length,
        currentUnassigned: currentDrafts.filter((draft) => !tasksByKey.get(String(draft.dedupeKey))?.assignedToUserId).length,
        wouldMaterializeIfGloballyBackfilled: missing.length,
        staleMaterializedTasks: stale.length,
        safeAutoBackfillApproved: false
      },
      reviewSamples: {
        currentUnassignedTaskKeys: currentDrafts.filter((draft) => !tasksByKey.get(String(draft.dedupeKey))?.assignedToUserId).slice(0, 10).map((draft) => draft.dedupeKey),
        staleTaskIds: stale.slice(0, 10).map((task) => task.id)
      }
    };

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const value = key(row);
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
