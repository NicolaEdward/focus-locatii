import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOperationTaskCutoverReview,
  defaultOperationCutoverFilters,
  mediaClassificationForLocationType
} from "../src/lib/dashboard/executive/operation-task-cutover-review";
import type { OperationTaskReconciliationFinding } from "../src/lib/dashboard/executive/operation-task-reconciliation-contracts";
import { createOperationTaskHumanReviewWorkbook } from "../src/lib/dashboard/executive/operation-task-review-export";

const snapshotDate = "2026-07-24";
const reservations = [
  reservation("r-current", "c-current", "l-static", "2026-07-01", "2026-07-31"),
  reservation("r-next", "c-next", "l-static", "2026-08-01", "2026-08-31"),
  reservation("r-recent", "c-recent", "l-static", "2026-05-01", "2026-06-01")
];
const campaigns = [
  campaign("c-current", "Campanie curentă", "2026-07-01", "2026-07-31"),
  campaign("c-next", "Campanie viitoare", "2026-08-01", "2026-08-31"),
  campaign("c-recent", "Campanie recentă", "2026-05-01", "2026-06-01")
];
const locations = [
  { id: "l-static", code: "FM001", type: "Mesh" },
  { id: "l-digital", code: "DOOH01", type: "Ecran digital" },
  { id: "l-unknown", code: "UNK01", type: null }
];
const tasks = [
  task("t-current", "r-current", "c-current", "l-static", "NEW", "DECORATION", "2026-07-24", null),
  task("t-recent", "r-recent", "c-recent", "l-static", "DONE", "NEUTRALIZATION", "2026-06-02", "2026-06-02"),
  task("t-legacy", null, null, "l-static", "NEW", "DECORATION", "2024-01-01", null, "LEGACY_PRODUCTION_NOTES")
];
const findings: OperationTaskReconciliationFinding[] = [
  finding("f-unassigned", "UNASSIGNED_ACTIVE_TASK", "ACTIVE_TASK_ASSIGNEE_MISSING", { taskId: "t-current", reservationId: "r-current", campaignId: "c-current", locationId: "l-static" }),
  finding("f-proof", "COMPLETED_WITHOUT_PROOF", "DONE_PROOF_MISSING", { taskId: "t-recent", reservationId: "r-recent", campaignId: "c-recent", locationId: "l-static" }),
  finding("f-orphan", "ORPHAN_OPERATION_TASK", "NO_ACTIVE_BOOKED_OR_CAMPAIGN", { taskId: "t-legacy", locationId: "l-static" }),
  finding("f-legacy", "LEGACY_OR_STALE_TASK", "LEGACY_SOURCE_REVIEW", { taskId: "t-legacy", locationId: "l-static" }),
  finding("f-missing-decoration", "BOOKED_WITHOUT_OPERATION_TASK", "REQUIRED_TASK_MISSING", { reservationId: "r-next", campaignId: "c-next", locationId: "l-static", kind: "DECORATION" }),
  finding("f-missing-neutralization", "NEUTRALIZATION_MISSING", "REQUIRED_NEUTRALIZATION_TASK_MISSING", { reservationId: "r-next", campaignId: "c-next", locationId: "l-static", kind: "NEUTRALIZATION" }),
  finding("f-changeover", "POSSIBLE_CHANGEOVER", "CONSECUTIVE_BOOKED_POSSIBLE_CHANGEOVER", {
    reservationId: "r-current",
    campaignId: "c-current",
    locationId: "l-static",
    evidence: [
      { label: "BOOKED curent", value: "r-current" },
      { label: "BOOKED următor", value: "r-next" }
    ]
  })
];

const input = {
  reservations,
  tasks,
  campaigns,
  locations,
  findings,
  snapshotDate,
  filters: defaultOperationCutoverFilters(),
  cursor: null,
  limit: 50
};
const first = buildOperationTaskCutoverReview(input);
const second = buildOperationTaskCutoverReview(input);

assert.equal(first.summary.decisionCases, 6, "3 taskuri + 2 taskuri lipsă + 1 changeover trebuie să fie 6 cazuri.");
assert.equal(first.summary.findingOccurrences, 7, "Constatările suprapuse nu trebuie prezentate drept cazuri.");
assert.equal(first.summary.taskCases, 3);
assert.equal(first.summary.missingTaskCases, 2);
assert.equal(first.summary.changeoverCases, 1);
assert.equal(first.summary.byReviewGroup.DETERMINISTIC, 2);
assert.equal(first.summary.byReviewGroup.HUMAN_REVIEW, 3);
assert.equal(first.summary.byReviewGroup.LEGACY_EXCLUDED, 1);
assert.deepEqual(
  first.cases.map((row) => row.stableCaseId),
  second.cases.map((row) => row.stableCaseId),
  "stableCaseId trebuie să fie determinist."
);
assert.equal(Object.values(first.summary.byReviewGroup).reduce((sum, value) => sum + value, 0), first.summary.decisionCases);
assert.equal(Object.values(first.summary.byPriority).reduce((sum, value) => sum + value, 0), first.summary.decisionCases);
assert.equal(first.cases.every((row) => row.humanDecision === "" && row.reviewerNotes === ""), true);
assert.equal(first.cases.every((row) => row.proposedMetricsEligibility.policyStatus === "PROPOSED_NOT_ACTIVE"), true);
assert.equal(first.cutoverOptions.filter((row) => row.recommended).length, 1);
assert.equal(first.cutoverOptions.find((row) => row.recommended)?.id, "AFTER_CRITICAL_REVIEW");
assert.equal(first.rootCause.assignmentIsNotAutoInferred, true);
assert.equal(first.assignmentCompleteness.find((row) => row.id === "ALL_ACTIVE")?.completeness, 0);
assert.equal(first.assignmentCompleteness.find((row) => row.id === "DUE_7_DAYS")?.target, 100);

