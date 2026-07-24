import type {
  ExecutiveDataQuality,
  ExecutiveEntityCode,
  ExecutiveScope
} from "@/lib/dashboard/executive/contracts";

export const EXECUTIVE_ALERTS_CONTRACT_VERSION = "executive-alerts-v1";
export const EXECUTIVE_ALERTS_REVALIDATE_SECONDS = 30;
export const EXECUTIVE_ALERTS_DEFAULT_LIMIT = 50;
export const EXECUTIVE_ALERTS_PREVIEW_LIMIT = 6;

export type ExecutiveAlertSeverity = "P0" | "P1" | "P2" | "DATA_QUALITY";
export type ExecutiveAlertDomain = "FINANCE" | "CAMPAIGNS" | "HOLD" | "OPERATIONS" | "CRM" | "INVENTORY";
export type ExecutiveAlertRuleType =
  | "OVERDUE_RECEIVABLE"
  | "RECEIVABLE_OWNER_MISSING"
  | "CAMPAIGN_START_RISK"
  | "HOLD_EXPIRING"
  | "HOLD_DATA_INCONSISTENCY"
  | "OPERATION_ASSIGNMENT_COVERAGE_LOW"
  | "OPERATION_TASK_OVERDUE"
  | "BOOKED_WITHOUT_OPERATION_TASK"
  | "ORPHAN_OPERATION_TASK"
  | "COMPLETED_WITHOUT_PROOF"
  | "CRM_NEXT_ACTION_OVERDUE"
  | "ACTIVE_LOCATION_PHOTO_MISSING"
  | "UNKNOWN_INVENTORY_STATE";

export type ExecutiveAlertEvidenceItem = {
  label: string;
  value: string;
};

export type ExecutiveAlertSourceRef = {
  id: string;
  label: string;
  href: string;
};

export type ExecutiveAlertImpact = {
  kind: "MONEY" | "COUNT" | "DELIVERY" | "DATA_QUALITY";
  label: string;
  amount?: string;
  currency?: string;
  count?: number;
};

export type ExecutiveAlert = {
  id: string;
  fingerprint: string;
  ruleType: ExecutiveAlertRuleType;
  reasonCode: string;
  reasonCodes: string[];
  domain: ExecutiveAlertDomain;
  entityType: string;
  entityId: string;
  entityLabel: string;
  companyEntity: ExecutiveEntityCode | "SHARED_INVENTORY" | "SHARED_CRM" | "UNKNOWN";
  title: string;
  summary: string;
  severity: ExecutiveAlertSeverity;
  impact: ExecutiveAlertImpact;
  confidence: number;
  dataQualityState: ExecutiveDataQuality;
  responsibleUserId: string | null;
  responsibleLabel: string;
  detectedAt: string;
  dueAt: string | null;
  age: {
    days: number;
    hours: number;
    label: string;
  };
  recommendedAction: string;
  evidence: ExecutiveAlertEvidenceItem[];
  sourceRefs: ExecutiveAlertSourceRef[];
  deepLink: string;
  relevantWindow: string;
  groupKey: string;
  occurrenceCount: number;
  asOf: string;
};

export type ExecutiveAlertFilters = {
  severity: ExecutiveAlertSeverity | "ALL";
  domain: ExecutiveAlertDomain | "ALL";
  owner: string;
  dataQuality: ExecutiveDataQuality | "ALL";
  ruleType: ExecutiveAlertRuleType | "ALL";
  cursor: string | null;
  limit: number;
};

export type ExecutiveAlertCacheContext = {
  contractVersion: typeof EXECUTIVE_ALERTS_CONTRACT_VERSION;
  role: ExecutiveScope["role"];
  permissionHash: string;
  authorizedEntityHash: string;
  selectedEntityHash: string;
  selectedEntityCodes: ExecutiveEntityCode[];
  snapshotDate: string;
  timezone: ExecutiveScope["timeZone"];
  severity: ExecutiveAlertFilters["severity"];
  domain: ExecutiveAlertFilters["domain"];
  owner: string;
  dataQuality: ExecutiveAlertFilters["dataQuality"];
  ruleType: ExecutiveAlertFilters["ruleType"];
  cursor: string | null;
  limit: number;
};

export type ExecutiveAlertSummary = {
  total: number;
  bySeverity: Record<ExecutiveAlertSeverity, number>;
  byDomain: Record<ExecutiveAlertDomain, number>;
};

export type ExecutiveAlertsResponse = {
  kind: "executive-alerts";
  role: ExecutiveScope["role"];
  scope: ExecutiveScope;
  filters: ExecutiveAlertFilters;
  summary: ExecutiveAlertSummary;
  filterOptions: {
    owners: Array<{ id: string; label: string }>;
  };
  items: ExecutiveAlert[];
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
    contractVersion: typeof EXECUTIVE_ALERTS_CONTRACT_VERSION;
    queryBudget: 6;
    source: "CANONICAL_LIVE";
  };
  disabledRules: Array<{
    ruleType: string;
    reason: string;
  }>;
};
