const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const adapter = loadTsModule(path.join(process.cwd(), "src", "lib", "operation-task-read-adapter.ts"), {
  "@/lib/prisma": { prisma: {} }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  await flagSafetyAndDashboardBranch();
  await relationalRowsWinWithLegacyFallback();
  await noDuplicateTasksForSameDedupeKey();
  await activeAndHistoryStatusRules();
  await holdReservationsNeverProduceOperationalTasks();
  await legacyDecorationCostSurvivesFallback();
  await redecorationTaskAppearsCorrectly();
  await comparisonReportsZeroMismatchForMatchingFixtures();
  await corruptedLegacyMetadataDoesNotCrash();
  await dtoShapeRemainsCompatible();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "flag off keeps dashboard legacy branch",
      "production read flag disabled even if env is true",
      "flag on uses relational rows",
      "legacy fallback when relational row missing",
      "relational row wins when both exist",
      "no duplicate task for same dedupeKey",
      "DONE excluded from active",
      "ARCHIVED included in history",
      "CANCELLED excluded from active",
      "HOLD reservations produce no operational tasks",
      "legacy decoration cost appears in fallback DTO",
      "redecoration task appears correctly",
      "matching fixtures compare cleanly",
      "corrupted productionNotes does not crash",
      "DTO shape remains compatible"
    ]
  }, null, 2));
}

async function holdReservationsNeverProduceOperationalTasks() {
  const reservation = bookedReservation({ status: "HOLD" });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-decoration-hold", reservation, "DECORATION", "NEW", "2026-07-03T00:00:00.000Z")
    ],
    ...windowFilters()
  });

  assert.equal(result.active.length, 0, "HOLD reservations must not appear as active operation tasks");
  assert.equal(result.tasks.length, 0, "HOLD reservations must not appear in merged operation task list");
}

async function flagSafetyAndDashboardBranch() {
  assert.equal(adapter.operationTaskReadsEnabled({}), false, "missing read flag should be off");
  assert.equal(adapter.operationTaskReadsEnabled({ OPERATION_TASK_READS_ENABLED: "true", VERCEL_ENV: "production" }), false, "production must not enable reads");
  assert.equal(adapter.operationTaskReadsEnabled({ OPERATION_TASK_READS_ENABLED: "true", VERCEL_ENV: "preview" }), true, "staging/preview can opt in");

  const dashboard = fs.readFileSync(path.join(process.cwd(), "src", "lib", "dashboard.ts"), "utf8");
  assert(dashboard.includes("operationTaskReadsEnabled()"), "dashboard must gate OperationTask reads behind the read flag");
  assert(dashboard.includes(": legacyDecorationTasks"), "dashboard must preserve legacy decoration reader when flag is off");
  assert(dashboard.includes(": legacyNeutralizationTasks"), "dashboard must preserve legacy neutralization reader when flag is off");
}

async function relationalRowsWinWithLegacyFallback() {
  const reservation = bookedReservation({
    productionNotes: legacyMeta({
      decorationStatus: "NEW",
      neutralizationStatus: "NEW"
    })
  });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-decoration", reservation, "DECORATION", "IN_PROGRESS", "2026-07-03T00:00:00.000Z")
    ],
    ...windowFilters()
  });

  const decoration = result.active.find((task) => task.kind === "decoration" && task.taskId == null);
  const neutralization = result.active.find((task) => task.kind === "neutralization");
  assert(decoration, "decoration should be present");
  assert.equal(decoration.status, "IN_PROGRESS", "relational decoration status should win over legacy");
  assert.equal(decoration.source, "relational");
  assert(neutralization, "neutralization should fallback to legacy");
  assert.equal(neutralization.source, "legacy");
}

async function noDuplicateTasksForSameDedupeKey() {
  const reservation = bookedReservation();
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-decoration", reservation, "DECORATION", "IN_PROGRESS", "2026-07-03T00:00:00.000Z")
    ],
    ...windowFilters()
  });

  const decorations = result.active.filter((task) => task.dedupeKey === `reservation:${reservation.id}:DECORATION:base`);
  assert.equal(decorations.length, 1, "relational and legacy base decoration must not double-count");
}

async function activeAndHistoryStatusRules() {
  const reservation = bookedReservation();
  const done = await adapter.listActiveOperationTasks({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-done", reservation, "DECORATION", "DONE", "2026-07-03T00:00:00.000Z"),
      relationalTask("task-cancelled", reservation, "NEUTRALIZATION", "CANCELLED", "2026-08-28T00:00:00.000Z")
    ],
    ...windowFilters()
  });
  assert(!done.some((task) => task.operationTaskId === "task-done"), "DONE task should not be active");
  assert(!done.some((task) => task.operationTaskId === "task-cancelled"), "CANCELLED task should not be active");

  const archived = await adapter.listArchivedOperationTasks({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-archived", reservation, "DECORATION", "ARCHIVED", "2026-07-03T00:00:00.000Z")
    ],
    ...windowFilters()
  });
  assert(archived.some((task) => task.operationTaskId === "task-archived"), "ARCHIVED task should remain visible in history");
}

async function legacyDecorationCostSurvivesFallback() {
  const reservation = bookedReservation({
    productionNotes: legacyMeta({
      decorationStatus: "NEW",
      decorationCost: 420,
      decorationCurrency: "EUR"
    })
  });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [],
    ...windowFilters()
  });
  const task = result.active.find((item) => item.kind === "decoration" && item.taskId == null);
  assert(task, "legacy base decoration should be present");
  assert.equal(task.cost, 420, "legacy base decoration cost should be exposed");
  assert.equal(task.currency, "EUR", "legacy base decoration currency should be exposed");
}

