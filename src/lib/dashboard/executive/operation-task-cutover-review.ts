import { createHash } from "node:crypto";
import type { OperationTaskReconciliationFinding } from "@/lib/dashboard/executive/operation-task-reconciliation-contracts";
import {
  OPERATION_TASK_CUTOVER_CONTRACT_VERSION,
  type OperationCutoverAmbiguityCluster,
  type OperationCutoverAssignmentSlice,
  type OperationCutoverCase,
  type OperationCutoverMediaClassification,
  type OperationCutoverMediaMatrixRow,
  type OperationCutoverPriority,
  type OperationCutoverProposedClassification,
  type OperationCutoverRemediationBatch,
  type OperationCutoverReview,
  type OperationCutoverReviewFilters,
  type OperationCutoverReviewGroup
} from "@/lib/dashboard/executive/operation-task-cutover-contracts";
import { entityLabelForCode } from "@/lib/dashboard/executive/scope";
import { addDateKeyDays, bucharestBusinessDateKey } from "@/lib/dashboard/executive/time";

type ReviewReservation = {
  id: string;
  status: string;
  campaignId: string | null;
  locationId: string;
  clientId: string | null;
  clientName: string;
  clientCompany: string | null;
  campaignName: string | null;
  contractCompany: string | null;
  periodStart: Date;
  periodEnd: Date;
  installationDate: Date | null;
  neutralizationDate: Date | null;
  bookedAt: Date | null;
  createdAt: Date;
};

