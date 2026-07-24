import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import type { AuthSession } from "@/lib/auth";
import { companyCodeForEntity, normalizeCompanyEntity } from "@/lib/company-entities";
import { deriveCampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import {
  OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION,
  OPERATION_TASK_RECONCILIATION_DEFAULT_LIMIT,
  OPERATION_TASK_RECONCILIATION_REVALIDATE_SECONDS,
  type OperationTaskMedium,
  type OperationTaskReconciliationBatch,
  type OperationTaskReconciliationCategory,
  type OperationTaskReconciliationFilters,
  type OperationTaskReconciliationFinding,
  type OperationTaskReconciliationResponse
} from "@/lib/dashboard/executive/operation-task-reconciliation-contracts";
import {
  buildOperationTaskCutoverReview,
  defaultOperationCutoverFilters
} from "@/lib/dashboard/executive/operation-task-cutover-review";
import type {
  OperationCutoverMediaClassification,
  OperationCutoverPriority,
  OperationCutoverReview,
  OperationCutoverReviewGroup
} from "@/lib/dashboard/executive/operation-task-cutover-contracts";
import { operationalRequirementForBooked, proofContractForOperation } from "@/lib/dashboard/executive/operational-contract";
import { EXECUTIVE_ENTITIES, entityLabelForCode, executiveScopeForSession } from "@/lib/dashboard/executive/scope";
import { addDateKeyDays, bucharestBusinessDateKey } from "@/lib/dashboard/executive/time";
import { parseOperationalProofNotes } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { permissionsForRole } from "@/lib/rbac";

const ACTIVE_TASK_STATUSES = new Set(["NEW", "IN_PROGRESS"]);
const TASK_TERMINAL_WITHOUT_DELIVERY = new Set(["ARCHIVED", "CANCELLED"]);
const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE", "SCHEDULED"]);
const ALL_ENTITY_CODES = EXECUTIVE_ENTITIES.map((entity) => entity.code);

const categories = new Set<OperationTaskReconciliationCategory>([
  "BOOKED_WITHOUT_OPERATION_TASK",
  "NEUTRALIZATION_MISSING",
  "ORPHAN_OPERATION_TASK",
  "UNASSIGNED_ACTIVE_TASK",
  "DUPLICATE_TASK",
  "TERMINAL_TASK_FOR_ACTIVE_OBLIGATION",
  "COMPLETED_WITHOUT_PROOF",
  "IMPOSSIBLE_TASK_DATE",
  "LEGACY_OR_STALE_TASK",
  "ENDED_CAMPAIGN_TASK",
  "POSSIBLE_CHANGEOVER",
  "DATA_INSUFFICIENT"
]);
const batches = new Set<OperationTaskReconciliationBatch>([
  "SAFE_CASES",
  "NEEDS_HUMAN_CONFIRMATION",
  "DO_NOT_MIGRATE",
  "DUPLICATES",
  "DATA_INSUFFICIENT"
]);
const mediums = new Set<OperationCutoverMediaClassification>(["STATIC", "DIGITAL", "MIXED", "UNKNOWN"]);
const priorities = new Set<OperationCutoverPriority>(["CRITICAL_CURRENT", "RECENT_RELEVANT", "HISTORICAL_LEGACY"]);
const reviewGroups = new Set<OperationCutoverReviewGroup>(["DETERMINISTIC", "HUMAN_REVIEW", "LEGACY_EXCLUDED"]);

const reservationSelect = Prisma.validator<Prisma.ReservationSelect>()({
  id: true,
  status: true,
  clientId: true,
  clientName: true,
  clientCompany: true,
  campaignId: true,
  campaignName: true,
  locationId: true,
  contractCompany: true,
  periodStart: true,
  periodEnd: true,
  installationDate: true,
  neutralizationDate: true,
  bookedAt: true,
  productionNotes: true,
  createdAt: true,
  updatedAt: true
});
const operationTaskSelect = Prisma.validator<Prisma.OperationTaskSelect>()({
  id: true,
  reservationId: true,
  campaignId: true,
  locationId: true,
  kind: true,
  status: true,
  source: true,
  dedupeKey: true,
  legacyTaskId: true,
  scheduledFor: true,
  completedAt: true,
  assignedToUserId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true
});
const campaignSelect = Prisma.validator<Prisma.CampaignSelect>()({
  id: true,
  campaignName: true,
  status: true,
  companyEntity: true,
  startDate: true,
  endDate: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: {
      companyName: true
    }
  }
});
const locationSelect = Prisma.validator<Prisma.LocationSelect>()({
  id: true,
  code: true,
  type: true,
  lifecycleStatus: true
});
const proofSelect = Prisma.validator<Prisma.ClientDocumentSelect>()({
  id: true,
  reservationId: true,
  documentType: true,
  status: true,
  expiryDate: true,
  notes: true,
  uploadedAt: true
});

