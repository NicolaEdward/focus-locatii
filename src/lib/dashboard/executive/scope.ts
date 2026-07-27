import type { AuthSession } from "@/lib/auth";
import { companyEntities } from "@/lib/company-entities";
import {
  EXECUTIVE_CONTRACT_VERSION,
  EXECUTIVE_TIME_ZONE,
  type ExecutiveEntityCode,
  type ExecutiveEntitySelection,
  type ExecutivePeriodPreset,
  type ExecutiveScope
} from "@/lib/dashboard/executive/contracts";
import {
  bucharestBusinessDateKey,
  currentMonthPeriod,
  previousEquivalentPeriod,
  validDateKey
} from "@/lib/dashboard/executive/time";

export const EXECUTIVE_ENTITIES = companyEntities.map((entity) => ({
  code: entity.code as ExecutiveEntityCode,
  value: entity.value,
  label: entity.label
}));

export function executiveScopeForSession(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {},
  now = new Date()
): ExecutiveScope {
  if (!["SUPER_ADMIN", "COO", "D_CEO"].includes(session.role)) {
    throw new Error("Executive Command Center nu este disponibil pentru acest rol.");
  }
  const authorizedEntityCodes = EXECUTIVE_ENTITIES.map((entity) => entity.code);
  const requestedEntity = scalar(input.entity).toUpperCase();
  const entitySelection: ExecutiveEntitySelection = authorizedEntityCodes.includes(requestedEntity as ExecutiveEntityCode)
    ? requestedEntity as ExecutiveEntityCode
    : "ALL";
  const selectedEntityCodes = entitySelection === "ALL" ? authorizedEntityCodes : [entitySelection];
  const today = bucharestBusinessDateKey(now);
  const snapshotDate = validDateKey(scalar(input.snapshot), today);
  const periodPreset = periodPresetValue(input.period);
  const defaultPeriod = periodForPreset(periodPreset, snapshotDate);
  const periodStart = periodPreset === "CUSTOM"
    ? validDateKey(scalar(input.periodStart), defaultPeriod.start)
    : defaultPeriod.start;
  const periodEndCandidate = periodPreset === "CUSTOM"
    ? validDateKey(scalar(input.periodEnd), defaultPeriod.end)
    : defaultPeriod.end;
  const periodEnd = periodEndCandidate < periodStart ? periodStart : periodEndCandidate;
  const comparison = previousEquivalentPeriod(periodStart, periodEnd);

  return {
    role: session.role as ExecutiveScope["role"],
    entitySelection,
    authorizedEntityCodes,
    selectedEntityCodes,
    snapshotDate,
    periodPreset,
    periodStart,
    periodEnd,
    comparisonStart: comparison.start,
    comparisonEnd: comparison.end,
    timeZone: EXECUTIVE_TIME_ZONE,
    panel: scalar(input.panel) || null,
    contractVersion: EXECUTIVE_CONTRACT_VERSION
  };
}

export function executiveCacheKey(scope: ExecutiveScope) {
  return [
    scope.contractVersion,
    scope.role,
    scope.authorizedEntityCodes.join(","),
    scope.selectedEntityCodes.join(","),
    scope.snapshotDate,
    scope.periodPreset,
    scope.periodStart,
    scope.periodEnd,
    scope.comparisonStart,
    scope.comparisonEnd,
    scope.timeZone,
    scope.panel || "overview"
  ].join("|");
}

export function entityValueForCode(code: ExecutiveEntityCode) {
  return EXECUTIVE_ENTITIES.find((entity) => entity.code === code)?.value || null;
}

export function entityLabelForCode(code: ExecutiveEntityCode) {
  return EXECUTIVE_ENTITIES.find((entity) => entity.code === code)?.label || code;
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function periodPresetValue(value: string | string[] | undefined): ExecutivePeriodPreset {
  const candidate = scalar(value).toUpperCase();
  return ["TODAY", "WEEK", "MONTH", "CUSTOM"].includes(candidate)
    ? candidate as ExecutivePeriodPreset
    : "MONTH";
}

function periodForPreset(preset: ExecutivePeriodPreset, snapshotDate: string) {
  if (preset === "TODAY") return { start: snapshotDate, end: snapshotDate };
  if (preset === "WEEK") {
    const date = new Date(`${snapshotDate}T00:00:00.000Z`);
    const day = date.getUTCDay() || 7;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
  }
  return currentMonthPeriod(snapshotDate);
}
