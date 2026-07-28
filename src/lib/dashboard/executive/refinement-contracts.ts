import type { UserRole } from "@/lib/rbac";
import type {
  ExecutiveDataQuality,
  ExecutiveEntityCode,
  ExecutiveFilterApplicability,
  ExecutiveScope
} from "@/lib/dashboard/executive/contracts";

export const EXECUTIVE_REFINEMENT_CONTRACT_VERSION = "executive-refinement-v3";

export type ExecutiveAmount = {
  entityCode: ExecutiveEntityCode | "UNKNOWN";
  currency: string;
  amount: string;
  count: number;
};

export type ExecutivePerson = {
  id: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  department: string;
  departmentSource: "ROLE_DERIVED";
  clientsManaged: number;
  campaignsManaged: number;
  openTasks: number;
  completedTasks: number;
  openCrmActions: number;
  openOpportunities: number;
  pipeline: ExecutiveAmount[];
  lastBusinessActivityAt: string | null;
  workload: {
    level: "NORMAL" | "HIGH" | "UNDETERMINED";
    explanation: string[];
  };
  issues: Array<{
    code: string;
    label: string;
    count: number;
    href: string;
  }>;
  dataQuality: ExecutiveDataQuality;
};

export type ExecutivePeopleResponse = {
  kind: "executive-people";
  scope: ExecutiveScope;
  people: ExecutivePerson[];
  filterApplicability: ExecutiveFilterApplicability;
  notes: string[];
  meta: ExecutiveRefinementMeta;
};

export type ExecutiveCustomer = {
  id: string;
  companyName: string;
  ownerLabel: string;
  activeCampaigns: number;
  upcomingCampaigns: number;
  bookedReservations: number;
  businessValue: ExecutiveAmount[];
  outstanding: ExecutiveAmount[];
  overdue: ExecutiveAmount[];
  riskIssues: string[];
  contractDocumentState: "AVAILABLE" | "MISSING" | "NOT_APPLICABLE";
  crmActivityState: "DATA_INSUFFICIENT";
  businessReasons: string[];
  href: string;
};

export type ExecutiveCustomersResponse = {
  kind: "executive-customers";
  scope: ExecutiveScope;
  topBusiness: ExecutiveCustomer[];
  topRisk: ExecutiveCustomer[];
  notes: string[];
  meta: ExecutiveRefinementMeta;
};

export type ExecutiveActivityTone = "POSITIVE" | "PROBLEM" | "NEUTRAL";

export type ExecutiveActivityItem = {
  id: string;
  tone: ExecutiveActivityTone;
  type: "PAYMENT" | "BOOKING" | "CAMPAIGN" | "OPERATION" | "CRM";
  title: string;
  detail: string;
  occurredAt: string;
  entityCode: ExecutiveEntityCode | "SHARED" | "UNKNOWN";
  href: string;
};

export type ExecutiveActivityResponse = {
  kind: "executive-activity";
  scope: ExecutiveScope;
  items: ExecutiveActivityItem[];
  unavailableSources: string[];
  meta: ExecutiveRefinementMeta;
};

export type ExecutiveSearchEntity =
  | "CLIENT"
  | "CAMPAIGN"
  | "RESERVATION"
  | "LOCATION"
  | "INVOICE"
  | "PAYMENT"
  | "CONTRACT"
  | "CRM"
  | "USER"
  | "TASK"
  | "DOCUMENT";

export type ExecutiveSearchResult = {
  id: string;
  entity: ExecutiveSearchEntity;
  label: string;
  context: string;
  href: string;
};

export type ExecutiveSearchResponse = {
  kind: "executive-search";
  query: string;
  items: ExecutiveSearchResult[];
  truncated: boolean;
};

export type ExecutiveRefinementMeta = {
  asOf: string;
  staleAt: string;
  stale: false;
  contractVersion: typeof EXECUTIVE_REFINEMENT_CONTRACT_VERSION;
  source: "CANONICAL_LIVE";
};