export type ReconciliationReservation = Prisma.ReservationGetPayload<{ select: typeof reservationSelect }>;
export type ReconciliationTask = Prisma.OperationTaskGetPayload<{ select: typeof operationTaskSelect }>;
export type ReconciliationCampaign = Prisma.CampaignGetPayload<{ select: typeof campaignSelect }>;
export type ReconciliationLocation = Prisma.LocationGetPayload<{ select: typeof locationSelect }>;
export type ReconciliationProof = Prisma.ClientDocumentGetPayload<{ select: typeof proofSelect }>;

export type OperationTaskReconciliationInput = {
  reservations: ReconciliationReservation[];
  tasks: ReconciliationTask[];
  campaigns: ReconciliationCampaign[];
  locations: ReconciliationLocation[];
  proofs: ReconciliationProof[];
  selectedEntityCodes: string[];
  snapshotDate: string;
  asOf?: Date;
};

type CacheContext = {
  contractVersion: typeof OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION;
  role: "SUPER_ADMIN" | "COO" | "D_CEO";
  permissionHash: string;
  authorizedEntityHash: string;
  selectedEntityHash: string;
  selectedEntityCodes: string[];
  snapshotDate: string;
  timezone: string;
  filters: OperationTaskReconciliationFilters;
};

const cachedReconciliation = unstable_cache(
  async (context: CacheContext) => queryOperationTaskReconciliation(context),
  ["operation-task-reconciliation-v1"],
  {
    revalidate: OPERATION_TASK_RECONCILIATION_REVALIDATE_SECONDS,
    tags: ["operation-task-proof", "reservation-hold-location", "campaign-document"]
  }
);

export async function getOperationTaskReconciliation(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {},
  now = new Date()
): Promise<OperationTaskReconciliationResponse> {
  const scope = executiveScopeForSession(session, input, now);
  const filters = reconciliationFilters(input);
  const context: CacheContext = {
    contractVersion: OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION,
    role: scope.role,
    permissionHash: stableHash([...permissionsForRole(scope.role)].sort()),
    authorizedEntityHash: stableHash([...scope.authorizedEntityCodes].sort()),
    selectedEntityHash: stableHash([...scope.selectedEntityCodes].sort()),
    selectedEntityCodes: scope.selectedEntityCodes,
    snapshotDate: scope.snapshotDate,
    timezone: scope.timeZone,
    filters
  };
  reconciliationCacheKey(context);
  const result = await cachedReconciliation(context);
  return { ...result, role: scope.role, scope, filters };
}

export async function getOperationTaskCutoverReviewForExport(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {},
  now = new Date()
): Promise<OperationCutoverReview> {
  const scope = executiveScopeForSession(session, input, now);
  const filters = reconciliationFilters(input);
  const context: CacheContext = {
    contractVersion: OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION,
    role: scope.role,
    permissionHash: stableHash([...permissionsForRole(scope.role)].sort()),
    authorizedEntityHash: stableHash([...scope.authorizedEntityCodes].sort()),
    selectedEntityHash: stableHash([...scope.selectedEntityCodes].sort()),
    selectedEntityCodes: scope.selectedEntityCodes,
    snapshotDate: scope.snapshotDate,
    timezone: scope.timeZone,
    filters: {
      ...filters,
      cursor: null,
      limit: 10_000
    }
  };
  const result = await queryOperationTaskReconciliation(context, now);
  return result.review;
}

export async function queryOperationTaskReconciliation(
  context: CacheContext,
  queryNow = new Date()
): Promise<Omit<OperationTaskReconciliationResponse, "role" | "scope" | "filters">> {
  const [reservations, tasks, campaigns, locations, proofs] = await Promise.all([
    prisma.reservation.findMany({ select: reservationSelect, orderBy: { id: "asc" } }),
    prisma.operationTask.findMany({ select: operationTaskSelect, orderBy: { id: "asc" } }),
    prisma.campaign.findMany({ select: campaignSelect, orderBy: { id: "asc" } }),
    prisma.location.findMany({ select: locationSelect, orderBy: { id: "asc" } }),
    prisma.clientDocument.findMany({
      where: { documentType: "operational_proof_photo", status: "active" },
      select: proofSelect,
      orderBy: { id: "asc" }
    })
  ]);
  return buildOperationTaskReconciliation({
    reservations,
    tasks,
    campaigns,
    locations,
    proofs,
    selectedEntityCodes: context.selectedEntityCodes,
    snapshotDate: context.snapshotDate,
    asOf: queryNow
  }, context.filters);
}

export async function auditOperationTaskReconciliation(input: {
  snapshotDate?: string;
  selectedEntityCodes?: string[];
  filters?: OperationTaskReconciliationFilters;
  now?: Date;
} = {}) {
  const snapshotDate = input.snapshotDate || bucharestBusinessDateKey(input.now || new Date());
  const selectedEntityCodes = input.selectedEntityCodes || [...ALL_ENTITY_CODES];
  return queryOperationTaskReconciliation({
    contractVersion: OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION,
    role: "COO",
    permissionHash: "read-only-cli-audit",
    authorizedEntityHash: stableHash(ALL_ENTITY_CODES),
    selectedEntityHash: stableHash(selectedEntityCodes),
    selectedEntityCodes,
    snapshotDate,
    timezone: "Europe/Bucharest",
    filters: input.filters || defaultFilters()
  }, input.now);
}