type ReviewTask = {
  id: string;
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  kind: string;
  status: string;
  source: string;
  scheduledFor: Date | null;
  completedAt: Date | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

type ReviewCampaign = {
  id: string;
  campaignName: string;
  companyEntity: string | null;
  startDate: Date | null;
  endDate: Date | null;
  client?: { companyName: string } | null;
};

type ReviewLocation = {
  id: string;
  code: string;
  type: string | null;
};

export type OperationTaskCutoverReviewInput = {
  reservations: ReviewReservation[];
  tasks: ReviewTask[];
  campaigns: ReviewCampaign[];
  locations: ReviewLocation[];
  findings: OperationTaskReconciliationFinding[];
  snapshotDate: string;
  filters: OperationCutoverReviewFilters;
  cursor: string | null;
  limit: number;
};

export function buildOperationTaskCutoverReview(input: OperationTaskCutoverReviewInput): OperationCutoverReview {
  const reservationById = new Map(input.reservations.map((row) => [row.id, row]));
  const campaignById = new Map(input.campaigns.map((row) => [row.id, row]));
  const locationById = new Map(input.locations.map((row) => [row.id, row]));
  const findingsByTask = groupBy(input.findings.filter((row) => row.taskId), (row) => String(row.taskId));
  const booked = input.reservations.filter((row) => row.status === "BOOKED");
  const bookedByLocationCampaign = groupBy(booked, (row) => `${row.locationId}|${row.campaignId || ""}`);

  const taskCases = input.tasks.map((task) => taskReviewCase({
    task,
    reservationById,
    campaignById,
    locationById,
    findings: findingsByTask.get(task.id) || [],
    bookedCandidates: bookedByLocationCampaign.get(`${task.locationId || ""}|${task.campaignId || ""}`) || [],
    snapshotDate: input.snapshotDate
  }));
  const missingCases = input.findings
    .filter((row) => ["BOOKED_WITHOUT_OPERATION_TASK", "NEUTRALIZATION_MISSING"].includes(row.category))
    .map((finding) => missingTaskReviewCase(finding, reservationById, campaignById, locationById, input.snapshotDate));
  const changeoverCases = input.findings
    .filter((row) => row.category === "POSSIBLE_CHANGEOVER")
    .map((finding) => changeoverReviewCase(finding, reservationById, campaignById, locationById, input.snapshotDate));
  const cases = [...taskCases, ...missingCases, ...changeoverCases].sort(compareCases);
  const filtered = filterReviewCases(cases, input.filters);
  const offset = cursorOffset(input.cursor);
  const page = filtered.slice(offset, offset + input.limit);

  return {
    contractVersion: OPERATION_TASK_CUTOVER_CONTRACT_VERSION,
    summary: {
      decisionCases: cases.length,
      findingOccurrences: input.findings.length,
      taskCases: taskCases.length,
      missingTaskCases: missingCases.length,
      changeoverCases: changeoverCases.length,
      distinctTasks: distinct(cases, (row) => row.operationTaskId),
      distinctReservations: distinct(cases, (row) => row.reservationId),
      distinctCampaigns: distinct(cases, (row) => row.campaignId),
      distinctLocations: distinct(cases, (row) => row.locationId),
      byPriority: countBy(cases, (row) => row.priority),
      byReviewGroup: countBy(cases, (row) => row.reviewGroup),
      byClassification: countBy(cases, (row) => row.proposedClassification),
      byAnomaly: countMany(cases.flatMap((row) => row.anomalyCodes))
    },
    filteredCaseCount: filtered.length,
    cases: page,
    pagination: {
      limit: input.limit,
      returned: page.length,
      previousCursor: offset > 0 ? encodeCursor(Math.max(0, offset - input.limit)) : null,
      nextCursor: offset + page.length < filtered.length ? encodeCursor(offset + page.length) : null
    },
    assignmentCompleteness: assignmentSlices(input.tasks, taskCases, input.snapshotDate),
    mediaMatrix: mediaMatrix(input.locations),
    ambiguityClusters: ambiguityClusters(cases.filter((row) => row.reviewGroup === "HUMAN_REVIEW")),
    remediationBatches: remediationBatches(cases),
    cutoverOptions: cutoverOptions(),
    eligibilityPolicy: {
      status: "PROPOSED_NOT_ACTIVE",
      proposedFunction: "isOperationalMetricsEligibleTask",
      rules: [
        "Taskul are legătură validă cu o rezervare BOOKED și o campanie relevantă.",
        "Obligația este activă, viitoare sau recentă în fereastra aprobată.",
        "Tipul operațional și mediul pot fi determinate fără presupuneri.",
        "Datele taskului și ale obligației sunt coerente.",
        "Taskurile legacy/stale rămân accesibile, dar sunt excluse din KPI-urile curente."
      ],
      consumersNotYetMigrated: [
        "Executive Overview",
        "Executive Alerts",
        "Operations Monitoring",
        "Company Pulse",
        "Employee Attention Radar"
      ]
    },
    forwardWorkflow: [
      "Obligația BOOKED este identificată.",
      "Mediul și tipul operațional sunt determinate canonic.",
      "Taskul este creat o singură dată prin dedupeKey.",
      "Taskul este legat de campanie, rezervare și locație.",
      "Taskul poate intra într-o coadă nealocată, fără assignment artificial.",
      "SCHEDULED sau IN_PROGRESS necesită responsabil ori echipă.",
      "DONE necesită dovadă, iar excepția este motivată și autorizată; D-CEO nu poate acorda excepția.",
      "Neutralizarea sau changeover-ul este planificat.",
      "Fiecare schimbare păstrează actor, motiv și before/after."
    ],
    rootCause: rootCause(input.tasks)
  };
}

export function mediaClassificationForLocationType(value?: string | null): OperationCutoverMediaClassification {
  const source = normalize(value);
  if (!source) return "UNKNOWN";
  const digital = /(digital|led|ecran|screen|lcd|display|dooh)/i.test(source);
  const physical = /(autocolant|sticker|vinyl|colant|mesh|panou|billboard|backlit|unipol|citylight|totem|st[aâ]lp|prisma|trivision|blockout|pasarela|pasaj|pod|bridge)/i.test(source);
  if (digital && physical) return "MIXED";
  if (digital) return "DIGITAL";
  if (physical) return "STATIC";
  return "UNKNOWN";
}

export function defaultOperationCutoverFilters(): OperationCutoverReviewFilters {
  return {
    priority: "ALL",
    status: "",
    medium: "ALL",
    campaign: "",
    location: "",
    periodFrom: "",
    periodTo: "",
    anomalyCode: "",
    reviewGroup: "ALL",
    confidence: "ALL"
  };
}

function taskReviewCase(input: {
  task: ReviewTask;
  reservationById: Map<string, ReviewReservation>;
  campaignById: Map<string, ReviewCampaign>;
  locationById: Map<string, ReviewLocation>;
  findings: OperationTaskReconciliationFinding[];
  bookedCandidates: ReviewReservation[];
  snapshotDate: string;
}): OperationCutoverCase {
  const { task } = input;
  const reservation = task.reservationId ? input.reservationById.get(task.reservationId) : null;
  const campaignId = task.campaignId || reservation?.campaignId || null;
  const campaign = campaignId ? input.campaignById.get(campaignId) : null;
  const locationId = task.locationId || reservation?.locationId || null;
  const location = locationId ? input.locationById.get(locationId) : null;
  const anomalyCodes = unique([
    ...input.findings.map((row) => row.reasonCode),
    ...taskDateAnomalyCodes(task, reservation)
  ]);
  const linkedToBooked = reservation?.status === "BOOKED";
  const safeCandidate = !linkedToBooked ? uniqueBookedCandidate(task, input.bookedCandidates) : null;
  if (safeCandidate) anomalyCodes.push("SAFE_BOOKED_LINK_CANDIDATE");
  const priority = !linkedToBooked && !safeCandidate
    ? "HISTORICAL_LEGACY"
    : priorityForDates(
        input.snapshotDate,
        campaign?.startDate || safeCandidate?.periodStart || reservation?.periodStart,
        campaign?.endDate || safeCandidate?.periodEnd || reservation?.periodEnd,
        task
      );
  if (task.status === "DONE" && anomalyCodes.includes("DONE_PROOF_MISSING") &&
      priority === "HISTORICAL_LEGACY") {
    anomalyCodes.push("HISTORICAL_PROOF_UNAVAILABLE");
  }
  const medium = mediaClassificationForLocationType(location?.type);
  const proposed = taskClassification({ task, linkedToBooked, safeCandidate, anomalyCodes, priority, medium });
  const reviewGroup = reviewGroupForTask(linkedToBooked, safeCandidate, proposed);
  const eligibility = proposedMetricsEligibility({ task, linkedToBooked, priority, medium, anomalyCodes });
  const entity = input.findings[0]?.entityCode || "UNKNOWN";
  const caseId = stableCaseId("EXISTING_TASK", task.id);

  return {
    stableCaseId: caseId,
    caseType: "EXISTING_TASK",
    priority,
    reviewGroup,
    companyEntity: entity,
    companyEntityLabel: input.findings[0]?.entityLabel || entityLabel(entity),
    campaignId,
    campaignName: campaign?.campaignName || reservation?.campaignName || null,
    client: campaign?.client?.companyName || reservation?.clientCompany || reservation?.clientName || null,
    locationId,
    locationCode: location?.code || null,
    reservationId: reservation?.id || task.reservationId,
    relatedReservationId: safeCandidate?.id || null,
    operationTaskId: task.id,
    campaignStart: isoDate(campaign?.startDate || reservation?.periodStart),
    campaignEnd: isoDate(campaign?.endDate || reservation?.periodEnd),
    taskType: task.kind,
    taskStatus: task.status,
    scheduledFor: task.scheduledFor?.toISOString() || null,
    completedAt: task.completedAt?.toISOString() || null,
    assignedToUserId: task.assignedToUserId,
    assignedToLabel: task.assignedToUserId ? task.assignedToUserId : "Nealocat",
    mediaClassification: medium,
    anomalyCodes: unique(anomalyCodes.length ? anomalyCodes : ["NO_RECONCILIATION_ANOMALY"]),
    proposedClassification: proposed,
    proposedAction: proposedAction(proposed),
    confidence: confidenceForTask(linkedToBooked, safeCandidate, anomalyCodes),
    dataQualityState: dataQuality(confidenceForTask(linkedToBooked, safeCandidate, anomalyCodes)),
    evidence: [
      { label: "Task", value: task.id },
      { label: "Sursă", value: task.source },
      { label: "BOOKED legat", value: linkedToBooked ? "Da" : "Nu" },
      ...(safeCandidate ? [{ label: "Candidat BOOKED unic", value: safeCandidate.id }] : []),
      ...input.findings.slice(0, 4).flatMap((row) => row.evidence.slice(0, 2))
    ],
    risk: riskForCase(priority, proposed),
    humanDecision: "",
    reviewerNotes: "",
    deepLink: `/admin/operational?taskId=${encodeURIComponent(task.id)}`,
    dataCompleteness: completeness([
      task.reservationId,
      campaignId,
      locationId,
      task.scheduledFor,
      task.kind,
      task.status
    ]),
    proposedMetricsEligibility: eligibility
  };
}

function missingTaskReviewCase(
  finding: OperationTaskReconciliationFinding,
  reservationById: Map<string, ReviewReservation>,
  campaignById: Map<string, ReviewCampaign>,
  locationById: Map<string, ReviewLocation>,
  snapshotDate: string
): OperationCutoverCase {
  const reservation = finding.reservationId ? reservationById.get(finding.reservationId) : null;
  const campaign = finding.campaignId ? campaignById.get(finding.campaignId) : reservation?.campaignId ? campaignById.get(reservation.campaignId) : null;
  const location = finding.locationId ? locationById.get(finding.locationId) : reservation ? locationById.get(reservation.locationId) : null;
  const priority = priorityForDates(snapshotDate, campaign?.startDate || reservation?.periodStart, campaign?.endDate || reservation?.periodEnd);
  const taskType = finding.category === "NEUTRALIZATION_MISSING" ? "NEUTRALIZATION" : "DECORATION";
  const proposedDate = taskType === "NEUTRALIZATION"
    ? reservation?.neutralizationDate || reservation?.periodEnd
    : reservation?.installationDate || reservation?.periodStart;
  const caseId = stableCaseId("MISSING_TASK", `${finding.reservationId || "NONE"}:${taskType}`);
  return {
    stableCaseId: caseId,
    caseType: "MISSING_TASK",
    priority,
    reviewGroup: "DETERMINISTIC",
    companyEntity: finding.entityCode,
    companyEntityLabel: finding.entityLabel,
    campaignId: campaign?.id || finding.campaignId,
    campaignName: campaign?.campaignName || reservation?.campaignName || null,
    client: campaign?.client?.companyName || reservation?.clientCompany || reservation?.clientName || null,
    locationId: location?.id || finding.locationId,
    locationCode: location?.code || null,
    reservationId: reservation?.id || finding.reservationId,
    relatedReservationId: null,
    operationTaskId: null,
    campaignStart: isoDate(campaign?.startDate || reservation?.periodStart),
    campaignEnd: isoDate(campaign?.endDate || reservation?.periodEnd),
    taskType,
    taskStatus: "MISSING",
    scheduledFor: proposedDate?.toISOString() || null,
    completedAt: null,
    assignedToUserId: null,
    assignedToLabel: "Nealocat",
    mediaClassification: mediaClassificationForLocationType(location?.type),
    anomalyCodes: [finding.reasonCode],
    proposedClassification: "CREATE_MISSING_TASK",
    proposedAction: "Creare viitoare în lot controlat, fără assignment implicit și numai după validarea cazurilor curente.",
    confidence: finding.confidence,
    dataQualityState: finding.dataQualityState,
    evidence: [
      ...finding.evidence,
      { label: "Dată propusă", value: proposedDate ? bucharestBusinessDateKey(proposedDate) : "Necunoscută" },
      { label: "Assignment", value: "Nealocat; nu se ghicește responsabilul" }
    ],
    risk: riskForCase(priority, "CREATE_MISSING_TASK"),
    humanDecision: "",
    reviewerNotes: "",
    deepLink: finding.deepLink,
    dataCompleteness: completeness([reservation?.id, campaign?.id, location?.id, proposedDate, taskType]),
    proposedMetricsEligibility: {
      eligible: false,
      reasonCodes: ["TASK_NOT_CREATED", "CUTOVER_NOT_APPROVED"],
      policyStatus: "PROPOSED_NOT_ACTIVE"
    }
  };
}

function changeoverReviewCase(
  finding: OperationTaskReconciliationFinding,
  reservationById: Map<string, ReviewReservation>,
  campaignById: Map<string, ReviewCampaign>,
  locationById: Map<string, ReviewLocation>,
  snapshotDate: string
): OperationCutoverCase {
  const current = finding.reservationId ? reservationById.get(finding.reservationId) : null;
  const nextId = finding.evidence.find((row) => row.label.includes("următor"))?.value || null;
  const next = nextId ? reservationById.get(nextId) : null;
  const campaign = current?.campaignId ? campaignById.get(current.campaignId) : null;
  const location = current ? locationById.get(current.locationId) : null;
  const priority = priorityForDates(snapshotDate, campaign?.startDate || current?.periodStart, next?.periodStart || campaign?.endDate || current?.periodEnd);
  return {
    stableCaseId: stableCaseId("POSSIBLE_CHANGEOVER", `${current?.id || finding.id}:${next?.id || "NONE"}`),
    caseType: "POSSIBLE_CHANGEOVER",
    priority,
    reviewGroup: "HUMAN_REVIEW",
    companyEntity: finding.entityCode,
    companyEntityLabel: finding.entityLabel,
    campaignId: campaign?.id || finding.campaignId,
    campaignName: campaign?.campaignName || current?.campaignName || null,
    client: campaign?.client?.companyName || current?.clientCompany || current?.clientName || null,
    locationId: location?.id || finding.locationId,
    locationCode: location?.code || null,
    reservationId: current?.id || finding.reservationId,
    relatedReservationId: next?.id || nextId,
    operationTaskId: null,
    campaignStart: isoDate(campaign?.startDate || current?.periodStart),
    campaignEnd: isoDate(next?.periodStart || campaign?.endDate || current?.periodEnd),
    taskType: "CHANGEOVER_PROPOSAL",
    taskStatus: "REVIEW_REQUIRED",
    scheduledFor: next?.periodStart?.toISOString() || finding.scheduledFor,
    completedAt: null,
    assignedToUserId: null,
    assignedToLabel: "Nealocat",
    mediaClassification: mediaClassificationForLocationType(location?.type),
    anomalyCodes: [finding.reasonCode, "CHANGEOVER_REQUIRES_BOTH_OBLIGATION_LINKS", "NEW_CREATIVE_PROOF_REQUIRED"],
    proposedClassification: "HUMAN_LINK_REQUIRED",
    proposedAction: "Validează că schimbarea materialului este necesară și leagă viitorul changeover de ambele obligații.",
    confidence: finding.confidence,
    dataQualityState: finding.dataQualityState,
    evidence: finding.evidence,
    risk: "O asociere greșită poate ascunde o neutralizare obligatorie sau poate dubla munca de teren.",
    humanDecision: "",
    reviewerNotes: "",
    deepLink: finding.deepLink,
    dataCompleteness: completeness([current?.id, next?.id, location?.id, current?.periodEnd, next?.periodStart]),
    proposedMetricsEligibility: {
      eligible: false,
      reasonCodes: ["CHANGEOVER_NOT_CONFIRMED", "CUTOVER_NOT_APPROVED"],
      policyStatus: "PROPOSED_NOT_ACTIVE"
    }
  };
}

function taskClassification(input: {
  task: ReviewTask;
  linkedToBooked: boolean;
  safeCandidate: ReviewReservation | null;
  anomalyCodes: string[];
  priority: OperationCutoverPriority;
  medium: OperationCutoverMediaClassification;
}): OperationCutoverProposedClassification {
  if (input.anomalyCodes.includes("DUPLICATE_OPERATION_SIGNATURE")) return "POSSIBLE_DUPLICATE";
  if (input.linkedToBooked) {
    if (input.medium === "DIGITAL" || input.medium === "MIXED" || input.medium === "UNKNOWN") return "DATA_INSUFFICIENT";
    if (input.anomalyCodes.includes("HISTORICAL_PROOF_UNAVAILABLE")) return "HISTORICAL_PROOF_UNAVAILABLE";
    return "HUMAN_LINK_REQUIRED";
  }
  if (input.safeCandidate) return "LINK_SAFE";
  if (input.priority === "HISTORICAL_LEGACY") return "KEEP_AS_LEGACY";
  return "EXCLUDE_FROM_CURRENT_METRICS";
}

function reviewGroupForTask(
  linkedToBooked: boolean,
  _safeCandidate: ReviewReservation | null,
  proposed: OperationCutoverProposedClassification
): OperationCutoverReviewGroup {
  if (linkedToBooked || proposed === "POSSIBLE_DUPLICATE" || proposed === "DATA_INSUFFICIENT") return "HUMAN_REVIEW";
  return "LEGACY_EXCLUDED";
}

function proposedMetricsEligibility(input: {
  task: ReviewTask;
  linkedToBooked: boolean;
  priority: OperationCutoverPriority;
  medium: OperationCutoverMediaClassification;
  anomalyCodes: string[];
}) {
  const reasons: string[] = [];
  if (!input.linkedToBooked) reasons.push("VALID_BOOKED_LINK_MISSING");
  if (input.priority === "HISTORICAL_LEGACY") reasons.push("OUTSIDE_CURRENT_RELEVANCE_WINDOW");
  if (input.medium !== "STATIC") reasons.push("OPERATION_KIND_NOT_CANONICAL");
  if (input.task.source === "LEGACY_PRODUCTION_NOTES") reasons.push("LEGACY_SOURCE");
  if (input.anomalyCodes.some((code) => impossibleDateCodes.has(code))) reasons.push("DATE_INCONSISTENT");
  if (["ARCHIVED", "CANCELLED"].includes(input.task.status)) reasons.push("TERMINAL_WITHOUT_DELIVERY");
  return {
    eligible: reasons.length === 0,
    reasonCodes: reasons.length ? reasons : ["ELIGIBLE_BY_PROPOSED_POLICY"],
    policyStatus: "PROPOSED_NOT_ACTIVE" as const
  };
}

const impossibleDateCodes = new Set([
  "SCHEDULED_FOR_MISSING",
  "COMPLETED_BEFORE_CREATED",
  "COMPLETED_BEFORE_SCHEDULED",
  "DONE_WITHOUT_COMPLETED_AT",
  "NON_DONE_WITH_COMPLETED_AT",
  "DECORATION_AFTER_BOOKED_END",
  "NEUTRALIZATION_BEFORE_BOOKED_START",
  "TASK_CREATED_BEFORE_BOOKED",
  "TASK_CREATED_AFTER_BOOKED_END",
  "RESERVATION_INTERVAL_REVERSED",
  "TASK_DATE_INCONSISTENT"
]);

function taskDateAnomalyCodes(task: ReviewTask, reservation?: ReviewReservation | null) {
  const codes: string[] = [];
  if (!task.scheduledFor) codes.push("SCHEDULED_FOR_MISSING");
  if (task.completedAt && task.completedAt < task.createdAt) codes.push("COMPLETED_BEFORE_CREATED");
  if (task.completedAt && task.scheduledFor && task.completedAt < task.scheduledFor) codes.push("COMPLETED_BEFORE_SCHEDULED");
  if (task.status === "DONE" && !task.completedAt) codes.push("DONE_WITHOUT_COMPLETED_AT");
  if (task.status !== "DONE" && task.completedAt) codes.push("NON_DONE_WITH_COMPLETED_AT");
  if (!reservation) return codes;
  if (reservation.periodStart > reservation.periodEnd) codes.push("RESERVATION_INTERVAL_REVERSED");
  if (reservation.bookedAt && task.createdAt < reservation.bookedAt) codes.push("TASK_CREATED_BEFORE_BOOKED");
  if (task.createdAt > reservation.periodEnd) codes.push("TASK_CREATED_AFTER_BOOKED_END");
  if (task.kind === "DECORATION" && task.scheduledFor && task.scheduledFor > reservation.periodEnd) {
    codes.push("DECORATION_AFTER_BOOKED_END");
  }
  if (task.kind === "NEUTRALIZATION" && task.scheduledFor && task.scheduledFor < reservation.periodStart) {
    codes.push("NEUTRALIZATION_BEFORE_BOOKED_START");
  }
  return unique(codes);
}

function priorityForDates(
  snapshot: string,
  start?: Date | null,
  end?: Date | null,
  task?: ReviewTask
): OperationCutoverPriority {
  const startKey = start ? bucharestBusinessDateKey(start) : null;
  const endKey = end ? bucharestBusinessDateKey(end) : null;
  const scheduledKey = task?.scheduledFor ? bucharestBusinessDateKey(task.scheduledFor) : null;
  const completedKey = task?.completedAt ? bucharestBusinessDateKey(task.completedAt) : null;
  const plus30 = addDateKeyDays(snapshot, 30);
  const minus30 = addDateKeyDays(snapshot, -30);
  const minus90 = addDateKeyDays(snapshot, -90);

  if ((startKey && endKey && startKey <= snapshot && endKey >= snapshot) ||
      (startKey && startKey > snapshot && startKey <= plus30) ||
      (scheduledKey && !["DONE", "ARCHIVED", "CANCELLED"].includes(task?.status || "") && scheduledKey <= plus30 && scheduledKey >= minus30) ||
      (endKey && endKey < snapshot && endKey >= minus30 && task?.kind === "NEUTRALIZATION")) {
    return "CRITICAL_CURRENT";
  }
  if ((endKey && endKey >= minus90 && endKey < snapshot) ||
      (completedKey && completedKey >= minus90 && completedKey <= snapshot) ||
      (scheduledKey && scheduledKey >= minus90 && scheduledKey <= plus30)) {
    return "RECENT_RELEVANT";
  }
  return "HISTORICAL_LEGACY";
}

function assignmentSlices(tasks: ReviewTask[], taskCases: OperationCutoverCase[], snapshot: string): OperationCutoverAssignmentSlice[] {
  const byTaskId = new Map(taskCases.map((row) => [row.operationTaskId, row]));
  const active = tasks.filter((row) => ["NEW", "IN_PROGRESS"].includes(row.status));
  const eligible = active.filter((row) => byTaskId.get(row.id)?.proposedMetricsEligibility.eligible);
  const due7 = eligible.filter((row) => dueBy(row, snapshot, 7));
  const due30 = eligible.filter((row) => dueBy(row, snapshot, 30));
  return [
    assignmentSlice("ALL_ACTIVE", "Toate taskurile active, inclusiv istorice", active, null),
    assignmentSlice("CURRENT_FUTURE", "Taskuri eligibile curente și viitoare", eligible, 95),
    assignmentSlice("DUE_7_DAYS", "Scadente până în 7 zile", due7, 100),
    assignmentSlice("DUE_30_DAYS", "Scadente până în 30 zile", due30, 95)
  ];
}

function assignmentSlice(
  id: OperationCutoverAssignmentSlice["id"],
  label: string,
  tasks: ReviewTask[],
  target: number | null
): OperationCutoverAssignmentSlice {
  const assigned = tasks.filter((row) => row.assignedToUserId).length;
  return {
    id,
    label,
    total: tasks.length,
    assigned,
    unassigned: tasks.length - assigned,
    completeness: tasks.length ? Math.round((assigned / tasks.length) * 100) : 100,
    target,
    policyStatus: "PROPOSED_NOT_ACTIVE"
  };
}

function dueBy(task: ReviewTask, snapshot: string, days: number) {
  if (!task.scheduledFor) return false;
  const key = bucharestBusinessDateKey(task.scheduledFor);
  return key <= addDateKeyDays(snapshot, days);
}

function mediaMatrix(locations: ReviewLocation[]): OperationCutoverMediaMatrixRow[] {
  const groups = groupBy(locations, (row) => String(row.type || "(tip necompletat)").trim());
  return [...groups.entries()].map(([type, rows]) => {
    const classification = mediaClassificationForLocationType(type === "(tip necompletat)" ? null : type);
    return {
      locationType: type,
      exampleCodes: rows.slice(0, 3).map((row) => row.code),
      locationCount: rows.length,
      classification,
      startOperation: classification === "STATIC" ? "DECORATION" : classification === "DIGITAL" ? "DATA_INSUFFICIENT: publish/content activation lipsește din enum" : "Validare umană",
      endOperation: classification === "STATIC" ? "NEUTRALIZATION sau changeover confirmat" : classification === "DIGITAL" ? "DATA_INSUFFICIENT: remove/deactivation lipsește din enum" : "Validare umană",
      existingTaskTypes: classification === "STATIC" ? ["DECORATION", "NEUTRALIZATION", "REDECORATION", "MAINTENANCE"] : [],
      confidence: classification === "STATIC" || classification === "DIGITAL" ? 100 : classification === "MIXED" ? 70 : 30,
      missingData: classification === "DIGITAL"
        ? ["Enumuri canonice pentru publish/content activation și remove/deactivation"]
        : classification === "MIXED"
          ? ["Regulă per față/unitate vândută"]
          : classification === "UNKNOWN"
            ? ["Tip media canonic"]
            : []
    };
  }).sort((left, right) => left.locationType.localeCompare(right.locationType, "ro"));
}

function ambiguityClusters(cases: OperationCutoverCase[]): OperationCutoverAmbiguityCluster[] {
  const groups = groupBy(cases, ambiguityClusterKey);
  return [...groups.entries()].map(([id, rows]) => {
    const definition = ambiguityClusterDefinition(id);
    return {
      id,
      label: definition.label,
      caseCount: rows.length,
      unresolvedRule: definition.unresolvedRule,
      missingFields: definition.missingFields,
      recommendation: definition.recommendation,
      risk: definition.risk,
      exampleCaseIds: rows.slice(0, 3).map((row) => row.stableCaseId),
      businessDecisionRequired: definition.businessDecisionRequired
    };
  }).sort((left, right) => right.caseCount - left.caseCount || left.id.localeCompare(right.id));
}

function ambiguityClusterKey(row: OperationCutoverCase) {
  if (row.caseType === "POSSIBLE_CHANGEOVER") return "CHANGEOVER_CONFIRMATION";
  if (row.proposedClassification === "LINK_SAFE") return "SAFE_LINK_REQUIRES_APPROVAL";
  if (row.proposedClassification === "POSSIBLE_DUPLICATE") return "POSSIBLE_DUPLICATE";
  if (row.anomalyCodes.includes("ACTIVE_TASK_ASSIGNEE_MISSING")) return "ASSIGNMENT_OWNER_MISSING";
  if (row.anomalyCodes.some((code) => impossibleDateCodes.has(code))) return "DATE_OR_STATUS_INCONSISTENT";
  if (row.anomalyCodes.some((code) => code.includes("PROOF"))) return "PROOF_LINK_UNCERTAIN";
  if (row.mediaClassification !== "STATIC") return "MEDIA_KIND_NOT_CANONICAL";
  return "CURRENT_TASK_REVIEW";
}

function ambiguityClusterDefinition(id: string) {
  const definitions: Record<string, Omit<OperationCutoverAmbiguityCluster, "id" | "caseCount" | "exampleCaseIds">> = {
    CHANGEOVER_CONFIRMATION: {
      label: "Changeover consecutiv",
      unresolvedRule: "Nu se poate confirma automat că noul material înlocuiește neutralizarea separată.",
      missingFields: ["confirmare schimbare creativ", "legături către ambele obligații"],
      recommendation: "Confirmare umană și dovadă pentru materialul nou.",
      risk: "Neutralizare omisă sau task dublat.",
      businessDecisionRequired: "Aprobă changeover-ul pentru fiecare pereche."
    },
    SAFE_LINK_REQUIRES_APPROVAL: {
      label: "Legătură deterministă găsită",
      unresolvedRule: "Legătura tehnică este unică, dar schimbarea datelor nu este aprobată.",
      missingFields: ["aprobare reviewer"],
      recommendation: "Revizuiește evidence și aprobă un viitor lot LINK_SAFE.",
      risk: "Legarea taskului la obligația greșită.",
      businessDecisionRequired: "Aprobă regula de legare exactă."
    },
    POSSIBLE_DUPLICATE: {
      label: "Posibile duplicate",
      unresolvedRule: "Două taskuri pot reprezenta aceeași operațiune.",
      missingFields: ["task canonic"],
      recommendation: "Comparare manuală; nu se șterge nimic.",
      risk: "Pierdere de istoric sau dublarea execuției.",
      businessDecisionRequired: "Selectează taskul canonic."
    },
    ASSIGNMENT_OWNER_MISSING: {
      label: "Task curent nealocat",
      unresolvedRule: "Responsabilul nu poate fi dedus din Sales/COO.",
      missingFields: ["responsabil operațional sau echipă"],
      recommendation: "Managerul operațional atribuie explicit.",
      risk: "Taskul nu este văzut de echipa de teren.",
      businessDecisionRequired: "Alege responsabilul fără fallback artificial."
    },
    DATE_OR_STATUS_INCONSISTENT: {
      label: "Date sau status inconsistente",
      unresolvedRule: "Timestampul corect nu poate fi derivat fără ambiguitate.",
      missingFields: ["confirmare dată reală"],
      recommendation: "Păstrează valoarea și cere confirmare.",
      risk: "Istoric cosmetizat sau SLA incorect.",
      businessDecisionRequired: "Confirmă dacă rămâne excepție istorică."
    },
    PROOF_LINK_UNCERTAIN: {
      label: "Dovadă lipsă sau nelegată",
      unresolvedRule: "Nu există o potrivire sigură task-locație-campanie-perioadă-tip.",
      missingFields: ["proof canonic legat"],
      recommendation: "Nu fabrica dovadă; marchează istoric indisponibil când este cazul.",
      risk: "Dovadă atribuită greșit.",
      businessDecisionRequired: "Confirmă tratamentul istoric."
    },
    MEDIA_KIND_NOT_CANONICAL: {
      label: "Mediu fără tip operațional canonic",
      unresolvedRule: "Enumul curent nu poate reprezenta operațiunea digitală sau mixtă.",
      missingFields: ["tip operațional aprobat"],
      recommendation: "Păstrează DATA_INSUFFICIENT până la extensia modelului.",
      risk: "Decorare fizică inventată pentru DOOH.",
      businessDecisionRequired: "Aprobă viitorul model digital."
    },
    CURRENT_TASK_REVIEW: {
      label: "Task curent pentru validare",
      unresolvedRule: "Taskul este relevant, dar cutover-ul nu este încă aprobat.",
      missingFields: ["aprobare cutover"],
      recommendation: "Verifică legătura, assignmentul și dovada.",
      risk: "Task omis sau dublat la cutover.",
      businessDecisionRequired: "Aprobă includerea în sursa operațională curentă."
    }
  };
  return definitions[id] || definitions.CURRENT_TASK_REVIEW;
}

function remediationBatches(cases: OperationCutoverCase[]): OperationCutoverRemediationBatch[] {
  const definitions: Array<Omit<OperationCutoverRemediationBatch, "caseCount" | "findingCount"> & { matches: (row: OperationCutoverCase) => boolean }> = [
    batchDefinition("A", "Cazuri active și viitoare sigure", (row) => row.reviewGroup === "DETERMINISTIC" && row.priority === "CRITICAL_CURRENT", "Creare task lipsă după aprobare", "Recheck BOOKED, mediu static, dedupeKey și dată", "Task dublat dacă sursa se schimbă", "Ștergere compensatorie numai pentru taskurile create de batch, pe batch id", "Crește numitorul eligibil; assignment rămâne necompletat până la atribuire", "Crește confidence după assignment", "Reduce BOOKED_WITHOUT_OPERATION_TASK"),
    batchDefinition("B", "Legături sigure task-obligație", (row) => row.proposedClassification === "LINK_SAFE", "Actualizare legături canonice", "Candidat unic pe campanie, locație, perioadă și tip", "Legătură falsă", "Restaurare before snapshot", "Poate introduce taskuri în cohorta eligibilă", "Crește confidence numai după validare", "Reduce ORPHAN_OPERATION_TASK"),
    batchDefinition("C", "Neutralizări și changeover-uri curente", (row) => row.priority === "CRITICAL_CURRENT" && (row.taskType.includes("NEUTRALIZATION") || row.caseType === "POSSIBLE_CHANGEOVER"), "Creare/legare neutralizare ori changeover", "Ambele obligații, fereastră ≤24h, mediu static și dovadă nouă", "Neutralizare ascunsă incorect", "Restaurare legături și taskuri create", "Crește acoperirea curentă", "Crește confidence Operations", "Reduce neutralizări lipsă"),
    batchDefinition("D", "Cazuri cu validare umană", (row) => row.reviewGroup === "HUMAN_REVIEW", "Aplicare numai după decizie explicită", "Decizie și note reviewer obligatorii", "Decizie greșită la scară", "Compensating action per case", "Depinde de assignment", "Nu se estimează până la decizie", "Depinde de clasă"),
    batchDefinition("E", "Legacy și excludere KPI", (row) => row.reviewGroup === "LEGACY_EXCLUDED", "Nicio mutație; viitor predicat logic de eligibilitate", "Dovadă că nu există impact curent/viitor", "Excluderea unui caz încă relevant", "Eliminarea predicatului de cutover", "Elimină istoricul din numitorul curent", "Crește confidence fără a cosmetiza scorul", "Reduce noise Data Quality"),
    batchDefinition("F", "Dovezi istorice indisponibile", (row) => row.anomalyCodes.includes("HISTORICAL_PROOF_UNAVAILABLE"), "Clasificare istorică, fără fabricare proof", "Task încheiat înainte de cutover și fără asociere sigură", "Ascunderea unei lipse recente", "Restaurare clasificare", "Fără efect asupra assignmentului", "Nu afectează SLA post-cutover", "Reduce noise retrospectiv"),
    batchDefinition("G", "Date imposibile", (row) => row.anomalyCodes.some((code) => impossibleDateCodes.has(code)), "Corecție numai cu sursă canonică sau păstrare excepție", "Before/after, evidence și confirmare", "Rescrierea istoriei", "Restaurare timestamp/status anterior", "Poate schimba eligibilitatea", "Nu crește confidence fără evidence", "Clarifică alertele de date")
  ];
  return definitions.map(({ matches, ...definition }) => {
    const selected = cases.filter(matches);
    return {
      ...definition,
      caseCount: selected.length,
      findingCount: selected.reduce((sum, row) => sum + row.anomalyCodes.length, 0)
    };
  });
}

function batchDefinition(
  id: OperationCutoverRemediationBatch["id"],
  label: string,
  matches: (row: OperationCutoverCase) => boolean,
  futureMutation: string,
  validation: string,
  risk: string,
  rollback: string,
  expectedAssignmentEffect: string,
  expectedPulseEffect: string,
  expectedAlertsEffect: string
) {
  return {
    id,
    label,
    matches,
    criteria: label,
    futureMutation,
    validation,
    risk,
    rollback,
    expectedAssignmentEffect,
    expectedPulseEffect,
    expectedAlertsEffect,
    executionApproved: false as const
  };
}

function cutoverOptions(): OperationCutoverReview["cutoverOptions"] {
  return [
    {
      id: "DEPLOY_DATE",
      label: "Data deploy-ului",
      advantages: ["Regulă simplă și exactă."],
      risks: ["Campaniile active pot intra în noul sistem înainte de validarea cazurilor critice."],
      recommended: false,
      activationApproved: false
    },
    {
      id: "MONTH_START",
      label: "Începutul unei luni",
      advantages: ["Raportare și SLA mai ușor de explicat."],
      risks: ["Poate amâna protecția campaniilor care încep înainte de data aleasă."],
      recommended: false,
      activationApproved: false
    },
    {
      id: "AFTER_CRITICAL_REVIEW",
      label: "După reconcilierea cazurilor critice",
      advantages: ["Protejează campaniile active și viitoare fără rescrierea întregului istoric."],
      risks: ["Necesită semn-off uman și o fereastră de lansare controlată."],
      recommended: true,
      activationApproved: false
    }
  ];
}

function rootCause(tasks: ReviewTask[]): OperationCutoverReview["rootCause"] {
  const bySource = countBy(tasks, (row) => row.source);
  const withoutCreator = tasks.filter((row) => !row.createdByUserId).length;
  return {
    summary: "Taskurile au fost materializate din rezervări și metadata legacy fără o politică de assignment implicită.",
    evidence: [
      `Surse taskuri: ${Object.entries(bySource).map(([key, value]) => `${key}=${value}`).join(", ")}.`,
      `${withoutCreator} taskuri nu au creator explicit.`,
      "deriveBaseTasksFromReservation nu deduce responsabilul.",
      "operationTaskCreateRows păstrează assignedToUserId null când draftul nu are assignment.",
      "Assignmentul este o operațiune managerială separată; nu există fallback către COO sau Sales."
    ],
    assignmentIsNotAutoInferred: true
  };
}

function uniqueBookedCandidate(task: ReviewTask, candidates: ReviewReservation[]) {
  const matches = candidates.filter((reservation) => {
    const expected = task.kind === "NEUTRALIZATION"
      ? reservation.neutralizationDate || reservation.periodEnd
      : reservation.installationDate || reservation.periodStart;
    return task.scheduledFor && bucharestBusinessDateKey(task.scheduledFor) === bucharestBusinessDateKey(expected);
  });
  return matches.length === 1 ? matches[0] : null;
}

function filterReviewCases(cases: OperationCutoverCase[], filters: OperationCutoverReviewFilters) {
  const campaign = normalize(filters.campaign);
  const location = normalize(filters.location);
  return cases.filter((row) =>
    (filters.priority === "ALL" || row.priority === filters.priority) &&
    (!filters.status || row.taskStatus === filters.status) &&
    (filters.medium === "ALL" || row.mediaClassification === filters.medium) &&
    (!campaign || normalize(`${row.campaignId || ""} ${row.campaignName || ""}`).includes(campaign)) &&
    (!location || normalize(`${row.locationId || ""} ${row.locationCode || ""}`).includes(location)) &&
    (!filters.periodFrom || (row.campaignEnd || row.scheduledFor || "") >= filters.periodFrom) &&
    (!filters.periodTo || (row.campaignStart || row.scheduledFor || "") <= filters.periodTo) &&
    (!filters.anomalyCode || row.anomalyCodes.includes(filters.anomalyCode)) &&
    (filters.reviewGroup === "ALL" || row.reviewGroup === filters.reviewGroup) &&
    (filters.confidence === "ALL" ||
      (filters.confidence === "HIGH" && row.confidence >= 80) ||
      (filters.confidence === "MEDIUM" && row.confidence >= 50 && row.confidence < 80) ||
      (filters.confidence === "LOW" && row.confidence < 50))
  );
}

function proposedAction(value: OperationCutoverProposedClassification) {
  const labels: Record<OperationCutoverProposedClassification, string> = {
    CREATE_MISSING_TASK: "Propune task lipsă după aprobarea lotului.",
    LINK_SAFE: "Propune legarea la candidatul BOOKED unic, după review.",
    HUMAN_LINK_REQUIRED: "Păstrează și solicită validare umană.",
    KEEP_AS_LEGACY: "Păstrează neschimbat pentru audit.",
    EXCLUDE_FROM_CURRENT_METRICS: "Propune excluderea logică din KPI-urile curente.",
    POSSIBLE_DUPLICATE: "Compară manual; nu șterge nimic.",
    HISTORICAL_PROOF_UNAVAILABLE: "Păstrează ca dovadă istorică indisponibilă.",
    DATA_INSUFFICIENT: "Completează modelul sau datele înainte de cutover."
  };
  return labels[value];
}

function riskForCase(priority: OperationCutoverPriority, proposed: OperationCutoverProposedClassification) {
  if (priority === "CRITICAL_CURRENT") return "Poate afecta o campanie activă, viitoare sau o operațiune scadentă.";
  if (proposed === "LINK_SAFE" || proposed === "HUMAN_LINK_REQUIRED") return "O asociere greșită poate altera istoricul operațional.";
  return "Risc redus curent; păstrarea auditului rămâne obligatorie.";
}

function confidenceForTask(linked: boolean, safeCandidate: ReviewReservation | null, anomalies: string[]) {
  if (linked) return anomalies.some((code) => code.includes("PROOF_LINK_DATA_INSUFFICIENT")) ? 70 : 95;
  if (safeCandidate) return 90;
  return 60;
}

function dataQuality(confidence: number) {
  return confidence >= 90 ? "HIGH" as const : confidence >= 70 ? "MEDIUM" as const : confidence >= 40 ? "LOW" as const : "DATA_INSUFFICIENT" as const;
}

function completeness(values: unknown[]) {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "").length;
  return Math.round((present / values.length) * 100);
}