assert.equal(mediaClassificationForLocationType("Mesh"), "STATIC");
assert.equal(mediaClassificationForLocationType("Ecran digital"), "DIGITAL");
assert.equal(mediaClassificationForLocationType("mesh + digital"), "MIXED");
assert.equal(mediaClassificationForLocationType(null), "UNKNOWN");
assert.equal(first.mediaMatrix.reduce((sum, row) => sum + row.locationCount, 0), locations.length);

const critical = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, priority: "CRITICAL_CURRENT" }
});
assert.equal(critical.cases.every((row) => row.priority === "CRITICAL_CURRENT"), true);
const anomaly = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, anomalyCode: "DONE_PROOF_MISSING" }
});
assert.equal(anomaly.cases.length, 1);
assert.equal(anomaly.cases[0].operationTaskId, "t-recent");
const campaignFilter = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, campaign: "VIITOARE" }
});
assert.equal(campaignFilter.cases.length, 2);
const locationFilter = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, location: "FM001" }
});
assert.equal(locationFilter.filteredCaseCount, first.summary.decisionCases);
const statusFilter = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, status: "DONE" }
});
assert.equal(statusFilter.cases.length, 1);
assert.equal(statusFilter.cases[0].operationTaskId, "t-recent");
const mediaFilter = buildOperationTaskCutoverReview({
  ...input,
  filters: { ...input.filters, medium: "STATIC" }
});
assert.equal(mediaFilter.filteredCaseCount, first.summary.decisionCases);

const workbook = createOperationTaskHumanReviewWorkbook(first);
assert.equal(workbook.subarray(0, 2).toString("utf8"), "PK");
assert(workbook.length > 2_000);

const serviceSource = readFileSync("src/lib/dashboard/executive/operation-task-reconciliation.ts", "utf8");
const routeSource = readFileSync("src/app/api/admin/executive/operation-task-reconciliation/export/route.ts", "utf8");
const panelSource = readFileSync("src/components/admin/OperationTaskReconciliationPanel.tsx", "utf8");
for (const source of [serviceSource, routeSource]) {
  for (const forbidden of [
    /prisma\.\w+\.create(?:Many)?\(/,
    /prisma\.\w+\.update(?:Many)?\(/,
    /prisma\.\w+\.upsert\(/,
    /prisma\.\w+\.delete(?:Many)?\(/,
    /prisma\.\$transaction\(/,
    /recordAudit\(/
  ]) {
    assert.equal(forbidden.test(source), false, `Exportul read-only conține un semnal de scriere: ${forbidden}`);
  }
}
assert(routeSource.includes('requirePermission(request, "dashboard.executive.view")'));
assert(routeSource.includes('"cache-control": "private, no-store"'));
assert.equal(panelSource.includes("onClick="), false);
assert.equal(panelSource.includes("bulk"), false);
assert(panelSource.includes("Exportă analiza"));

console.log(JSON.stringify({
  ok: true,
  checks: 38,
  decisionCases: first.summary.decisionCases,
  findings: first.summary.findingOccurrences,
  groups: first.summary.byReviewGroup,
  priorities: first.summary.byPriority,
  matrix: first.mediaMatrix.map((row) => ({ type: row.locationType, classification: row.classification })),
  workbookBytes: workbook.length,
  zeroWrite: true
}, null, 2));

function campaign(id: string, campaignName: string, startDate: string, endDate: string) {
  return {
    id,
    campaignName,
    companyEntity: "Focus Media",
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    client: { companyName: "Client test" }
  };
}

function reservation(id: string, campaignId: string, locationId: string, start: string, end: string) {
  return {
    id,
    status: "BOOKED",
    campaignId,
    locationId,
    clientId: "client-1",
    clientName: "Client test",
    clientCompany: "Client test",
    campaignName: `Campanie ${campaignId}`,
    contractCompany: "Focus Media",
    periodStart: new Date(`${start}T00:00:00.000Z`),
    periodEnd: new Date(`${end}T00:00:00.000Z`),
    installationDate: null,
    neutralizationDate: null,
    bookedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function task(
  id: string,
  reservationId: string | null,
  campaignId: string | null,
  locationId: string,
  status: string,
  kind: string,
  scheduledFor: string,
  completedAt: string | null,
  source = "SYSTEM_DERIVED"
) {
  return {
    id,
    reservationId,
    campaignId,
    locationId,
    kind,
    status,
    source,
    scheduledFor: new Date(`${scheduledFor}T08:00:00.000Z`),
    completedAt: completedAt ? new Date(`${completedAt}T12:00:00.000Z`) : null,
    assignedToUserId: null,
    createdByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function finding(
  id: string,
  category: OperationTaskReconciliationFinding["category"],
  reasonCode: string,
  overrides: Partial<OperationTaskReconciliationFinding> = {}
): OperationTaskReconciliationFinding {
  return {
    id,
    category,
    batch: "NEEDS_HUMAN_CONFIRMATION",
    entityCode: "FOCUS_MEDIA",
    entityLabel: "Focus Media",
    kind: "DECORATION",
    status: "NEW",
    medium: "STATIC",
    confidence: 100,
    dataQualityState: "HIGH",
    reasonCode,
    title: reasonCode,
    summary: reasonCode,
    taskId: null,
    reservationId: null,
    campaignId: null,
    locationId: null,
    scheduledFor: null,
    evidence: [{ label: "Motiv", value: reasonCode }],
    deepLink: "/admin/operational",
    ...overrides
  };
}
