import { createHash } from "node:crypto";
import type { AuthSession } from "@/lib/auth";
import {
  EXECUTIVE_ALERTS_CONTRACT_VERSION,
  EXECUTIVE_ALERTS_DEFAULT_LIMIT,
  type ExecutiveAlertCacheContext,
  type ExecutiveAlertDomain,
  type ExecutiveAlertFilters,
  type ExecutiveAlertRuleType,
  type ExecutiveAlertSeverity
} from "@/lib/dashboard/executive/alerts-contracts";
import type { ExecutiveDataQuality, ExecutiveScope } from "@/lib/dashboard/executive/contracts";
import { executiveScopeForSession } from "@/lib/dashboard/executive/scope";
import { permissionsForRole } from "@/lib/rbac";

const severities = new Set<ExecutiveAlertSeverity>(["P0", "P1", "P2", "DATA_QUALITY"]);
const domains = new Set<ExecutiveAlertDomain>(["FINANCE", "CAMPAIGNS", "HOLD", "OPERATIONS", "CRM", "INVENTORY"]);
const qualities = new Set<ExecutiveDataQuality>(["HIGH", "MEDIUM", "LOW", "DATA_INSUFFICIENT"]);
const rules = new Set<ExecutiveAlertRuleType>([
  "OVERDUE_RECEIVABLE",
  "RECEIVABLE_OWNER_MISSING",
  "CAMPAIGN_START_RISK",
  "HOLD_EXPIRING",
  "HOLD_DATA_INCONSISTENCY",
  "OPERATION_ASSIGNMENT_COVERAGE_LOW",
  "OPERATION_TASK_OVERDUE",
  "BOOKED_WITHOUT_OPERATION_TASK",
  "ORPHAN_OPERATION_TASK",
  "COMPLETED_WITHOUT_PROOF",
  "CRM_NEXT_ACTION_OVERDUE",
  "ACTIVE_LOCATION_PHOTO_MISSING",
  "UNKNOWN_INVENTORY_STATE"
]);

export function executiveAlertRequest(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {},
  now = new Date()
) {
  const scope = executiveScopeForSession(session, input, now);
  const filters = executiveAlertFilters(input);
  return {
    scope,
    filters,
    cacheContext: executiveAlertCacheContext(scope, filters)
  };
}

export function executiveAlertFilters(
  input: Record<string, string | string[] | undefined> = {}
): ExecutiveAlertFilters {
  const severityValue = scalar(input.severity).toUpperCase() as ExecutiveAlertSeverity;
  const domainValue = scalar(input.domain).toUpperCase() as ExecutiveAlertDomain;
  const qualityValue = scalar(input.dataQuality).toUpperCase() as ExecutiveDataQuality;
  const ruleValue = scalar(input.ruleType).toUpperCase() as ExecutiveAlertRuleType;
  return {
    severity: severities.has(severityValue) ? severityValue : "ALL",
    domain: domains.has(domainValue) ? domainValue : "ALL",
    owner: scalar(input.owner).trim(),
    dataQuality: qualities.has(qualityValue) ? qualityValue : "ALL",
    ruleType: rules.has(ruleValue) ? ruleValue : "ALL",
    cursor: validCursor(scalar(input.cursor)),
    limit: boundedLimit(scalar(input.limit))
  };
}

export function executiveAlertCacheContext(
  scope: ExecutiveScope,
  filters: ExecutiveAlertFilters
): ExecutiveAlertCacheContext {
  return {
    contractVersion: EXECUTIVE_ALERTS_CONTRACT_VERSION,
    role: scope.role,
    permissionHash: stableHash([...permissionsForRole(scope.role)].sort()),
    authorizedEntityHash: stableHash([...scope.authorizedEntityCodes].sort()),
    selectedEntityHash: stableHash([...scope.selectedEntityCodes].sort()),
    selectedEntityCodes: scope.selectedEntityCodes,
    snapshotDate: scope.snapshotDate,
    timezone: scope.timeZone,
    severity: filters.severity,
    domain: filters.domain,
    owner: filters.owner,
    dataQuality: filters.dataQuality,
    ruleType: filters.ruleType,
    cursor: filters.cursor,
    limit: filters.limit
  };
}

export function executiveAlertsCacheKey(context: ExecutiveAlertCacheContext) {
  return [
    context.contractVersion,
    context.role,
    context.permissionHash,
    context.authorizedEntityHash,
    context.selectedEntityHash,
    context.snapshotDate,
    context.timezone,
    context.severity,
    context.domain,
    context.owner || "ALL",
    context.dataQuality,
    context.ruleType,
    context.cursor || "FIRST",
    context.limit
  ].join("|");
}

export function cursorOffset(cursor: string | null) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = decoded.match(/^offset:(\d+)$/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

export function nextCursor(offset: number) {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

function validCursor(value: string) {
  if (!value) return null;
  return cursorOffset(value) >= 0 ? value : null;
}

function boundedLimit(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return EXECUTIVE_ALERTS_DEFAULT_LIMIT;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

