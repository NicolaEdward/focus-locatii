import type {
  ExecutiveDataQuality,
  ExecutiveEntityCode,
  ExecutiveScope
} from "@/lib/dashboard/executive/contracts";

export const OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION = "operation-task-reconciliation-v1";
export const OPERATION_TASK_RECONCILIATION_DEFAULT_LIMIT = 50;
export const OPERATION_TASK_RECONCILIATION_REVALIDATE_SECONDS = 30;

export type OperationTaskReconciliationCategory =
  | "BOOKED_WITHOUT_OPERATION_TASK"
  | "NEUTRALIZATION_MISSING"
  | "ORPHAN_OPERATION_TASK"
  | "UNASSIGNED_ACTIVE_TASK"
  | "DUPLICATE_TASK"
  | "TERMINAL_TASK_FOR_ACTIVE_OBLIGATION"
  | "COMPLETED_WITHOUT_PROOF"
  | "IMPOSSIBLE_TASK_DATE"
  | "LEGACY_OR_STALE_TASK"
  | "ENDED_CAMPAIGN_TASK"
  | "POSSIBLE_CHANGEOVER"
  | "DATA_INSUFFICIENT";

export type OperationTaskReconciliationBatch =
  | "SAFE_CASES"
  | "NEEDS_HUMAN_CONFIRMATION"
  | "DO_NOT_MIGRATE"
  | "DUPLICATES"
  | "DATA_INSUFFICIENT";

export type OperationTaskMedium = "STATIC" | "DIGITAL" | "UNKNOWN";

export type OperationTaskReconciliationFinding = {
  id: string;
  category: OperationTaskReconciliationCategory;
  batch: OperationTaskReconciliationBatch;
  entityCode: ExecutiveEntityCode | "UNKNOWN";
  entityLabel: string;
  kind: string;
  status: string;
  medium: OperationTaskMedium;
  confidence: number;
  dataQualityState: ExecutiveDataQuality;
  reasonCode: string;
  title: string;
  summary: string;
  taskId: string | null;
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  scheduledFor: string | null;
  evidence: Array<{ label: string; value: string }>;
  deepLink: string;
};

export type OperationTaskReconciliationFilters = {
  category: OperationTaskReconciliationCategory | "ALL";
  batch: OperationTaskReconciliationBatch | "ALL";
  kind: string;
  status: string;
  medium: OperationTaskMedium | "ALL";
  cursor: string | null;
  limit: number;
};

export type OperationTaskReconciliationResponse = {
  kind: "operation-task-reconciliation";
  role: ExecutiveScope["role"];
  scope: ExecutiveScope;
  filters: OperationTaskReconciliationFilters;
  summary: {
    bookedObligations: number;
    operationTasks: number;
    activeTasks: number;
    assignedActiveTasks: number;
    unassignedActiveTasks: number;
    assignmentCompleteness: number;
    findings: number;
    uniqueAffectedTasks: number;
    uniqueAffectedReservations: number;
    batchPlanRecords: number;
    byCategory: Record<string, number>;
    byBatch: Record<string, number>;
    byEntity: Record<string, number>;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    byMedium: Record<string, number>;
  };
  batches: Array<{
    id: OperationTaskReconciliationBatch;
    label: string;
    count: number;
    findingCount: number;
    proposedTreatment: string;
    executionApproved: false;
  }>;
  items: OperationTaskReconciliationFinding[];
  pagination: {
    limit: number;
    returned: number;
    previousCursor: string | null;
    nextCursor: string | null;
  };
  meta: {
    asOf: string;
    staleAt: string;
    stale: boolean;
    contractVersion: typeof OPERATION_TASK_RECONCILIATION_CONTRACT_VERSION;
    queryBudget: 5;
    readOnly: true;
    writesExecuted: 0;
    source: "CANONICAL_DRY_RUN";
  };
};
