import {
  OPERATION_TASK_KINDS,
  OPERATION_TASK_STATUSES,
  dedupeOperationTaskDrafts,
  deriveBaseTasksFromReservation,
  parseLegacyOperationTasksForMigration,
  type OperationTaskDraft,
  type OperationTaskIssue,
  type OperationTaskKind,
  type OperationTaskReservationLike,
  type OperationTaskStatus
} from "./operation-tasks";

export type OperationTaskBackfillReservation = OperationTaskReservationLike & {
  clientId?: string | null;
};

export type OperationTaskBackfillOptions = {
  existingDedupeKeys?: Iterable<string | null | undefined>;
  alreadyExistingOperationTaskCount?: number | null;
  operationTaskTableAccessible?: boolean;
  operationTaskTableError?: string | null;
  sampleLimit?: number;
};

export type OperationTaskBackfillWarning = OperationTaskIssue & {
  dedupeKey?: string | null;
};

export type OperationTaskBackfillReport = {
  reservationsScanned: number;
  operationTaskTableAccessible: boolean;
  operationTaskTableError: string | null;
  alreadyExistingOperationTaskCount: number | null;
  derivedTaskCount: number;
  wouldCreateCount: number;
  wouldSkipExistingCount: number;
  tasksByKind: Record<OperationTaskKind, number>;
  tasksByStatus: Record<OperationTaskStatus, number>;
  duplicateDedupeKeysFound: number;
  corruptedProductionNotesCount: number;
  ambiguousLegacyTaskCount: number;
  missingDateCount: number;
  missingReservationLinkCount: number;
  missingClientLinkCount: number;
  missingCampaignLinkCount: number;
  missingLocationLinkCount: number;
  warnings: OperationTaskBackfillWarning[];
  comparison: OperationTaskBackfillComparison;
};

export type OperationTaskBackfillComparison = {
  legacyDerivedActiveTaskCount: number;
  operationTaskDraftActiveTaskCount: number;
  activeCountDifferenceAfterDedupe: number;
  potentialDoubleCountRiskCount: number;
  disagreementReservationIds: string[];
};

export type OperationTaskBackfillPlan = {
  report: OperationTaskBackfillReport;
  allDrafts: OperationTaskDraft[];
  createableDrafts: OperationTaskDraft[];
  skippedExistingDrafts: OperationTaskDraft[];
  issues: OperationTaskBackfillWarning[];
};

export type OperationTaskWriteDelegate = {
  createMany(input: { data: OperationTaskCreateRow[]; skipDuplicates: boolean }): Promise<{ count: number }>;
};

export type OperationTaskWriteResult = {
  attempted: number;
  created: number;
  skipped: number;
};

export type OperationTaskCreateRow = {
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  source: OperationTaskDraft["source"];
  dedupeKey: string;
  legacyTaskId: string | null;
  scheduledFor: Date | null;
  completedAt: Date | null;
  assignedToUserId: string | null;
  supplierId: string | null;
  cost: number | null;
  currency: string | null;
  briefUrl: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  notes: string | null;
  createdByUserId: string | null;
};

const ACTIVE_STATUSES = new Set<OperationTaskStatus>(["NEW", "IN_PROGRESS"]);
const MISSING_DATE_ISSUES = new Set(["missing_decoration_base_data", "missing_neutralization_base_data", "missing_legacy_task_date"]);
const AMBIGUOUS_ISSUES = new Set(["ambiguous_legacy_task_type", "ambiguous_legacy_status"]);

