import type { UserRole } from "@/lib/rbac";
import type { ExecutiveAlertsResponse } from "@/lib/dashboard/executive/alerts-contracts";
import type { OperationTaskReconciliationResponse } from "@/lib/dashboard/executive/operation-task-reconciliation-contracts";

export const EXECUTIVE_CONTRACT_VERSION = "executive-overview-v2";
export const EXECUTIVE_TIME_ZONE = "Europe/Bucharest";
export const EXECUTIVE_REVALIDATE_SECONDS = 30;

export type ExecutiveEntityCode = "FOCUS_MEDIA" | "EXCELLENCE_MEDIA" | "FOCUS_BG";
export type ExecutiveEntitySelection = ExecutiveEntityCode | "ALL";
export type ExecutiveDataQuality = "HIGH" | "MEDIUM" | "LOW" | "DATA_INSUFFICIENT";
export type ExecutivePeriodPreset = "TODAY" | "WEEK" | "MONTH" | "CUSTOM";

export type ExecutiveScope = {
  role: Extract<UserRole, "SUPER_ADMIN" | "COO" | "D_CEO">;
  entitySelection: ExecutiveEntitySelection;
  authorizedEntityCodes: ExecutiveEntityCode[];
  selectedEntityCodes: ExecutiveEntityCode[];
  snapshotDate: string;
  periodPreset: ExecutivePeriodPreset;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
  timeZone: typeof EXECUTIVE_TIME_ZONE;
  panel: string | null;
  contractVersion: typeof EXECUTIVE_CONTRACT_VERSION;
};

export type ExecutiveMoney = {
  entityCode: ExecutiveEntityCode;
  entityLabel: string;
  currency: string;
  amount: string;
  count: number;
  href: string;
};

export type ExecutivePulseDimension = {
  id: "finance" | "operations" | "campaigns" | "sales" | "inventory" | "crm";
  label: string;
  weight: number;
  score: number | null;
  confidence: number;
  dataCompleteness: number;
  positiveReasons: string[];
  negativeReasons: string[];
  reasonCodes: string[];
  href: string;
};

export type ExecutivePulse = {
  overallScore: number | null;
  totalConfidence: number;
  status: "AVAILABLE" | "INSUFFICIENT_DATA" | "ENTITY_SPLIT_REQUIRED";
  message: string;
  missingData: string[];
  dimensions: ExecutivePulseDimension[];
  trend: {
    direction: "UP" | "DOWN" | "FLAT" | "UNAVAILABLE";
    delta: number | null;
    confidence: number;
    label: string;
  };
  mainFactors: Array<{
    id: string;
    label: string;
    count: number;
    tone: "positive" | "warning" | "critical" | "neutral";
    href: string;
  }>;
};

export type ExecutiveInventoryPartition = {
  total: number;
  inactive: number;
  archived: number;
  maintenance: number;
  lifecycleBlocked: number;
  booked: number;
  hold: number;
  manualUnavailable: number;
  available: number;
  unknown: number;
  eligible: number;
  occupancyRate: number | null;
  activeBookedReservations: number;
  activeHoldReservations: number;
  lifecycleBookingConflicts: number;
};

export type ExecutiveCampaignRisk = {
  id: string;
  campaignName: string;
  clientName: string;
  effectiveStatus: "ACTIVE" | "SCHEDULED";
  startDate: string | null;
  severity: "P0" | "P1" | "P2" | "DATA_QUALITY";
  reasonCodes: string[];
  href: string;
};

export type ExecutiveFactItem = {
  id: string;
  label: string;
  detail: string;
  count: number;
  severity: "critical" | "warning" | "neutral";
  confidence: number;
  dataQuality: ExecutiveDataQuality;
  href: string;
};

export type ExecutiveAttentionItem = {
  id: string;
  title: string;
  summary: string;
  severity: "P0" | "P1" | "P2" | "DATA_QUALITY";
  domain: string;
  impactLabel: string;
  responsibleLabel: string;
  deadline: string | null;
  confidence: number;
  occurrenceCount: number;
  why: string;
  href: string;
};

export type ExecutiveOverview = {
  kind: "executive";
  role: ExecutiveScope["role"];
  viewer: {
    id: string;
    canUseQuickActions: boolean;
  };
  scope: ExecutiveScope;
  meta: {
    asOf: string;
    staleAt: string;
    stale: boolean;
    timeZone: typeof EXECUTIVE_TIME_ZONE;
    contractVersion: typeof EXECUTIVE_CONTRACT_VERSION;
    queryBudget: number;
    source: "CANONICAL_LIVE";
  };
  entities: Array<{ code: ExecutiveEntityCode; label: string }>;
  pulseByEntity: Array<{ entityCode: ExecutiveEntityCode; entityLabel: string; pulse: ExecutivePulse }>;
  summary: {
    activeCampaigns: number;
    campaignsStartingToday: number;
    campaignsEndingToday: number;
    campaignRisks: number;
    inventory: ExecutiveInventoryPartition;
    collectionsThisMonth: ExecutiveMoney[];
    overdueInvoices: ExecutiveMoney[];
    dueWithinSevenDays: ExecutiveMoney[];
    activeClients: number;
    openOperationTasks: number;
    operationsToday: {
      decorations: number;
      neutralizations: number;
      confidence: number;
      dataQuality: ExecutiveDataQuality;
      note: string;
    };
  };
  campaignRisks: ExecutiveCampaignRisk[];
  alertPreview: ExecutiveFactItem[];
  attentionPreview: ExecutiveAttentionItem[];
  bottleneckPreview: ExecutiveFactItem[];
  alerts?: ExecutiveAlertsResponse;
  operationTaskReconciliation?: OperationTaskReconciliationResponse;
};
