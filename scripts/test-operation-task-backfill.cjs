const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const {
  buildOperationTaskBackfillPlan,
  executeOperationTaskBackfill,
  writeOperationTaskBackfill
} = loadTsModule(path.join(process.cwd(), "src", "lib", "operation-task-backfill.ts"));

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const fixtures = reservations();
  const existingDedupeKeys = new Set(["reservation:res-1:DECORATION:base"]);
  const plan = buildOperationTaskBackfillPlan(fixtures, {
    existingDedupeKeys,
    alreadyExistingOperationTaskCount: 1,
    operationTaskTableAccessible: true
  });

  assert.equal(plan.report.reservationsScanned, 4, "all fixture reservations should be scanned");
  assert.equal(plan.report.derivedTaskCount, 5, "base plus legacy derived task count should match fixtures");
  assert.equal(plan.report.wouldCreateCount, 4, "existing dedupe key should be skipped");
  assert.equal(plan.report.wouldSkipExistingCount, 1, "one existing task should be skipped");
  assert.equal(plan.report.alreadyExistingOperationTaskCount, 1, "existing OperationTask count should be reported");
  assert.equal(plan.report.tasksByKind.DECORATION, 1, "would-create decoration count should match");
  assert.equal(plan.report.tasksByKind.NEUTRALIZATION, 2, "would-create neutralization count should match");
  assert.equal(plan.report.tasksByKind.REDECORATION, 1, "would-create redecoration count should match");
  assert.equal(plan.report.tasksByKind.MAINTENANCE, 0, "no maintenance tasks expected");
  assert.equal(plan.report.tasksByStatus.NEW, 2, "two NEW tasks expected");
  assert.equal(plan.report.tasksByStatus.IN_PROGRESS, 1, "one IN_PROGRESS task expected");
  assert.equal(plan.report.tasksByStatus.DONE, 0, "DONE task is existing and skipped");
  assert.equal(plan.report.tasksByStatus.ARCHIVED, 1, "one ARCHIVED task expected");
  assert.equal(plan.report.tasksByStatus.CANCELLED, 0, "no CANCELLED tasks expected");
  assert.equal(plan.report.duplicateDedupeKeysFound, 1, "duplicate legacy task ids should be reported");
  assert.equal(plan.report.corruptedProductionNotesCount, 1, "corrupted productionNotes should be counted");
  assert.equal(plan.report.missingDateCount, 2, "missing decoration and neutralization dates should be counted");
  assert.equal(plan.report.missingClientLinkCount, 1, "missing client links should be counted");
  assert.equal(plan.report.missingCampaignLinkCount, 1, "missing campaign links should be counted");
  assert.equal(plan.report.missingLocationLinkCount, 1, "missing location links should be counted");
  assert.equal(plan.report.comparison.potentialDoubleCountRiskCount, 1, "existing dedupe overlap should be reported as a double-count risk");
  assert(plan.report.warnings.some((warning) => warning.code === "duplicate_dedupe_key"), "duplicate warning should be sampled");
  assert(plan.report.warnings.some((warning) => warning.code === "corrupted_legacy_metadata"), "corruption warning should be sampled");
  assert(!plan.allDrafts.some((task) => task.reservationId === "hold-1"), "HOLD reservations must not create operation task drafts");

  const planAgain = buildOperationTaskBackfillPlan(fixtures, {
    existingDedupeKeys,
    alreadyExistingOperationTaskCount: 1,
    operationTaskTableAccessible: true
  });
  assert.deepEqual(
    planAgain.allDrafts.map((task) => task.dedupeKey),
    plan.allDrafts.map((task) => task.dedupeKey),
    "repeated backfill planning should produce the same dedupe keys"
  );

  let dryRunWriteCalled = false;
  const dryRun = await executeOperationTaskBackfill(fixtures, {
    createMany: async () => {
      dryRunWriteCalled = true;
      throw new Error("dry-run must not write");
    }
  }, {
    write: false,
    existingDedupeKeys,
    alreadyExistingOperationTaskCount: 1,
    operationTaskTableAccessible: true
  });
  assert.equal(dryRun.writeResult, null, "dry-run should not return a write result");
  assert.equal(dryRunWriteCalled, false, "dry-run should not call createMany");

  const createdKeys = new Set();
  const delegate = {
    createMany: async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true, "write mode must use skipDuplicates");
      assert(data.every((row) => row.dedupeKey), "write rows must include dedupeKey");
      let count = 0;
      for (const row of data) {
        if (createdKeys.has(row.dedupeKey)) continue;
        createdKeys.add(row.dedupeKey);
        count += 1;
      }
      return { count };
    }
  };

  const firstWrite = await writeOperationTaskBackfill(plan.createableDrafts, delegate);
  const secondWrite = await writeOperationTaskBackfill(plan.createableDrafts, delegate);
  assert.equal(firstWrite.created, 4, "first write should create all missing fixture tasks");
  assert.equal(secondWrite.created, 0, "second write should create no duplicates");
  assert.equal(secondWrite.skipped, 4, "second write should skip all existing fixture tasks");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "dry-run does not write",
      "write mode uses dedupeKey and skipDuplicates",
      "write mode is idempotent",
      "duplicate legacy task ids reported",
      "corrupted productionNotes reported",
      "missing dates reported",
      "repeated plans keep stable dedupe keys",
      "fixture report counts correct"
    ]
  }, null, 2));
}