async function redecorationTaskAppearsCorrectly() {
  const reservation = bookedReservation({
    productionNotes: legacyMeta({
      tasks: [{
        id: "red-1",
        kind: "decoration",
        status: "NEW",
        taskType: "redecoration",
        taskDate: "2026-07-12T00:00:00.000Z",
        note: "Schimbare vizual"
      }]
    })
  });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-red-1", reservation, "REDECORATION", "IN_PROGRESS", "2026-07-12T00:00:00.000Z", "red-1")
    ],
    ...windowFilters()
  });

  const task = result.active.find((item) => item.taskId === "red-1");
  assert(task, "redecoration should appear");
  assert.equal(task.kind, "decoration", "redecoration remains decoration kind for legacy UI commands");
  assert.equal(task.taskKind, "REDECORATION");
  assert.equal(task.status, "IN_PROGRESS");
  assert.equal(task.source, "relational");
}

async function comparisonReportsZeroMismatchForMatchingFixtures() {
  const reservation = bookedReservation({
    productionNotes: legacyMeta({
      decorationStatus: "NEW",
      neutralizationStatus: "DONE",
      neutralizationUpdatedAt: "2026-08-28T10:00:00.000Z"
    })
  });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-decoration", reservation, "DECORATION", "NEW", "2026-07-03T00:00:00.000Z"),
      relationalTask("task-neutralization", reservation, "NEUTRALIZATION", "DONE", "2026-08-28T00:00:00.000Z")
    ],
    ...windowFilters()
  });

  assert.equal(result.comparison.mismatchedDedupeKeys.length, 0, "matching relational/legacy tasks should not mismatch");
  assert.equal(result.comparison.missingLegacyDedupeKeys.length, 0, "matching relational tasks should have legacy peers");
  assert.equal(result.comparison.missingRelationalDedupeKeys.length, 0, "matching legacy tasks should have relational peers");
  assert.equal(result.comparison.doubleCountRiskCount, 0, "matching relational/legacy overlap should not be counted as a double-count risk");
  assert.equal(result.active.filter((task) => task.dedupeKey === `reservation:${reservation.id}:DECORATION:base`).length, 1, "merged result still has one decoration");
}

async function corruptedLegacyMetadataDoesNotCrash() {
  const reservation = bookedReservation({
    productionNotes: "plain notes <!--focus-ops:{not-json--> trailing"
  });
  const result = await adapter.listOperationalTasksWithFallback({
    reservations: [reservation],
    relationalTasks: [],
    ...windowFilters()
  });
  assert(result.active.length >= 2, "corrupted legacy metadata should fall back to base NEW tasks");
}

async function dtoShapeRemainsCompatible() {
  const reservation = bookedReservation();
  const [task] = await adapter.listActiveOperationTasks({
    reservations: [reservation],
    relationalTasks: [
      relationalTask("task-decoration", reservation, "DECORATION", "NEW", "2026-07-03T00:00:00.000Z")
    ],
    ...windowFilters()
  });
  for (const key of [
    "id",
    "reservationId",
    "taskId",
    "kind",
    "status",
    "taskDate",
    "overdue",
    "note",
    "cost",
    "currency",
    "code",
    "city",
    "clientName",
    "campaignName",
    "salesperson",
    "periodStart",
    "periodEnd"
  ]) {
    assert(Object.prototype.hasOwnProperty.call(task, key), `DTO missing ${key}`);
  }
}

function bookedReservation(overrides = {}) {
  return {
    id: "reservation-1",
    campaignId: "campaign-1",
    locationId: "location-1",
    status: "BOOKED",
    clientName: "Client Test",
    campaignName: "Campanie Test",
    salesperson: "Seller Test",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    installationDate: new Date("2026-07-03T00:00:00.000Z"),
    neutralizationDate: new Date("2026-08-28T00:00:00.000Z"),
    productionNotes: null,
    sellerUser: { name: "Seller User" },
    location: { id: "location-1", code: "B001", city: "Bucuresti" },
    ...overrides
  };
}

function relationalTask(id, reservation, kind, status, scheduledFor, legacyTaskId = null) {
  return {
    id,
    reservationId: reservation.id,
    campaignId: reservation.campaignId,
    locationId: reservation.locationId,
    kind,
    status,
    source: legacyTaskId ? "LEGACY_PRODUCTION_NOTES" : "SYSTEM_DERIVED",
    dedupeKey: legacyTaskId
      ? `reservation:${reservation.id}:legacy-extra:${legacyTaskId}`
      : `reservation:${reservation.id}:${kind}:base`,
    legacyTaskId,
    scheduledFor: new Date(scheduledFor),
    completedAt: status === "DONE" ? new Date(scheduledFor) : null,
    notes: legacyTaskId ? "Schimbare vizual" : null
  };
}

function windowFilters() {
  return {
    now: new Date("2026-06-15T00:00:00.000Z"),
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    decorationWindowEnd: new Date("2026-07-31T00:00:00.000Z"),
    neutralizationWindowEnd: new Date("2026-08-31T00:00:00.000Z")
  };
}

function legacyMeta(meta) {
  return `Legacy notes\n<!--focus-ops:${JSON.stringify(meta)}-->`;
}
