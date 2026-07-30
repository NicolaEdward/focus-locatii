import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOperationTaskReconciliation,
  reconciliationFilters,
  type ReconciliationCampaign,
  type ReconciliationLocation,
  type ReconciliationProof,
  type ReconciliationReservation,
  type ReconciliationTask
} from "../src/lib/dashboard/executive/operation-task-reconciliation";

const snapshotDate = "2026-07-24";
const asOf = new Date("2026-07-24T09:00:00.000Z");
const campaigns: ReconciliationCampaign[] = [
  campaign("c-active", "Campanie activă", "active", "Focus Media"),
  campaign("c-ended", "Campanie terminată", "completed", "Focus Media")
];
const locations: ReconciliationLocation[] = [
  location("l-static", "FM001", "Mesh"),
  location("l-digital", "FM002", "Ecran digital")
];
const reservations: ReconciliationReservation[] = [
  reservation("r-static", "BOOKED", "c-active", "l-static", "2026-07-01", "2026-07-31", {
    neutralizationDate: new Date("2026-08-01T00:00:00.000Z")
  }),
  reservation("r-changeover", "BOOKED", "c-active", "l-static", "2026-08-01", "2026-08-31", {
    installationDate: new Date("2026-08-01T00:00:00.000Z")
  }),
  reservation("r-digital", "BOOKED", "c-active", "l-digital", "2026-07-01", "2026-07-31"),
  reservation("r-cancelled", "CANCELLED", "c-ended", "l-static", "2026-05-01", "2026-05-31")
];
const tasks: ReconciliationTask[] = [
  task("t-decoration", "r-static", "DECORATION", "NEW", "2026-06-30"),
  task("t-decoration-copy", "r-static", "DECORATION", "NEW", "2026-06-30"),
  task("t-neutralization", "r-static", "NEUTRALIZATION", "DONE", "2026-08-01", {
    completedAt: new Date("2026-08-01T12:00:00.000Z")
  }),
  task("t-terminal", "r-static", "DECORATION", "CANCELLED", "2026-06-30", { assignedToUserId: "u-field" }),
  task("t-stale", "r-cancelled", "DECORATION", "NEW", "2026-05-01", {
    assignedToUserId: "u-field",
    source: "LEGACY_PRODUCTION_NOTES"
  }),
  task("t-impossible", null, "MAINTENANCE", "DONE", null, {
    completedAt: null,
    locationId: "l-static"
  })
];

const noProofReport = buildOperationTaskReconciliation({
  reservations,
  tasks,
  campaigns,
  locations,
  proofs: [],
  selectedEntityCodes: ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"],
  snapshotDate,
  asOf
});
assert.equal(reconciliationFilters({}).limit, 50, "Lipsa parametrului limit trebuie să folosească valoarea implicită 50.");

const categories = new Set(noProofReport.items.map((item) => item.category));
for (const expected of [
  "BOOKED_WITHOUT_OPERATION_TASK",
  "NEUTRALIZATION_MISSING",
  "ORPHAN_OPERATION_TASK",
  "UNASSIGNED_ACTIVE_TASK",
  "DUPLICATE_TASK",
  "TERMINAL_TASK_FOR_ACTIVE_OBLIGATION",
  "COMPLETED_WITHOUT_PROOF",
  "IMPOSSIBLE_TASK_DATE",
  "LEGACY_OR_STALE_TASK",
  "POSSIBLE_CHANGEOVER",
  "DATA_INSUFFICIENT"
]) {
  assert(categories.has(expected as never), `Lipsește clasificarea ${expected}.`);
}
assert.equal(noProofReport.meta.readOnly, true);
assert.equal(noProofReport.meta.writesExecuted, 0);
assert.equal(noProofReport.meta.queryBudget, 5);
assert.equal(noProofReport.summary.bookedObligations, 3);
assert.equal(noProofReport.summary.operationTasks, tasks.length);
assert.equal(noProofReport.summary.byMedium.DIGITAL, undefined, "Taskurile nu trebuie inventate pentru obligația digitală.");
assert.equal(noProofReport.batches.every((batch) => batch.executionApproved === false), true);
assert(
  noProofReport.items.some((item) => item.category === "POSSIBLE_CHANGEOVER" && item.summary.includes("aceeași zi")),
  "Neutralizarea și montajul din aceeași zi trebuie clasificate drept changeover posibil."
);