export function buildOperationTaskReconciliation(
  input: OperationTaskReconciliationInput,
  filters: OperationTaskReconciliationFilters = defaultFilters()
): Omit<OperationTaskReconciliationResponse, "role" | "scope" | "filters"> {
  const asOf = input.asOf || new Date();
  const campaignById = new Map(input.campaigns.map((campaign) => [campaign.id, campaign]));
  const locationById = new Map(input.locations.map((location) => [location.id, location]));
  const reservationById = new Map(input.reservations.map((reservation) => [reservation.id, reservation]));
  const proofsByReservation = groupBy(input.proofs.filter((proof) =>
    !proof.expiryDate || proof.expiryDate.getTime() >= asOf.getTime()
  ), (proof) => proof.reservationId || "UNLINKED");
  const allEntitiesSelected = ALL_ENTITY_CODES.every((code) => input.selectedEntityCodes.includes(code));
  const inScope = (code: string) => code === "UNKNOWN"
    ? allEntitiesSelected
    : input.selectedEntityCodes.includes(code);
  const reservations = input.reservations.filter((reservation) =>
    inScope(reservationEntityCode(reservation, campaignById))
  );
  const tasks = input.tasks.filter((task) =>
    inScope(taskEntityCode(task, reservationById, campaignById))
  );
  const booked = reservations.filter((reservation) => reservation.status === "BOOKED");
  const tasksByReservation = groupBy(tasks.filter((task) => task.reservationId), (task) => task.reservationId || "");
  const reservationsByCampaign = groupBy(booked.filter((reservation) => reservation.campaignId), (reservation) => reservation.campaignId || "");
  const findings: OperationTaskReconciliationFinding[] = [];
  const mediumByTaskId = new Map<string, OperationTaskMedium>();

  for (const task of tasks) {
    const reservation = task.reservationId ? reservationById.get(task.reservationId) : null;
    const location = locationById.get(task.locationId || reservation?.locationId || "");
    mediumByTaskId.set(task.id, operationalRequirementForBooked({
      reservationStatus: reservation?.status || "UNKNOWN",
      locationType: location?.type
    }).medium);
  }

  for (const reservation of booked) {
    const campaign = reservation.campaignId ? campaignById.get(reservation.campaignId) : null;
    const location = locationById.get(reservation.locationId);
    const entityCode = reservationEntityCode(reservation, campaignById);
    const requirement = operationalRequirementForBooked({
      reservationStatus: reservation.status,
      locationType: location?.type
    });
    const linkedTasks = tasksByReservation.get(reservation.id) || [];
    if (requirement.medium === "UNKNOWN" || requirement.medium === "DIGITAL") {
      findings.push(finding({
        category: "DATA_INSUFFICIENT",
        batch: "DATA_INSUFFICIENT",
        entityCode,
        kind: "UNKNOWN",
        status: reservation.status,
        medium: requirement.medium,
        confidence: requirement.medium === "DIGITAL" ? 80 : 40,
        reasonCode: requirement.reasonCodes[0] || "OPERATION_KIND_NOT_CANONICAL",
        title: requirement.medium === "DIGITAL"
          ? "Tip operațional digital necanonic"
          : "Mediu operațional nedeterminat",
        summary: `${location?.code || reservation.locationId}: aplicația nu poate inventa un task operațional sigur pentru acest suport.`,
        reservation,
        campaignId: campaign?.id || reservation.campaignId,
        locationId: location?.id || reservation.locationId,
        evidence: [
          evidence("Locație", location?.code || reservation.locationId),
          evidence("Format", location?.type || "Necunoscut"),
          evidence("Motiv", requirement.reasonCodes.join(", "))
        ]
      }));
    }
    for (const kind of requirement.requiredKinds) {
      const covered = linkedTasks.some((task) =>
        task.kind === kind && !TASK_TERMINAL_WITHOUT_DELIVERY.has(task.status)
      );
      if (covered) continue;
      const category: OperationTaskReconciliationCategory = kind === "NEUTRALIZATION"
        ? "NEUTRALIZATION_MISSING"
        : "BOOKED_WITHOUT_OPERATION_TASK";
      findings.push(finding({
        category,
        batch: "SAFE_CASES",
        entityCode,
        kind,
        status: reservation.status,
        medium: requirement.medium,
        confidence: 100,
        reasonCode: kind === "NEUTRALIZATION" ? "REQUIRED_NEUTRALIZATION_TASK_MISSING" : "REQUIRED_TASK_MISSING",
        title: kind === "NEUTRALIZATION" ? "Neutralizare lipsă" : "Obligație BOOKED fără task",
        summary: `${location?.code || reservation.locationId}: obligația statică nu are task ${kind.toLowerCase()} activ sau finalizat.`,
        reservation,
        campaignId: campaign?.id || reservation.campaignId,
        locationId: location?.id || reservation.locationId,
        evidence: [
          evidence("Locație", location?.code || reservation.locationId),
          evidence("Campanie", campaign?.campaignName || "Fără campanie"),
          evidence("Perioadă", `${dateKey(reservation.periodStart)} - ${dateKey(reservation.periodEnd)}`)
        ]
      }));
    }
  }

  addChangeoverFindings(findings, booked, campaignById, locationById);
  addDuplicateFindings(findings, tasks, reservationById, campaignById, locationById, mediumByTaskId);

  for (const task of tasks) {
    const reservation = task.reservationId ? reservationById.get(task.reservationId) : null;
    const campaign = task.campaignId
      ? campaignById.get(task.campaignId)
      : reservation?.campaignId
        ? campaignById.get(reservation.campaignId)
        : null;
    const location = locationById.get(task.locationId || reservation?.locationId || "");
    const entityCode = taskEntityCode(task, reservationById, campaignById);
    const medium = mediumByTaskId.get(task.id) || "UNKNOWN";
    const common = {
      entityCode,
      kind: task.kind,
      status: task.status,
      medium,
      task,
      reservation,
      campaignId: campaign?.id || task.campaignId,
      locationId: location?.id || task.locationId,
      scheduledFor: task.scheduledFor,
      evidence: [
        evidence("Task", task.id),
        evidence("Locație", location?.code || task.locationId || "Fără locație"),
        evidence("Sursă", task.source)
      ]
    };
    const linkedToBooked = reservation?.status === "BOOKED";
    const campaignStatus = campaign
      ? deriveCampaignEffectiveStatus({
          ...campaign,
          bookedPeriods: reservationsByCampaign.get(campaign.id) || []
        }, new Date(`${input.snapshotDate}T12:00:00.000Z`)).effectiveStatus
      : null;

    if (ACTIVE_TASK_STATUSES.has(task.status) && !task.assignedToUserId) {
      findings.push(finding({
        ...common,
        category: "UNASSIGNED_ACTIVE_TASK",
        batch: "NEEDS_HUMAN_CONFIRMATION",
        confidence: 100,
        reasonCode: "ACTIVE_TASK_ASSIGNEE_MISSING",
        title: "Task activ nealocat",
        summary: "Assignmentul nu poate fi dedus în siguranță și necesită decizie umană."
      }));
    }
    if (!linkedToBooked && !ACTIVE_CAMPAIGN_STATUSES.has(String(campaignStatus || ""))) {
      findings.push(finding({
        ...common,
        category: "ORPHAN_OPERATION_TASK",
        batch: "DO_NOT_MIGRATE",
        confidence: 95,
        reasonCode: "NO_ACTIVE_BOOKED_OR_CAMPAIGN",
        title: "Task fără obligație comercială validă",
        summary: "Taskul nu este susținut de un BOOKED sau de o campanie activă/programată."
      }));
    }
    if (linkedToBooked && TASK_TERMINAL_WITHOUT_DELIVERY.has(task.status)) {
      findings.push(finding({
        ...common,
        category: "TERMINAL_TASK_FOR_ACTIVE_OBLIGATION",
        batch: "NEEDS_HUMAN_CONFIRMATION",
        confidence: 100,
        reasonCode: "TERMINAL_TASK_ACTIVE_BOOKED",
        title: "Task terminal pentru obligație BOOKED",
        summary: "Obligația este încă BOOKED, dar taskul operațional este arhivat sau anulat."
      }));
    }
    if (task.status === "DONE" && ["DECORATION", "NEUTRALIZATION", "MAINTENANCE"].includes(task.kind) &&
        !hasCanonicalProof(task, reservation, proofsByReservation)) {
      findings.push(finding({
        ...common,
        category: "COMPLETED_WITHOUT_PROOF",
        batch: "NEEDS_HUMAN_CONFIRMATION",
        confidence: reservation ? 90 : 40,
        reasonCode: reservation ? "DONE_PROOF_MISSING" : "PROOF_LINK_DATA_INSUFFICIENT",
        title: "Task finalizat fără dovadă canonică",
        summary: reservation
          ? "Nu există o fotografie activă legată canonic de task sau de obligația sa."
          : "Taskul nu are rezervare, deci legătura către dovadă nu poate fi verificată."
      }));
    }
    if (hasImpossibleDates(task, reservation)) {
      findings.push(finding({
        ...common,
        category: "IMPOSSIBLE_TASK_DATE",
        batch: "DATA_INSUFFICIENT",
        confidence: 100,
        reasonCode: impossibleDateReason(task, reservation),
        title: "Date operaționale inconsistente",
        summary: "Datele taskului nu respectă ordinea temporală minimă a obligației."
      }));
    }
    if (task.source === "LEGACY_PRODUCTION_NOTES" || (reservation && reservation.status !== "BOOKED")) {
      findings.push(finding({
        ...common,
        category: "LEGACY_OR_STALE_TASK",
        batch: "DO_NOT_MIGRATE",
        confidence: task.source === "LEGACY_PRODUCTION_NOTES" ? 80 : 100,
        reasonCode: task.source === "LEGACY_PRODUCTION_NOTES" ? "LEGACY_SOURCE_REVIEW" : "NON_BOOKED_TASK_STALE",
        title: "Task legacy sau stale",
        summary: "Taskul trebuie păstrat istoric și revizuit înainte de orice cutover."
      }));
    }
    if (campaign && ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(String(campaignStatus || "").toUpperCase()) &&
        ACTIVE_TASK_STATUSES.has(task.status)) {
      findings.push(finding({
        ...common,
        category: "ENDED_CAMPAIGN_TASK",
        batch: "NEEDS_HUMAN_CONFIRMATION",
        confidence: 90,
        reasonCode: "ACTIVE_TASK_ENDED_CAMPAIGN",
        title: "Task activ pentru campanie terminată",
        summary: `Campania are status efectiv ${campaignStatus}, iar taskul este încă activ.`
      }));
    }
  }

  const filtered = filterFindings(findings, filters);
  const sorted = filtered.sort(compareFindings);
  const offset = cursorOffset(filters.cursor);
  const page = sorted.slice(offset, offset + filters.limit);
  const next = offset + page.length < sorted.length ? encodeCursor(offset + page.length) : null;
  const previous = offset > 0 ? encodeCursor(Math.max(0, offset - filters.limit)) : null;
  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const assignedActive = activeTasks.filter((task) => task.assignedToUserId).length;
  const batchPlan = primaryBatchPlan(filtered);
  const findingOccurrencesByBatch = countBy(filtered, (item) => item.batch);
  const summary = {
    bookedObligations: booked.length,
    operationTasks: tasks.length,
    activeTasks: activeTasks.length,
    assignedActiveTasks: assignedActive,
    unassignedActiveTasks: activeTasks.length - assignedActive,
    assignmentCompleteness: activeTasks.length ? Math.round((assignedActive / activeTasks.length) * 100) : 100,
    findings: filtered.length,
    uniqueAffectedTasks: new Set(filtered.flatMap((item) => item.taskId ? [item.taskId] : [])).size,
    uniqueAffectedReservations: new Set(filtered.flatMap((item) => item.reservationId ? [item.reservationId] : [])).size,
    batchPlanRecords: batchPlan.length,
    byCategory: countBy(filtered, (item) => item.category),
    byBatch: countBy(batchPlan, (item) => item.batch),
    byEntity: countBy(filtered, (item) => item.entityCode),
    byKind: countBy(tasks, (item) => item.kind),
    byStatus: countBy(tasks, (item) => item.status),
    byMedium: countBy(tasks, (item) => mediumByTaskId.get(item.id) || "UNKNOWN")
  };
  const review = buildOperationTaskCutoverReview({
    reservations,
    tasks,
    campaigns: input.campaigns,
    locations: input.locations,
    findings,
    snapshotDate: input.snapshotDate,
    filters: {
      priority: filters.priority,
      status: filters.status,
      medium: filters.medium,
      campaign: filters.campaign,
      location: filters.location,
      periodFrom: filters.periodFrom,
      periodTo: filters.periodTo,
      anomalyCode: filters.anomalyCode,
      reviewGroup: filters.reviewGroup,
      confidence: filters.confidence
    },
    cursor: filters.cursor,
    limit: filters.limit
  });

  return {
    kind: "operation-task-reconciliation",
    summary,
    batches: reconciliationBatches(summary.byBatch, findingOccurrencesByBatch),
    review,
    items: page,
    pagination: {
      limit: filters.limit,
      returned: page.length,
      previousCursor: previous,
      nextCursor: next
    },
    meta: {
      asOf: asOf.toISOString(),
      staleAt: new Date(asOf.getTime() + OPERATION_TASK_RECONCILIATION_REVALIDATE_SECONDS * 1000).toISOString(),
      stale: false,
      contractVersion: OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION,
      queryBudget: 5,
      readOnly: true,
      writesExecuted: 0,
      source: "CANONICAL_DRY_RUN"
    }
  };
}