function compareCases(left: OperationCutoverCase, right: OperationCutoverCase) {
  const priorityOrder: Record<OperationCutoverPriority, number> = {
    CRITICAL_CURRENT: 0,
    RECENT_RELEVANT: 1,
    HISTORICAL_LEGACY: 2
  };
  const reviewOrder: Record<OperationCutoverReviewGroup, number> = {
    DETERMINISTIC: 0,
    HUMAN_REVIEW: 1,
    LEGACY_EXCLUDED: 2
  };
  return priorityOrder[left.priority] - priorityOrder[right.priority] ||
    reviewOrder[left.reviewGroup] - reviewOrder[right.reviewGroup] ||
    left.stableCaseId.localeCompare(right.stableCaseId);
}

function stableCaseId(type: string, source: string) {
  return `opc_${createHash("sha256").update(`${OPERATION_TASK_CUTOVER_CONTRACT_VERSION}|${type}|${source}`).digest("hex").slice(0, 20)}`;
}

function entityLabel(value: string) {
  return value === "UNKNOWN" ? "Entitate necunoscută" : entityLabelForCode(value as "FOCUS_MEDIA" | "EXCELLENCE_MEDIA" | "FOCUS_BG");
}

function isoDate(value?: Date | null) {
  return value?.toISOString() || null;
}

function normalize(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ro-RO");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) || []), row]);
  return result;
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const result: Record<string, number> = {};
  for (const row of rows) result[key(row)] = (result[key(row)] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function countMany(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function distinct<T>(rows: T[], key: (row: T) => string | null) {
  return new Set(rows.map(key).filter(Boolean)).size;
}

function cursorOffset(cursor: string | null) {
  if (!cursor) return 0;
  try {
    const value = Buffer.from(cursor, "base64url").toString("utf8").match(/^offset:(\d+)$/)?.[1];
    return value ? Number(value) : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}