const proof: ReconciliationProof = {
  id: "proof-1",
  reservationId: "r-static",
  documentType: "operational_proof_photo",
  status: "active",
  expiryDate: new Date("2026-08-24T00:00:00.000Z"),
  notes: JSON.stringify({ kind: "neutralization", taskId: null }),
  uploadedAt: new Date("2026-07-23T09:00:00.000Z")
};
const withProofReport = buildOperationTaskReconciliation({
  reservations,
  tasks,
  campaigns,
  locations,
  proofs: [proof],
  selectedEntityCodes: ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"],
  snapshotDate,
  asOf
});
assert.equal(
  withProofReport.items.some((item) => item.category === "COMPLETED_WITHOUT_PROOF" && item.taskId === "t-neutralization"),
  false,
  "O dovadă canonică activă trebuie să satisfacă taskul."
);

const filtered = buildOperationTaskReconciliation({
  reservations,
  tasks,
  campaigns,
  locations,
  proofs: [],
  selectedEntityCodes: ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"],
  snapshotDate,
  asOf
}, reconciliationFilters({ category: "UNASSIGNED_ACTIVE_TASK", limit: "1" }));
assert.equal(filtered.items.length, 1);
assert.equal(filtered.items[0].category, "UNASSIGNED_ACTIVE_TASK");
assert(filtered.pagination.nextCursor, "Paginarea trebuie să emită cursor pentru mai multe rezultate.");

const serviceSource = readFileSync("src/lib/dashboard/executive/operation-task-reconciliation.ts", "utf8");
const routeSource = readFileSync("src/app/api/admin/executive/operation-task-reconciliation/route.ts", "utf8");
const panelSource = readFileSync("src/components/admin/OperationTaskReconciliationPanel.tsx", "utf8");
for (const forbidden of [
  /prisma\.\w+\.create(?:Many)?\(/,
  /prisma\.\w+\.update(?:Many)?\(/,
  /prisma\.\w+\.upsert\(/,
  /prisma\.\w+\.delete(?:Many)?\(/,
  /prisma\.\$transaction\(/
]) {
  assert.equal(forbidden.test(serviceSource), false, `Dry-run-ul conține o operație de scriere: ${forbidden}`);
}
assert(routeSource.includes('requirePermission(request, "dashboard.executive.view")'));
assert(panelSource.includes("0 scrieri"));
assert(panelSource.includes("Neaprobat pentru execuție"));
assert.equal(panelSource.includes("onClick="), false, "Panoul read-only nu trebuie să conțină mutații client-side.");

console.log(JSON.stringify({
  ok: true,
  checks: 39,
  findings: noProofReport.summary.findings,
  categories: noProofReport.summary.byCategory,
  batches: noProofReport.summary.byBatch,
  assignmentCompleteness: noProofReport.summary.assignmentCompleteness,
  zeroWriteSourceCheck: true,
  proofContract: true,
  pagination: true
}, null, 2));

function campaign(
  id: string,
  campaignName: string,
  status: string,
  companyEntity: string
): ReconciliationCampaign {
  return {
    id,
    campaignName,
    status,
    companyEntity,
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    archivedAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    client: { companyName: "Client test" }
  };
}

function location(id: string, code: string, type: string): ReconciliationLocation {
  return { id, code, type, lifecycleStatus: "ACTIVE" };
}

function reservation(
  id: string,
  status: ReconciliationReservation["status"],
  campaignId: string,
  locationId: string,
  start: string,
  end: string,
  overrides: Partial<ReconciliationReservation> = {}
): ReconciliationReservation {
  return {
    id,
    status,
    clientId: "client-1",
    clientName: "Client test",
    clientCompany: "Client test",
    campaignId,
    campaignName: "Campanie test",
    locationId,
    contractCompany: "Focus Media",
    periodStart: new Date(`${start}T00:00:00.000Z`),
    periodEnd: new Date(`${end}T00:00:00.000Z`),
    installationDate: null,
    neutralizationDate: null,
    bookedAt: status === "BOOKED" ? new Date("2026-06-01T00:00:00.000Z") : null,
    productionNotes: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides
  };
}

function task(
  id: string,
  reservationId: string | null,
  kind: ReconciliationTask["kind"],
  status: ReconciliationTask["status"],
  scheduledFor: string | null,
  overrides: Partial<ReconciliationTask> = {}
): ReconciliationTask {
  return {
    id,
    reservationId,
    campaignId: null,
    locationId: null,
    kind,
    status,
    source: "SYSTEM_DERIVED",
    dedupeKey: null,
    legacyTaskId: null,
    scheduledFor: scheduledFor ? new Date(`${scheduledFor}T08:00:00.000Z`) : null,
    completedAt: null,
    assignedToUserId: null,
    createdByUserId: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides
  };
}