export function reconciliationFilters(
  input: Record<string, string | string[] | undefined>
): OperationTaskReconciliationFilters {
  const category = scalar(input.category).toUpperCase() as OperationTaskReconciliationCategory;
  const batch = scalar(input.batch).toUpperCase() as OperationTaskReconciliationBatch;
  const medium = scalar(input.medium).toUpperCase() as OperationCutoverMediaClassification;
  const priority = scalar(input.priority).toUpperCase() as OperationCutoverPriority;
  const reviewGroup = scalar(input.reviewGroup).toUpperCase() as OperationCutoverReviewGroup;
  const confidence = scalar(input.confidence).toUpperCase();
  const limitText = scalar(input.limit).trim();
  const limit = Number(limitText);
  return {
    category: categories.has(category) ? category : "ALL",
    batch: batches.has(batch) ? batch : "ALL",
    kind: scalar(input.kind).toUpperCase(),
    status: scalar(input.status).toUpperCase(),
    medium: mediums.has(medium) ? medium : "ALL",
    priority: priorities.has(priority) ? priority : "ALL",
    campaign: scalar(input.campaign).trim(),
    location: scalar(input.location).trim(),
    periodFrom: validDateKey(scalar(input.periodFrom)),
    periodTo: validDateKey(scalar(input.periodTo)),
    anomalyCode: scalar(input.anomalyCode).trim().toUpperCase(),
    reviewGroup: reviewGroups.has(reviewGroup) ? reviewGroup : "ALL",
    confidence: ["HIGH", "MEDIUM", "LOW"].includes(confidence)
      ? confidence as OperationTaskReconciliationFilters["confidence"]
      : "ALL",
    cursor: validCursor(scalar(input.cursor)),
    limit: limitText && Number.isFinite(limit)
      ? Math.min(50, Math.max(1, Math.trunc(limit)))
      : OPERATION_TASK_RECONCILIATION_DEFAULT_LIMIT
  };
}