function reservations() {
  return [
    {
      id: "res-1",
      clientId: "client-1",
      campaignId: "campaign-1",
      locationId: "location-1",
      status: "BOOKED",
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-31T00:00:00.000Z",
      installationDate: "2026-01-02T00:00:00.000Z",
      neutralizationDate: "2026-01-30T00:00:00.000Z",
      productionNotes: legacyMeta({
        decorationStatus: "DONE",
        decorationUpdatedAt: "2026-01-03T08:00:00.000Z",
        neutralizationStatus: "ARCHIVED",
        tasks: [
          {
            id: "red-1",
            kind: "decoration",
            status: "IN_PROGRESS",
            taskType: "redecoration",
            taskDate: "2026-01-12T00:00:00.000Z"
          },
          {
            id: "red-1",
            kind: "decoration",
            status: "IN_PROGRESS",
            taskType: "redecoration",
            taskDate: "2026-01-12T00:00:00.000Z"
          }
        ]
      })
    },
    {
      id: "res-2",
      clientId: null,
      campaignId: null,
      locationId: "location-2",
      status: "BOOKED",
      periodStart: "2026-02-01T00:00:00.000Z",
      periodEnd: "2026-02-28T00:00:00.000Z",
      installationDate: null,
      neutralizationDate: null,
      productionNotes: "plain notes <!--focus-ops:{not-json--> tail"
    },
    {
      id: "res-3",
      clientId: "client-3",
      campaignId: "campaign-3",
      locationId: null,
      status: "BOOKED",
      periodStart: null,
      periodEnd: null,
      installationDate: null,
      neutralizationDate: null,
      productionNotes: null
    },
    {
      id: "hold-1",
      clientId: "client-hold",
      campaignId: "campaign-hold",
      locationId: "location-hold",
      status: "HOLD",
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-03-31T00:00:00.000Z",
      installationDate: "2026-03-02T00:00:00.000Z",
      neutralizationDate: "2026-03-30T00:00:00.000Z",
      productionNotes: legacyMeta({
        decorationStatus: "NEW",
        neutralizationStatus: "NEW",
        tasks: [{
          id: "hold-red-1",
          kind: "decoration",
          status: "NEW",
          taskType: "redecoration",
          taskDate: "2026-03-12T00:00:00.000Z"
        }]
      })
    }
  ];
}

function legacyMeta(meta) {
  return `Plain production notes\n<!--focus-ops:${JSON.stringify(meta)}-->`;
}
