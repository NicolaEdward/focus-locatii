const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const {
  buildOperationTaskDedupeKey,
  deriveBaseTasksFromReservation,
  dedupeOperationTaskDrafts,
  normalizeLegacyOperationStatus,
  parseLegacyOperationTasksForMigration,
  toOperationTaskStatus,
  validateOperationTaskInput
} = loadTsModule(path.join(process.cwd(), "src", "lib", "operation-tasks.ts"));

main();

function main() {
  const baseReservation = reservation();

  const base = deriveBaseTasksFromReservation(baseReservation);
  assert.equal(base.issues.length, 0, "valid base reservation should not produce derivation issues");
  const decoration = base.tasks.find((task) => task.kind === "DECORATION");
  const neutralization = base.tasks.find((task) => task.kind === "NEUTRALIZATION");
  assert(decoration, "decoration base task should be created");
  assert(neutralization, "neutralization base task should be created");
  assert.equal(decoration.scheduledFor.toISOString(), "2026-07-03T00:00:00.000Z", "decoration should use installationDate");
  assert.equal(neutralization.scheduledFor.toISOString(), "2026-08-28T00:00:00.000Z", "neutralization should use neutralizationDate");

  const decorationFallback = deriveBaseTasksFromReservation(reservation({ installationDate: null }));
  assert.equal(
    decorationFallback.tasks.find((task) => task.kind === "DECORATION").scheduledFor.toISOString(),
    "2026-07-01T00:00:00.000Z",
    "decoration should fall back to periodStart"
  );

  const neutralizationFallback = deriveBaseTasksFromReservation(reservation({ neutralizationDate: null }));
  assert.equal(
    neutralizationFallback.tasks.find((task) => task.kind === "NEUTRALIZATION").scheduledFor.toISOString(),
    "2026-08-31T00:00:00.000Z",
    "neutralization should fall back to periodEnd"
  );

  const missingDates = deriveBaseTasksFromReservation(reservation({
    installationDate: null,
    neutralizationDate: null,
    periodStart: null,
    periodEnd: null
  }));
  assert.equal(missingDates.tasks.length, 0, "missing operation dates should not create incomplete drafts");
  assert(
    missingDates.issues.some((issue) => issue.code === "missing_decoration_base_data"),
    "missing decoration date should be reported"
  );
  assert(
    missingDates.issues.some((issue) => issue.code === "missing_neutralization_base_data"),
    "missing neutralization date should be reported"
  );

  assert.equal(
    buildOperationTaskDedupeKey({ reservationId: "res-1", kind: "DECORATION", variant: "base" }),
    "reservation:res-1:DECORATION:base",
    "decoration base dedupe key should be stable"
  );
  assert.equal(
    buildOperationTaskDedupeKey({ reservationId: "res-1", kind: "REDECORATION", legacyTaskId: "legacy-1", variant: "legacy-extra" }),
    "reservation:res-1:legacy-extra:legacy-1",
    "legacy extra dedupe key should be stable"
  );

  const repeated = dedupeOperationTaskDrafts([...base.tasks, ...deriveBaseTasksFromReservation(baseReservation).tasks]);
  assert.equal(repeated.tasks.length, 2, "repeated derivation should dedupe by key");
  assert.equal(repeated.issues.filter((issue) => issue.code === "duplicate_dedupe_key").length, 2, "duplicate keys should be reported");

  const legacy = parseLegacyOperationTasksForMigration(reservation({
    productionNotes: legacyMeta({
      decorationStatus: "DONE",
      decorationUpdatedAt: "2026-07-04T10:00:00.000Z",
      neutralizationStatus: "ARCHIVED",
      neutralizationUpdatedAt: "2026-09-01T10:00:00.000Z",
      tasks: [{
        id: "legacy-red-1",
        kind: "decoration",
        status: "IN_PROGRESS",
        taskType: "redecoration",
        taskDate: "2026-07-20T00:00:00.000Z",
        cost: 125,
        currency: "RON",
        note: "Schimbare vizual",
        briefUrl: "https://example.invalid/brief.pdf",
        createdByUserId: "user-1"
      }]
    })
  }));
  assert.equal(legacy.issues.length, 0, "valid legacy redecoration task should not produce issues");
  assert.equal(legacy.tasks.length, 1, "legacy redecoration task should be parsed");
  assert.equal(legacy.tasks[0].kind, "REDECORATION", "legacy redecoration should map to REDECORATION");
  assert.equal(legacy.tasks[0].source, "LEGACY_PRODUCTION_NOTES", "legacy task source should be preserved");
  assert.equal(legacy.tasks[0].dedupeKey, "reservation:res-1:legacy-extra:legacy-red-1", "legacy task should use legacy dedupe key");

  const legacyStatuses = deriveBaseTasksFromReservation(reservation({
    productionNotes: legacyMeta({
      decorationStatus: "DONE",
      decorationUpdatedAt: "2026-07-04T10:00:00.000Z",
      neutralizationStatus: "ARCHIVED"
    })
  }));
  assert.equal(legacyStatuses.tasks.find((task) => task.kind === "DECORATION").status, "DONE", "DONE legacy status should map to DONE");
  assert.equal(legacyStatuses.tasks.find((task) => task.kind === "NEUTRALIZATION").status, "ARCHIVED", "ARCHIVED legacy status should map to ARCHIVED");
  assert.equal(legacyStatuses.tasks.find((task) => task.kind === "DECORATION").completedAt.toISOString(), "2026-07-04T10:00:00.000Z", "DONE base task should preserve completion timestamp when available");

  const corrupted = deriveBaseTasksFromReservation(reservation({
    productionNotes: "notes <!--focus-ops:{not-json--> trailing text"
  }));
  assert.equal(corrupted.tasks.length, 2, "corrupted metadata should not prevent base task derivation");
  assert(
    corrupted.issues.some((issue) => issue.code === "corrupted_legacy_metadata"),
    "corrupted metadata should be reported"
  );

  assert.equal(toOperationTaskStatus("IN_PROGRESS"), "IN_PROGRESS", "IN_PROGRESS maps directly");
  assert.equal(normalizeLegacyOperationStatus("BROKEN").status, "NEW", "unknown legacy status defaults safely to NEW");

  assert.equal(validateOperationTaskInput({ kind: "DECORATION", status: "NEW" }).valid, false, "DECORATION requires reservationId");
  assert.equal(validateOperationTaskInput({ kind: "NEUTRALIZATION", status: "NEW" }).valid, false, "NEUTRALIZATION requires reservationId");
  assert.equal(validateOperationTaskInput({ kind: "REDECORATION", status: "NEW" }).valid, false, "REDECORATION requires reservationId");
  assert.equal(
    validateOperationTaskInput({ kind: "MAINTENANCE", status: "NEW", locationId: "loc-1" }).valid,
    true,
    "MAINTENANCE can be location-only"
  );

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "decoration from installationDate",
      "decoration fallback to periodStart",
      "neutralization from neutralizationDate",
      "neutralization fallback to periodEnd",
      "missing dates report issues",
      "stable dedupe keys",
      "dedupe repeated derivation",
      "legacy redecoration mapping",
      "legacy DONE and ARCHIVED mapping",
      "corrupted metadata safe",
      "phase-one validation rules"
    ]
  }, null, 2));
}

function reservation(overrides = {}) {
  return {
    id: "res-1",
    campaignId: "campaign-1",
    locationId: "location-1",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-31T00:00:00.000Z",
    installationDate: "2026-07-03T00:00:00.000Z",
    neutralizationDate: "2026-08-28T00:00:00.000Z",
    productionNotes: null,
    ...overrides
  };
}

function legacyMeta(meta) {
  return `Plain production notes\n<!--focus-ops:${JSON.stringify(meta)}-->`;
}