export function reconciliationCacheKey(context: CacheContext) {
  return [
    context.contractVersion,
    context.role,
    context.permissionHash,
    context.authorizedEntityHash,
    context.selectedEntityHash,
    context.snapshotDate,
    context.timezone,
    context.filters.category,
    context.filters.batch,
    context.filters.kind || "ALL",
    context.filters.status || "ALL",
    context.filters.medium,
    context.filters.priority,
    context.filters.campaign || "ALL",
    context.filters.location || "ALL",
    context.filters.periodFrom || "OPEN",
    context.filters.periodTo || "OPEN",
    context.filters.anomalyCode || "ALL",
    context.filters.reviewGroup,
    context.filters.confidence,
    context.filters.cursor || "FIRST",
    context.filters.limit
  ].join("|");
}

function addDuplicateFindings(
  findings: OperationTaskReconciliationFinding[],
  tasks: ReconciliationTask[],
  reservationById: Map<string, ReconciliationReservation>,
  campaignById: Map<string, ReconciliationCampaign>,
  locationById: Map<string, ReconciliationLocation>,
  mediumByTaskId: Map<string, OperationTaskMedium>
) {
  const groups = groupBy(tasks, (task) => [
    task.reservationId || `location:${task.locationId || "NONE"}`,
    task.kind,
    task.legacyTaskId || dateKey(task.scheduledFor)
  ].join("|"));
  for (const [signature, group] of groups) {
    if (group.length < 2) continue;
    const task = group[0];
    const reservation = task.reservationId ? reservationById.get(task.reservationId) : null;
    const location = locationById.get(task.locationId || reservation?.locationId || "");
    findings.push(finding({
      category: "DUPLICATE_TASK",
      batch: "DUPLICATES",
      entityCode: taskEntityCode(task, reservationById, campaignById),
      kind: task.kind,
      status: task.status,
      medium: mediumByTaskId.get(task.id) || "UNKNOWN",
      confidence: 95,
      reasonCode: "DUPLICATE_OPERATION_SIGNATURE",
      title: "Taskuri operaționale duplicate",
      summary: `${group.length} taskuri au aceeași obligație, tip și dată.`,
      task,
      reservation,
      campaignId: task.campaignId || reservation?.campaignId,
      locationId: location?.id || task.locationId,
      scheduledFor: task.scheduledFor,
      evidence: [
        evidence("Semnătură", signature),
        evidence("Taskuri", group.map((item) => item.id).join(", "))
      ]
    }));
  }
}

