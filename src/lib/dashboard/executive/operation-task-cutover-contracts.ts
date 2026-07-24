import type { ExecutiveDataQuality, ExecutiveEntityCode } from "@/lib/dashboard/executive/contracts";

export const OPERATION_TASK_CUTOVER_CONTRACT_VERSION = "operation-task-cutover-review-v1";

export type OperationCutoverPriority =
  | "CRITICAL_CURRENT"
  | "RECENT_RELEVANT"
  | "HISTORICAL_LEGACY";

export type OperationCutoverReviewGroup =
  | "DETERMINISTIC"
  | "HUMAN_REVIEW"
  | "LEGACY_EXCLUDED";

export type OperationCutoverMediaClassification =
  | "STATIC"
  | "DIGITAL"
  | "MIXED"
  | "UNKNOWN";

export type OperationCutoverCaseType =
  | "EXISTING_TASK"
  | "MISSING_TASK"
  | "POSSIBLE_CHANGEOVER";

export type OperationCutoverProposedClassification =
  | "CREATE_MISSING_TASK"
  | "LINK_SAFE"
  | "HUMAN_LINK_REQUIRED"
  | "KEEP_AS_LEGACY"
  | "EXCLUDE_FROM_CURRENT_METRICS"
  | "POSSIBLE_DUPLICATE"
  | "HISTORICAL_PROOF_UNAVAILABLE"
  | "DATA_INSUFFICIENT";

export type OperationCutoverHumanDecision =
  | "APPROVE_PROPOSAL"
  | "REJECT_PROPOSAL"
  | "NEEDS_INFORMATION"
  | "KEEP_AS_LEGACY"
  | "EXCLUDE_FROM_CURRENT_METRICS"
  | "LINK_TO_EXISTING_ENTITY"
  | "CREATE_MISSING_TASK"
  | "NO_OPERATION_REQUIRED";

export type OperationCutoverCase = {
  stableCaseId: string;
  caseType: OperationCutoverCaseType;
  priority: OperationCutoverPriority;
  reviewGroup: OperationCutoverReviewGroup;
  companyEntity: ExecutiveEntityCode | "UNKNOWN";
  companyEntityLabel: string;
  campaignId: string | null;
  campaignName: string | null;
  client: string | null;
  locationId: string | null;
  locationCode: string | null;
  reservationId: string | null;
  relatedReservationId: string | null;
  operationTaskId: string | null;
  campaignStart: string | null;
  campaignEnd: string | null;
  taskType: string;
  taskStatus: string;
  scheduledFor: string | null;
  completedAt: string | null;
  assignedToUserId: string | null;
  assignedToLabel: string;
  mediaClassification: OperationCutoverMediaClassification;
  anomalyCodes: string[];
  proposedClassification: OperationCutoverProposedClassification;
  proposedAction: string;
  confidence: number;
  dataQualityState: ExecutiveDataQuality;
  evidence: Array<{ label: string; value: string }>;
  risk: string;
  humanDecision: OperationCutoverHumanDecision | "";
  reviewerNotes: "";
  deepLink: string;
  dataCompleteness: number;
  proposedMetricsEligibility: {
    eligible: boolean;
    reasonCodes: string[];
    policyStatus: "PROPOSED_NOT_ACTIVE";
  };
};

export type OperationCutoverReviewFilters = {
  priority: OperationCutoverPriority | "ALL";
  status: string;
  medium: OperationCutoverMediaClassification | "ALL";
  campaign: string;
  location: string;
  periodFrom: string;
  periodTo: string;
  anomalyCode: string;
  reviewGroup: OperationCutoverReviewGroup | "ALL";
  confidence: "ALL" | "HIGH" | "MEDIUM" | "LOW";
};

export type OperationCutoverAssignmentSlice = {
  id: "ALL_ACTIVE" | "CURRENT_FUTURE" | "DUE_7_DAYS" | "DUE_30_DAYS";
  label: string;
  total: number;
  assigned: number;
  unassigned: number;
  completeness: number;
  target: number | null;
  policyStatus: "PROPOSED_NOT_ACTIVE";
};

export type OperationCutoverMediaMatrixRow = {
  locationType: string;
  exampleCodes: string[];
  locationCount: number;
  classification: OperationCutoverMediaClassification;
  startOperation: string;
  endOperation: string;
  existingTaskTypes: string[];
  confidence: number;
  missingData: string[];
};

export type OperationCutoverAmbiguityCluster = {
  id: string;
  label: string;
  caseCount: number;
  unresolvedRule: string;
  missingFields: string[];
  recommendation: string;
  risk: string;
  exampleCaseIds: string[];
  businessDecisionRequired: string;
};

export type OperationCutoverRemediationBatch = {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  label: string;
  caseCount: number;
  findingCount: number;
  criteria: string;
  futureMutation: string;
  validation: string;
  risk: string;
  rollback: string;
  expectedAssignmentEffect: string;
  expectedPulseEffect: string;
  expectedAlertsEffect: string;
  executionApproved: false;
};

export type OperationCutoverReview = {
  contractVersion: typeof OPERATION_TASK_CUTOVER_CONTRACT_VERSION;
  summary: {
    decisionCases: number;
    findingOccurrences: number;
    taskCases: number;
    missingTaskCases: number;
    changeoverCases: number;
    distinctTasks: number;
    distinctReservations: number;
    distinctCampaigns: number;
    distinctLocations: number;
    byPriority: Record<string, number>;
    byReviewGroup: Record<string, number>;
    byClassification: Record<string, number>;
    byAnomaly: Record<string, number>;
  };
  filteredCaseCount: number;
  cases: OperationCutoverCase[];
  pagination: {
    limit: number;
    returned: number;
    previousCursor: string | null;
    nextCursor: string | null;
  };
  assignmentCompleteness: OperationCutoverAssignmentSlice[];
  mediaMatrix: OperationCutoverMediaMatrixRow[];
  ambiguityClusters: OperationCutoverAmbiguityCluster[];
  remediationBatches: OperationCutoverRemediationBatch[];
  cutoverOptions: Array<{
    id: "DEPLOY_DATE" | "MONTH_START" | "AFTER_CRITICAL_REVIEW";
    label: string;
    advantages: string[];
    risks: string[];
    recommended: boolean;
    activationApproved: false;
  }>;
  eligibilityPolicy: {
    status: "PROPOSED_NOT_ACTIVE";
    proposedFunction: "isOperationalMetricsEligibleTask";
    rules: string[];
    consumersNotYetMigrated: string[];
  };
  forwardWorkflow: string[];
  rootCause: {
    summary: string;
    evidence: string[];
    assignmentIsNotAutoInferred: true;
  };
};