export function buildOperationTaskBackfillPlan(
  reservations: OperationTaskBackfillReservation[],
  options: OperationTaskBackfillOptions = {}
): OperationTaskBackfillPlan {
  const existingDedupeKeys = new Set(
    [...(options.existingDedupeKeys || [])].map((key) => String(key || "").trim()).filter(Boolean)
  );
  const sampleLimit = Math.max(1, options.sampleLimit ?? 12);
  const rawDrafts: OperationTaskDraft[] = [];
  const issues: OperationTaskBackfillWarning[] = [];
  const reservationsMissingClient = new Set<string>();
  const reservationsMissingCampaign = new Set<string>();
  const reservationsMissingLocation = new Set<string>();

  for (const reservation of reservations) {
    const reservationId = textValue(reservation.id);
    if (!textValue(reservation.clientId)) addReservationSample(reservationsMissingClient, reservationId);
    if (!textValue(reservation.campaignId)) addReservationSample(reservationsMissingCampaign, reservationId);
    if (!textValue(reservation.locationId)) addReservationSample(reservationsMissingLocation, reservationId);

    const base = deriveBaseTasksFromReservation(reservation);
    const legacyExtras = parseLegacyOperationTasksForMigration(reservation);
    rawDrafts.push(...base.tasks, ...legacyExtras.tasks);
    issues.push(...base.issues, ...legacyExtras.issues);
  }

  const deduped = dedupeOperationTaskDrafts(rawDrafts);
  issues.push(...deduped.issues);

  const allDrafts = deduped.tasks;
  const createableDrafts = allDrafts.filter((task) => task.dedupeKey && !existingDedupeKeys.has(task.dedupeKey));
  const skippedExistingDrafts = allDrafts.filter((task) => task.dedupeKey && existingDedupeKeys.has(task.dedupeKey));
  const duplicateDedupeKeysFound = issues.filter((issue) => issue.code === "duplicate_dedupe_key").length;
  const disagreementReservationIds = uniqueSample(
    issues
      .filter((issue) => ["duplicate_dedupe_key", "missing_reservation_id"].includes(issue.code))
      .map((issue) => issue.reservationId),
    sampleLimit
  );

  return {
    report: {
      reservationsScanned: reservations.length,
      operationTaskTableAccessible: options.operationTaskTableAccessible ?? true,
      operationTaskTableError: options.operationTaskTableError || null,
      alreadyExistingOperationTaskCount: options.alreadyExistingOperationTaskCount ?? null,
      derivedTaskCount: allDrafts.length,
      wouldCreateCount: createableDrafts.length,
      wouldSkipExistingCount: skippedExistingDrafts.length,
      tasksByKind: countTasksByKind(createableDrafts),
      tasksByStatus: countTasksByStatus(createableDrafts),
      duplicateDedupeKeysFound,
      corruptedProductionNotesCount: countUniqueReservationsByIssue(issues, "corrupted_legacy_metadata"),
      ambiguousLegacyTaskCount: issues.filter((issue) => AMBIGUOUS_ISSUES.has(issue.code)).length,
      missingDateCount: issues.filter((issue) => MISSING_DATE_ISSUES.has(issue.code)).length,
      missingReservationLinkCount: issues.filter((issue) => issue.code === "missing_reservation_id").length,
      missingClientLinkCount: reservationsMissingClient.size,
      missingCampaignLinkCount: reservationsMissingCampaign.size,
      missingLocationLinkCount: reservationsMissingLocation.size,
      warnings: issues.slice(0, sampleLimit),
      comparison: {
        legacyDerivedActiveTaskCount: rawDrafts.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
        operationTaskDraftActiveTaskCount: allDrafts.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
        activeCountDifferenceAfterDedupe:
          allDrafts.filter((task) => ACTIVE_STATUSES.has(task.status)).length -
          rawDrafts.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
        potentialDoubleCountRiskCount: skippedExistingDrafts.length,
        disagreementReservationIds
      }
    },
    allDrafts,
    createableDrafts,
    skippedExistingDrafts,
    issues
  };
}

export async function executeOperationTaskBackfill(
  reservations: OperationTaskBackfillReservation[],
  delegate: OperationTaskWriteDelegate,
  options: OperationTaskBackfillOptions & { write?: boolean } = {}
) {
  const plan = buildOperationTaskBackfillPlan(reservations, options);
  if (!options.write) return { plan, writeResult: null };
  if (options.operationTaskTableAccessible === false) {
    throw new Error(`OperationTask table is not accessible: ${options.operationTaskTableError || "unknown error"}`);
  }
  const writeResult = await writeOperationTaskBackfill(plan.createableDrafts, delegate);
  return { plan, writeResult };
}

export async function writeOperationTaskBackfill(tasks: OperationTaskDraft[], delegate: OperationTaskWriteDelegate): Promise<OperationTaskWriteResult> {
  const data = operationTaskCreateRows(tasks);
  if (!data.length) return { attempted: 0, created: 0, skipped: 0 };
  const result = await delegate.createMany({ data, skipDuplicates: true });
  return {
    attempted: data.length,
    created: result.count,
    skipped: data.length - result.count
  };
}

export function operationTaskCreateRows(tasks: OperationTaskDraft[]): OperationTaskCreateRow[] {
  return tasks.flatMap((task) => {
    if (!task.dedupeKey) return [];
    return [{
      reservationId: task.reservationId,
      campaignId: task.campaignId,
      locationId: task.locationId,
      kind: task.kind,
      status: task.status,
      source: task.source,
      dedupeKey: task.dedupeKey,
      legacyTaskId: task.legacyTaskId || null,
      scheduledFor: task.scheduledFor,
      completedAt: task.completedAt || null,
      assignedToUserId: task.assignedToUserId || null,
      supplierId: task.supplierId || null,
      cost: task.cost ?? null,
      currency: task.currency || null,
      briefUrl: task.briefUrl || null,
      beforePhotoUrl: task.beforePhotoUrl || null,
      afterPhotoUrl: task.afterPhotoUrl || null,
      notes: task.notes || null,
      createdByUserId: task.createdByUserId || null
    }];
  });
}

function countTasksByKind(tasks: OperationTaskDraft[]) {
  const counts = Object.fromEntries(OPERATION_TASK_KINDS.map((kind) => [kind, 0])) as Record<OperationTaskKind, number>;
  for (const task of tasks) counts[task.kind] += 1;
  return counts;
}

function countTasksByStatus(tasks: OperationTaskDraft[]) {
  const counts = Object.fromEntries(OPERATION_TASK_STATUSES.map((status) => [status, 0])) as Record<OperationTaskStatus, number>;
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function countUniqueReservationsByIssue(issues: OperationTaskBackfillWarning[], code: string) {
  return new Set(issues.filter((issue) => issue.code === code).map((issue) => issue.reservationId || issue.legacyTaskId || issue.message)).size;
}

function uniqueSample(values: Array<string | null | undefined>, limit: number) {
  const unique = [...new Set(values.map((value) => textValue(value)).filter(Boolean) as string[])];
  return unique.slice(0, limit);
}

function addReservationSample(target: Set<string>, reservationId: string | null) {
  target.add(reservationId || "(missing reservation id)");
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}