function addChangeoverFindings(
  findings: OperationTaskReconciliationFinding[],
  booked: ReconciliationReservation[],
  campaignById: Map<string, ReconciliationCampaign>,
  locationById: Map<string, ReconciliationLocation>
) {
  const byLocation = groupBy(booked, (reservation) => reservation.locationId);
  for (const reservations of byLocation.values()) {
    const sorted = [...reservations].sort((left, right) => left.periodEnd.getTime() - right.periodEnd.getTime());
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      if (dateKey(next.periodStart) !== addDateKeyDays(dateKey(current.periodEnd), 1)) continue;
      const location = locationById.get(current.locationId);
      findings.push(finding({
        category: "POSSIBLE_CHANGEOVER",
        batch: "NEEDS_HUMAN_CONFIRMATION",
        entityCode: reservationEntityCode(current, campaignById),
        kind: "NEUTRALIZATION",
        status: current.status,
        medium: operationalRequirementForBooked({
          reservationStatus: current.status,
          locationType: location?.type
        }).medium,
        confidence: 80,
        reasonCode: "CONSECUTIVE_BOOKED_POSSIBLE_CHANGEOVER",
        title: "Changeover direct posibil",
        summary: `${location?.code || current.locationId}: următoarea campanie începe în ziua următoare.`,
        reservation: current,
        campaignId: current.campaignId,
        locationId: current.locationId,
        scheduledFor: current.periodEnd,
        evidence: [
          evidence("BOOKED curent", current.id),
          evidence("BOOKED următor", next.id),
          evidence("Tranziție", `${dateKey(current.periodEnd)} → ${dateKey(next.periodStart)}`)
        ]
      }));
    }
  }
}

function hasCanonicalProof(
  task: ReconciliationTask,
  reservation: ReconciliationReservation | null | undefined,
  proofsByReservation: Map<string, ReconciliationProof[]>
) {
  if (!reservation) return false;
  return (proofsByReservation.get(reservation.id) || []).some((proof) => {
    const notes = parseOperationalProofNotes(proof.notes);
    const linkedTask = task.legacyTaskId ? notes?.taskId === task.legacyTaskId : !notes?.taskId;
    return linkedTask && proofContractForOperation({
      operationKind: task.kind,
      documentType: proof.documentType,
      linkedToTaskOrReservation: true
    }).satisfied;
  });
}

function hasImpossibleDates(task: ReconciliationTask, reservation?: ReconciliationReservation | null) {
  if (!task.scheduledFor) return true;
  if (task.completedAt && task.completedAt < task.createdAt) return true;
  if (task.status === "DONE" && !task.completedAt) return true;
  if (!reservation) return false;
  if (task.kind === "DECORATION" && task.scheduledFor > reservation.periodEnd) return true;
  if (task.kind === "NEUTRALIZATION" && task.scheduledFor < reservation.periodStart) return true;
  return false;
}

function impossibleDateReason(task: ReconciliationTask, reservation?: ReconciliationReservation | null) {
  if (!task.scheduledFor) return "SCHEDULED_FOR_MISSING";
  if (task.completedAt && task.completedAt < task.createdAt) return "COMPLETED_BEFORE_CREATED";
  if (task.status === "DONE" && !task.completedAt) return "DONE_WITHOUT_COMPLETED_AT";
  if (reservation && task.kind === "DECORATION" && task.scheduledFor > reservation.periodEnd) return "DECORATION_AFTER_BOOKED_END";
  if (reservation && task.kind === "NEUTRALIZATION" && task.scheduledFor < reservation.periodStart) return "NEUTRALIZATION_BEFORE_BOOKED_START";
  return "TASK_DATE_INCONSISTENT";
}

function finding(input: {
  category: OperationTaskReconciliationCategory;
  batch: OperationTaskReconciliationBatch;
  entityCode: string;
  kind: string;
  status: string;
  medium: OperationTaskMedium;
  confidence: number;
  reasonCode: string;
  title: string;
  summary: string;
  task?: ReconciliationTask | null;
  reservation?: ReconciliationReservation | null;
  campaignId?: string | null;
  locationId?: string | null;
  scheduledFor?: Date | null;
  evidence?: Array<{ label: string; value: string }>;
}): OperationTaskReconciliationFinding {
  const taskId = input.task?.id || null;
  const reservationId = input.reservation?.id || input.task?.reservationId || null;
  const entityCode = knownEntityCode(input.entityCode);
  const signature = [
    input.category,
    taskId || "NO_TASK",
    reservationId || "NO_RESERVATION",
    input.kind,
    input.reasonCode
  ].join("|");
  const deepLink = taskId
    ? `/admin/operational?taskId=${encodeURIComponent(taskId)}`
    : reservationId
      ? `/admin/locatii?panel=reservations&reservationId=${encodeURIComponent(reservationId)}`
      : "/admin/operational";
  return {
    id: stableHash(signature),
    category: input.category,
    batch: input.batch,
    entityCode,
    entityLabel: entityCode === "UNKNOWN" ? "Entitate necunoscută" : entityLabelForCode(entityCode),
    kind: input.kind,
    status: input.status,
    medium: input.medium,
    confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
    dataQualityState: input.confidence >= 90 ? "HIGH" : input.confidence >= 70 ? "MEDIUM" : input.confidence >= 40 ? "LOW" : "DATA_INSUFFICIENT",
    reasonCode: input.reasonCode,
    title: input.title,
    summary: input.summary,
    taskId,
    reservationId,
    campaignId: input.campaignId || input.task?.campaignId || null,
    locationId: input.locationId || input.task?.locationId || null,
    scheduledFor: input.scheduledFor?.toISOString() || input.task?.scheduledFor?.toISOString() || null,
    evidence: input.evidence || [],
    deepLink
  };
}

function filterFindings(
  findings: OperationTaskReconciliationFinding[],
  filters: OperationTaskReconciliationFilters
) {
  return findings.filter((item) =>
    (filters.category === "ALL" || item.category === filters.category) &&
    (filters.batch === "ALL" || item.batch === filters.batch) &&
    (!filters.kind || item.kind === filters.kind) &&
    (!filters.status || item.status === filters.status) &&
    (filters.medium === "ALL" || item.medium === filters.medium)
  );
}

function compareFindings(left: OperationTaskReconciliationFinding, right: OperationTaskReconciliationFinding) {
  const batchOrder: Record<OperationTaskReconciliationBatch, number> = {
    SAFE_CASES: 0,
    NEEDS_HUMAN_CONFIRMATION: 1,
    DUPLICATES: 2,
    DATA_INSUFFICIENT: 3,
    DO_NOT_MIGRATE: 4
  };
  return batchOrder[left.batch] - batchOrder[right.batch] ||
    left.category.localeCompare(right.category) ||
    left.id.localeCompare(right.id);
}

function primaryBatchPlan(findings: OperationTaskReconciliationFinding[]) {
  const precedence: Record<OperationTaskReconciliationBatch, number> = {
    DUPLICATES: 0,
    DO_NOT_MIGRATE: 1,
    DATA_INSUFFICIENT: 2,
    NEEDS_HUMAN_CONFIRMATION: 3,
    SAFE_CASES: 4
  };
  const groups = groupBy(findings, (item) =>
    item.taskId
      ? `task:${item.taskId}`
      : item.reservationId
        ? `reservation:${item.reservationId}:${item.kind}`
        : `finding:${item.id}`
  );
  return [...groups.values()].map((group) =>
    [...group].sort((left, right) => precedence[left.batch] - precedence[right.batch])[0]
  );
}

function reconciliationBatches(
  counts: Record<string, number>,
  findingCounts: Record<string, number>
) {
  const definitions: Array<[OperationTaskReconciliationBatch, string, string]> = [
    ["SAFE_CASES", "Cazuri deterministe", "Eligibile pentru un viitor dry-run de materializare, numai după aprobare."],
    ["NEEDS_HUMAN_CONFIRMATION", "Necesită confirmare umană", "Assignmentul, changeover-ul sau starea trebuie validate de un manager."],
    ["DO_NOT_MIGRATE", "Nu se migrează automat", "Se păstrează istoric până la o decizie explicită de arhivare/decommission."],
    ["DUPLICATES", "Posibile duplicate", "Se compară manual și se păstrează taskul canonic; nu se șterge nimic automat."],
    ["DATA_INSUFFICIENT", "Date insuficiente", "Se completează tipul, legătura sau datele înainte de orice cutover."]
  ];
  return definitions.map(([id, label, proposedTreatment]) => ({
    id,
    label,
    count: counts[id] || 0,
    findingCount: findingCounts[id] || 0,
    proposedTreatment,
    executionApproved: false as const
  }));
}

function reservationEntityCode(
  reservation: ReconciliationReservation,
  campaignById: Map<string, ReconciliationCampaign>
) {
  const campaignEntity = reservation.campaignId
    ? campaignById.get(reservation.campaignId)?.companyEntity
    : null;
  return companyCodeForEntity(campaignEntity || reservation.contractCompany) || "UNKNOWN";
}

function taskEntityCode(
  task: ReconciliationTask,
  reservationById: Map<string, ReconciliationReservation>,
  campaignById: Map<string, ReconciliationCampaign>
) {
  const directCampaign = task.campaignId ? campaignById.get(task.campaignId) : null;
  const reservation = task.reservationId ? reservationById.get(task.reservationId) : null;
  const reservationCampaign = reservation?.campaignId ? campaignById.get(reservation.campaignId) : null;
  const entity = normalizeCompanyEntity(
    directCampaign?.companyEntity ||
    reservationCampaign?.companyEntity ||
    reservation?.contractCompany
  );
  return companyCodeForEntity(entity) || "UNKNOWN";
}

function knownEntityCode(value: string) {
  return ALL_ENTITY_CODES.includes(value as (typeof ALL_ENTITY_CODES)[number])
    ? value as (typeof ALL_ENTITY_CODES)[number]
    : "UNKNOWN";
}

function defaultFilters(): OperationTaskReconciliationFilters {
  const reviewFilters = defaultOperationCutoverFilters();
  return {
    category: "ALL",
    batch: "ALL",
    kind: "",
    ...reviewFilters,
    cursor: null,
    limit: OPERATION_TASK_RECONCILIATION_DEFAULT_LIMIT
  };
}

function validDateKey(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const date = new Date(`${normalized}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : normalized;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) || []), row]);
  }
  return groups;
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function evidence(label: string, value: unknown) {
  return { label, value: String(value ?? "-") };
}

function dateKey(value?: Date | null) {
  return value ? bucharestBusinessDateKey(value) : "necunoscut";
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function reconciliationOffset(cursor: string | null) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = decoded.match(/^offset:(\d+)$/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function cursorOffset(cursor: string | null) {
  return reconciliationOffset(cursor);
}

function validCursor(value: string) {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return /^offset:\d+$/.test(decoded) ? value : null;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
