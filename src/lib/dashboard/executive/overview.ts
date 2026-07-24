import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import type { AuthSession } from "@/lib/auth";
import { decideAvailability } from "@/lib/availability";
import { deriveCampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import {
  EXECUTIVE_REVALIDATE_SECONDS,
  type ExecutiveCampaignRisk,
  type ExecutiveEntityCode,
  type ExecutiveFactItem,
  type ExecutiveInventoryPartition,
  type ExecutiveMoney,
  type ExecutiveOverview,
  type ExecutivePulseDimension,
  type ExecutiveScope
} from "@/lib/dashboard/executive/contracts";
import { buildExecutivePulse, EXECUTIVE_PULSE_WEIGHTS } from "@/lib/dashboard/executive/pulse";
import { executiveAlertPreview, getExecutiveAlerts } from "@/lib/dashboard/executive/alerts";
import { getOperationTaskReconciliation } from "@/lib/dashboard/executive/operation-task-reconciliation";
import {
  entityLabelForCode,
  entityValueForCode,
  executiveCacheKey,
  executiveScopeForSession,
  EXECUTIVE_ENTITIES
} from "@/lib/dashboard/executive/scope";
import {
  bucharestDayBounds,
  dateKeyAsStorageDate,
  daysBetween
} from "@/lib/dashboard/executive/time";
import { prisma } from "@/lib/prisma";
import { effectiveHoldWhere } from "@/lib/reservation-lifecycle";
import { isEffectiveHold } from "@/lib/reservation-lifecycle-domain";

const activeOpportunityStages = ["opportunity", "quoted", "negotiation", "contracting"];
const activeTaskStatuses = ["NEW", "IN_PROGRESS"] as const;

const cachedOverview = unstable_cache(
  async (scope: ExecutiveScope) => queryExecutiveOverview(scope),
  ["executive-overview-v1"],
  { revalidate: EXECUTIVE_REVALIDATE_SECONDS, tags: ["executive-overview"] }
);

export async function getExecutiveOverview(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  const scope = executiveScopeForSession(session, input);
  // The explicit cache key documents and tests every authorization and business-time dimension.
  executiveCacheKey(scope);
  const alertInput = scope.panel === "alerts"
    ? input
    : {
        entity: scope.entitySelection,
        snapshot: scope.snapshotDate,
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
        limit: "6"
      };
  const reconciliationPromise = scope.panel === "operation-task-reconciliation"
    ? getOperationTaskReconciliation(session, input)
    : Promise.resolve(null);
  const [overview, alerts, operationTaskReconciliation] = await Promise.all([
    cachedOverview(scope),
    getExecutiveAlerts(session, alertInput),
    reconciliationPromise
  ]);
  return {
    ...overview,
    alertPreview: executiveAlertPreview(alerts),
    ...(scope.panel === "alerts" ? { alerts } : {}),
    ...(operationTaskReconciliation ? { operationTaskReconciliation } : {})
  };
}

export async function queryExecutiveOverview(scope: ExecutiveScope, now = new Date()): Promise<ExecutiveOverview> {
  const asOf = now;
  const staleAt = new Date(asOf.getTime() + EXECUTIVE_REVALIDATE_SECONDS * 1000);
  const snapshotStorageDate = dateKeyAsStorageDate(scope.snapshotDate);
  const snapshotBounds = bucharestDayBounds(scope.snapshotDate);
  const periodBounds = {
    start: bucharestDayBounds(scope.periodStart).start,
    endExclusive: bucharestDayBounds(scope.periodEnd).endExclusive
  };
  const selectedEntityValues = scope.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const financeEntityWhere: Prisma.FinancialReceivableWhereInput = { companyCode: { in: scope.selectedEntityCodes } };
  const campaignEntityWhere: Prisma.CampaignWhereInput = { companyEntity: { in: selectedEntityValues } };
  const holdWhere = effectiveHoldWhere(snapshotBounds.start);

  const [
    openReceivables,
    periodPayments,
    campaigns,
    locations,
    todayTaskGroups,
    assignmentGroups,
    crmOpportunities,
    crmOpenActions
  ] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        ...financeEntityWhere,
        includedInReport: true,
        needsReview: false,
        remainingAmount: { gt: 0 }
      },
      select: { companyCode: true, currency: true, remainingAmount: true, dueDate: true }
    }),
    prisma.financialReceivablePayment.findMany({
      where: {
        status: "active",
        receivedAt: { gte: periodBounds.start, lt: periodBounds.endExclusive },
        receivable: { is: { ...financeEntityWhere, includedInReport: true, needsReview: false } }
      },
      select: {
        amount: true,
        currency: true,
        receivable: { select: { companyCode: true } }
      }
    }),
    prisma.campaign.findMany({
      where: {
        ...campaignEntityWhere,
        archivedAt: null,
        status: { notIn: ["archived", "cancelled", "completed", "draft"] }
      },
      select: {
        id: true,
        campaignName: true,
        campaignType: true,
        companyEntity: true,
        status: true,
        startDate: true,
        endDate: true,
        totalContractValue: true,
        accountOwnerUserId: true,
        sellerUserId: true,
        client: { select: { companyName: true, accountOwnerUserId: true } },
        documents: {
          where: { documentType: "contract", status: "active" },
          select: { id: true },
          take: 1
        },
        reservations: {
          where: { status: "BOOKED" },
          select: {
            id: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            location: { select: { type: true } }
          }
        },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }]
    }),
    prisma.location.findMany({
      select: {
        id: true,
        lifecycleStatus: true,
        status: true,
        availabilityText: true,
        availableFrom: true,
        availableUntil: true,
        bookedFrom: true,
        bookedUntil: true,
        blockedReason: true,
        blockedFrom: true,
        blockedUntil: true,
        reservations: {
          where: {
            AND: [
              { OR: [{ status: "BOOKED" }, holdWhere] },
              { periodStart: { lte: snapshotStorageDate } },
              { periodEnd: { gte: snapshotStorageDate } }
            ]
          },
          select: { id: true, status: true, periodStart: true, periodEnd: true, holdExpiresAt: true, createdAt: true }
        },
        availabilityOverrides: {
          where: {
            clearedAt: null,
            periodStart: { lte: snapshotStorageDate },
            OR: [{ periodEnd: null }, { periodEnd: { gte: snapshotStorageDate } }]
          },
          select: { id: true, type: true, reason: true, periodStart: true, periodEnd: true, clearedAt: true }
        }
      }
    }),
    prisma.operationTask.groupBy({
      by: ["kind", "status"],
      where: {
        kind: { in: ["DECORATION", "NEUTRALIZATION"] },
        scheduledFor: { gte: snapshotBounds.start, lt: snapshotBounds.endExclusive },
        status: { notIn: ["ARCHIVED", "CANCELLED"] }
      },
      _count: { _all: true }
    }),
    prisma.operationTask.groupBy({
      by: ["assignedToUserId"],
      where: { status: { in: [...activeTaskStatuses] } },
      _count: { _all: true }
    }),
    prisma.crmOpportunity.findMany({
      where: { stage: { in: activeOpportunityStages } },
      select: {
        id: true,
        ownerId: true,
        nextActions: {
          where: { status: "open" },
          select: { id: true },
          take: 1
        }
      }
    }),
    prisma.crmNextAction.count({
      where: { status: "open", dueAt: { lt: snapshotBounds.start } }
    })
  ]);

  const campaignDecisions = campaigns.map((campaign) => ({
    campaign,
    decision: deriveCampaignEffectiveStatus({
      ...campaign,
      bookedPeriods: campaign.reservations
    }, snapshotBounds.start)
  })).filter((row) => row.decision.effectiveStatus === "ACTIVE" || row.decision.effectiveStatus === "SCHEDULED");
  const campaignRisks = campaignDecisions
    .map(({ campaign, decision }) => campaignRisk(
      campaign,
      decision.effectiveStatus as "ACTIVE" | "SCHEDULED",
      scope.snapshotDate
    ))
    .filter((risk): risk is ExecutiveCampaignRisk => Boolean(risk))
    .sort(riskSort);

  const inventory = buildInventoryPartition(locations, snapshotStorageDate, snapshotBounds.start);
  const collectionsThisMonth = groupPayments(periodPayments, scope);
  const overdueInvoices = groupOverdue(openReceivables, snapshotStorageDate, scope);
  const unassignedTasks = assignmentGroups.find((row) => row.assignedToUserId === null)?._count._all || 0;
  const activeTasks = assignmentGroups.reduce((sum, row) => sum + row._count._all, 0);
  const assignmentCompleteness = activeTasks ? Math.round(((activeTasks - unassignedTasks) / activeTasks) * 100) : 0;
  const operationsConfidence = activeTasks ? Math.min(70, assignmentCompleteness) : 0;
  const operationsToday = {
    decorations: taskGroupCount(todayTaskGroups, "DECORATION"),
    neutralizations: taskGroupCount(todayTaskGroups, "NEUTRALIZATION"),
    confidence: operationsConfidence,
    dataQuality: operationsConfidence >= 60 ? "MEDIUM" as const : activeTasks ? "LOW" as const : "DATA_INSUFFICIENT" as const,
    note: activeTasks
      ? `${unassignedTasks} din ${activeTasks} taskuri active sunt nealocate. Valorile reprezintă doar taskurile înregistrate.`
      : "Nu există suficiente taskuri operaționale canonice pentru acoperire completă."
  };

  const pulseByEntity = scope.selectedEntityCodes.map((entityCode) => ({
    entityCode,
    entityLabel: entityLabelForCode(entityCode),
    pulse: buildExecutivePulse(
      pulseDimensions({
        entityCode,
        openReceivables,
        campaignDecisions,
        campaignRisks,
        operationsConfidence,
        assignmentCompleteness,
        inventory,
        crmOpportunities,
        crmOpenActions,
        snapshotDate: snapshotStorageDate
      })
    )
  }));

  return {
    kind: "executive",
    role: scope.role,
    scope,
    meta: {
      asOf: asOf.toISOString(),
      staleAt: staleAt.toISOString(),
      stale: false,
      timeZone: scope.timeZone,
      contractVersion: scope.contractVersion,
      queryBudget: 15,
      source: "CANONICAL_LIVE"
    },
    entities: EXECUTIVE_ENTITIES.map(({ code, label }) => ({ code, label })),
    pulseByEntity,
    summary: {
      activeCampaigns: campaignDecisions.filter((row) => row.decision.effectiveStatus === "ACTIVE").length,
      campaignRisks: campaignRisks.length,
      inventory,
      collectionsThisMonth,
      overdueInvoices,
      operationsToday
    },
    campaignRisks: scope.panel === "campaign-risks" ? campaignRisks : campaignRisks.slice(0, 6),
    alertPreview: [],
    bottleneckPreview: bottleneckPreview({
      campaignRisks,
      overdueInvoices,
      unassignedTasks,
      activeTasks,
      inventory
    })
  };
}

type CampaignRow = Awaited<ReturnType<typeof prisma.campaign.findMany<{
  select: {
    id: true;
    campaignName: true;
    campaignType: true;
    companyEntity: true;
    status: true;
    startDate: true;
    endDate: true;
    totalContractValue: true;
    accountOwnerUserId: true;
    sellerUserId: true;
    client: { select: { companyName: true; accountOwnerUserId: true } };
    documents: { select: { id: true } };
    reservations: { select: { id: true; status: true; periodStart: true; periodEnd: true; location: { select: { type: true } } } };
  };
}>>>[number];

function campaignRisk(
  campaign: CampaignRow,
  effectiveStatus: "ACTIVE" | "SCHEDULED",
  snapshotDate: string
): ExecutiveCampaignRisk | null {
  const reasonCodes: string[] = [];
  const externalPaidType = ["direct_client", "agency"].includes(String(campaign.campaignType || "").toLowerCase());
  if (!campaign.accountOwnerUserId && !campaign.sellerUserId && !campaign.client.accountOwnerUserId) {
    reasonCodes.push("CAMPAIGN_OWNER_MISSING");
  }
  if (externalPaidType && campaign.documents.length === 0) reasonCodes.push("CONTRACT_REQUIRED_MISSING");
  if (campaign.totalContractValue == null || new Prisma.Decimal(campaign.totalContractValue).lte(0)) {
    reasonCodes.push("PRICE_MISSING_OR_INVALID");
  }
  const validBooked = campaign.reservations.filter((reservation) =>
    reservation.status === "BOOKED" &&
    (!campaign.startDate || reservation.periodEnd >= campaign.startDate) &&
    (!campaign.endDate || reservation.periodStart <= campaign.endDate)
  );
  if (!validBooked.length) reasonCodes.push("REQUIRED_BOOKED_MISSING");
  if (!reasonCodes.length) return null;

  const startKey = campaign.startDate?.toISOString().slice(0, 10) || snapshotDate;
  const daysUntilStart = daysBetween(snapshotDate, startKey);
  const severity = daysUntilStart <= 1 ? "P0" : daysUntilStart <= 3 ? "P1" : "P2";
  return {
    id: campaign.id,
    campaignName: campaign.campaignName,
    clientName: campaign.client.companyName,
    effectiveStatus,
    startDate: campaign.startDate?.toISOString() || null,
    severity,
    reasonCodes,
    href: `/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`
  };
}

export function buildInventoryPartition(
  locations: Array<{
    id: string;
    lifecycleStatus: string;
    status: string;
    availabilityText: string | null;
    availableFrom: Date | null;
    availableUntil: Date | null;
    bookedFrom: Date | null;
    bookedUntil: Date | null;
    blockedReason: string | null;
    blockedFrom: Date | null;
    blockedUntil: Date | null;
    reservations: Array<{ id: string; status: string; periodStart: Date; periodEnd: Date; holdExpiresAt: Date | null; createdAt: Date }>;
    availabilityOverrides: Array<{ id: string; type: string; reason: string; periodStart: Date; periodEnd: Date | null; clearedAt: Date | null }>;
  }>,
  snapshotStorageDate: Date,
  snapshotNow: Date
): ExecutiveInventoryPartition {
  const partition = {
    total: locations.length,
    inactive: 0,
    archived: 0,
    maintenance: 0,
    lifecycleBlocked: 0,
    booked: 0,
    hold: 0,
    manualUnavailable: 0,
    available: 0,
    unknown: 0,
    eligible: 0,
    occupancyRate: null as number | null,
    activeBookedReservations: 0,
    activeHoldReservations: 0,
    lifecycleBookingConflicts: 0
  };

  for (const location of locations) {
    const hasBooked = location.reservations.some((reservation) => reservation.status === "BOOKED");
    const activeHolds = location.reservations.filter((reservation) => isEffectiveHold(reservation, snapshotNow));
    partition.activeBookedReservations += location.reservations.filter((reservation) => reservation.status === "BOOKED").length;
    partition.activeHoldReservations += activeHolds.length;

    if (location.lifecycleStatus === "INACTIVE") {
      partition.inactive += 1;
      if (hasBooked) partition.lifecycleBookingConflicts += 1;
      continue;
    }
    if (location.lifecycleStatus === "ARCHIVED") {
      partition.archived += 1;
      if (hasBooked) partition.lifecycleBookingConflicts += 1;
      continue;
    }
    if (location.lifecycleStatus === "MAINTENANCE") {
      partition.maintenance += 1;
      if (hasBooked) partition.lifecycleBookingConflicts += 1;
      continue;
    }

    const decision = decideAvailability({
      ...location,
      periodStart: snapshotStorageDate,
      periodEnd: snapshotStorageDate,
      now: snapshotNow
    });
    if (hasBooked) partition.booked += 1;
    else if (activeHolds.length) partition.hold += 1;
    else if (decision.reasons.some((reason) =>
      ["OVERRIDE_COMMERCIAL_BLOCK", "OVERRIDE_MAINTENANCE", "OVERRIDE_INTERNAL_HOLD", "LEGACY_MANUAL_BLOCK"].includes(reason.code)
    )) partition.manualUnavailable += 1;
    else if (decision.isBookable) partition.available += 1;
    else partition.unknown += 1;
  }

  partition.eligible = partition.booked + partition.hold + partition.available;
  partition.occupancyRate = partition.eligible ? roundOne((partition.booked / partition.eligible) * 100) : null;
  const sum = partition.inactive + partition.archived + partition.maintenance + partition.lifecycleBlocked +
    partition.booked + partition.hold + partition.manualUnavailable + partition.available + partition.unknown;
  if (sum !== partition.total) throw new Error(`Partiția inventarului nu este disjunctă: ${sum}/${partition.total}.`);
  return partition;
}

function groupPayments(
  rows: Array<{ amount: Prisma.Decimal; currency: string; receivable: { companyCode: string | null } }>,
  scope: ExecutiveScope
) {
  return moneyGroups(rows.map((row) => ({
    entityCode: row.receivable.companyCode,
    currency: row.currency,
    amount: row.amount
  })), scope, "period");
}

function groupOverdue(
  rows: Array<{ companyCode: string | null; currency: string | null; remainingAmount: Prisma.Decimal | null; dueDate: Date | null }>,
  snapshotDate: Date,
  scope: ExecutiveScope
) {
  return moneyGroups(rows
    .filter((row) => row.dueDate && row.dueDate < snapshotDate)
    .map((row) => ({
      entityCode: row.companyCode,
      currency: row.currency,
      amount: row.remainingAmount
    })), scope, "overdue");
}

function moneyGroups(
  rows: Array<{ entityCode: string | null; currency: string | null; amount: Prisma.Decimal | null }>,
  scope: ExecutiveScope,
  status: "period" | "overdue"
): ExecutiveMoney[] {
  const groups = new Map<string, { entityCode: ExecutiveEntityCode; currency: string; amount: Prisma.Decimal; count: number }>();
  for (const row of rows) {
    if (!scope.selectedEntityCodes.includes(row.entityCode as ExecutiveEntityCode)) continue;
    const entityCode = row.entityCode as ExecutiveEntityCode;
    const currency = row.currency || "NECUNOSCUT";
    const key = `${entityCode}|${currency}`;
    const current = groups.get(key) || { entityCode, currency, amount: new Prisma.Decimal(0), count: 0 };
    current.amount = current.amount.add(row.amount || 0);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => a.entityCode.localeCompare(b.entityCode) || a.currency.localeCompare(b.currency))
    .map((group) => ({
      entityCode: group.entityCode,
      entityLabel: entityLabelForCode(group.entityCode),
      currency: group.currency,
      amount: group.amount.toFixed(2),
      count: group.count,
      href: status === "overdue"
        ? `/admin/financiar/incasari?status=overdue&companyCode=${group.entityCode}&currency=${group.currency}`
        : `/admin/financiar/incasari?companyCode=${group.entityCode}&currency=${group.currency}`
    }));
}

function pulseDimensions(input: {
  entityCode: ExecutiveEntityCode;
  openReceivables: Array<{ companyCode: string | null; currency: string | null; remainingAmount: Prisma.Decimal | null; dueDate: Date | null }>;
  campaignDecisions: Array<{ campaign: CampaignRow; decision: { effectiveStatus: string } }>;
  campaignRisks: ExecutiveCampaignRisk[];
  operationsConfidence: number;
  assignmentCompleteness: number;
  inventory: ExecutiveInventoryPartition;
  crmOpportunities: Array<{ id: string; ownerId: string | null; nextActions: Array<{ id: string }> }>;
  crmOpenActions: number;
  snapshotDate: Date;
}): ExecutivePulseDimension[] {
  const entityReceivables = input.openReceivables.filter((row) => row.companyCode === input.entityCode);
  const currencies = new Set(entityReceivables.map((row) => row.currency || "NECUNOSCUT"));
  const entityValue = entityValueForCode(input.entityCode);
  const entityCampaigns = input.campaignDecisions.filter((row) => row.campaign.companyEntity === entityValue);
  const entityRiskIds = new Set(input.campaignRisks.map((risk) => risk.id));
  const campaignScore = entityCampaigns.length
    ? Math.max(0, Math.round((1 - entityCampaigns.filter((row) => entityRiskIds.has(row.campaign.id)).length / entityCampaigns.length) * 100))
    : null;
  const crmCompleteness = input.crmOpportunities.length
    ? Math.round((input.crmOpportunities.filter((opportunity) => opportunity.ownerId && opportunity.nextActions.length).length / input.crmOpportunities.length) * 100)
    : 0;

  return [
    dimension("finance", "Finance", EXECUTIVE_PULSE_WEIGHTS.finance, currencies.size === 1 ? financeHealth(entityReceivables, input.snapshotDate) : null, currencies.size ? 90 : 20, currencies.size ? 90 : 20,
      currencies.size > 1 ? ["CURRENCY_CONSOLIDATION_NOT_APPROVED"] : currencies.size ? [] : ["FINANCE_DATA_MISSING"], "/admin/financiar/incasari"),
    dimension("operations", "Operațional", EXECUTIVE_PULSE_WEIGHTS.operations, null, input.operationsConfidence, input.assignmentCompleteness,
      ["OPERATIONTASK_CUTOVER_PENDING", "ASSIGNMENT_COMPLETENESS_BELOW_THRESHOLD"], "/admin/operational"),
    dimension("campaigns", "Campanii", EXECUTIVE_PULSE_WEIGHTS.campaigns, campaignScore, entityCampaigns.length ? 85 : 30, entityCampaigns.length ? 90 : 30,
      entityCampaigns.length ? ["CONTRACT_SIGNATURE_STATUS_NOT_CANONICAL", "PARTIAL_BOOKED_COVERAGE_SOURCE_MISSING"] : ["CAMPAIGN_DATA_MISSING"], "/admin/campanii"),
    dimension("sales", "Sales", EXECUTIVE_PULSE_WEIGHTS.sales, null, 40, 40,
      ["SALES_TARGET_SOURCE_MISSING", "DISCOUNT_AND_PROFITABILITY_NOT_CANONICAL"], "/admin/dashboard"),
    dimension("inventory", "Inventar", EXECUTIVE_PULSE_WEIGHTS.inventory, null, input.inventory.unknown ? 75 : 90, input.inventory.unknown ? 75 : 95,
      ["OCCUPANCY_TARGET_NOT_APPROVED"], "/admin/locatii"),
    dimension("crm", "CRM", EXECUTIVE_PULSE_WEIGHTS.crm, input.crmOpportunities.length ? crmCompleteness : null, input.crmOpportunities.length ? 80 : 30, input.crmOpportunities.length ? crmCompleteness : 30,
      input.crmOpportunities.length ? (input.crmOpenActions ? ["OVERDUE_NEXT_ACTIONS_PRESENT"] : []) : ["CRM_SAMPLE_MISSING"], "/admin/crm?view=today")
  ];
}

function dimension(
  id: ExecutivePulseDimension["id"],
  label: string,
  weight: number,
  score: number | null,
  confidence: number,
  dataCompleteness: number,
  reasonCodes: string[],
  href: string
): ExecutivePulseDimension {
  return {
    id,
    label,
    weight,
    score,
    confidence,
    dataCompleteness,
    positiveReasons: score != null && score >= 80 ? ["Indicatorii disponibili sunt în intervalul sănătos."] : [],
    negativeReasons: reasonCodes,
    reasonCodes,
    href
  };
}

function financeHealth(rows: Array<{ remainingAmount: Prisma.Decimal | null; dueDate: Date | null }>, snapshotDate: Date) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum.add(row.remainingAmount || 0), new Prisma.Decimal(0));
  if (total.lte(0)) return 100;
  const overdue = rows.filter((row) => row.dueDate && row.dueDate < snapshotDate)
    .reduce((sum, row) => sum.add(row.remainingAmount || 0), new Prisma.Decimal(0));
  return Math.max(0, Math.round(100 - overdue.div(total).mul(100).toNumber()));
}

function alertPreview(input: {
  campaignRisks: ExecutiveCampaignRisk[];
  overdueInvoices: ExecutiveMoney[];
  unassignedTasks: number;
  assignmentCompleteness: number;
  inventory: ExecutiveInventoryPartition;
}): ExecutiveFactItem[] {
  const items: ExecutiveFactItem[] = [];
  const overdueCount = input.overdueInvoices.reduce((sum, row) => sum + row.count, 0);
  if (overdueCount) items.push(fact("overdue", "Facturi restante", `${overdueCount} facturi necesită urmărire financiară.`, overdueCount, "critical", 100, "HIGH", "/admin/financiar/incasari?status=overdue"));
  if (input.campaignRisks.length) items.push(fact("campaign-risk", "Campanii în risc", `${input.campaignRisks.length} campanii au condiții deterministe de risc.`, input.campaignRisks.length, "warning", 85, "MEDIUM", "/admin/dashboard?panel=campaign-risks#campaign-risks"));
  if (input.inventory.lifecycleBookingConflicts) items.push(fact("inventory-conflict", "Conflict lifecycle / BOOKED", "Există suporturi neeligibile cu BOOKED activ.", input.inventory.lifecycleBookingConflicts, "critical", 100, "HIGH", "/admin/locatii#rezervari"));
  if (input.unassignedTasks) items.push(fact("ops-unassigned", "Calitate date operaționale", `${input.unassignedTasks} taskuri active sunt nealocate.`, input.unassignedTasks, "neutral", input.assignmentCompleteness, "LOW", "/admin/operational"));
  return items.slice(0, 6);
}

function bottleneckPreview(input: {
  campaignRisks: ExecutiveCampaignRisk[];
  overdueInvoices: ExecutiveMoney[];
  unassignedTasks: number;
  activeTasks: number;
  inventory: ExecutiveInventoryPartition;
}): ExecutiveFactItem[] {
  const missingOwners = input.campaignRisks.filter((risk) => risk.reasonCodes.includes("CAMPAIGN_OWNER_MISSING")).length;
  const missingBooked = input.campaignRisks.filter((risk) => risk.reasonCodes.includes("REQUIRED_BOOKED_MISSING")).length;
  return [
    missingOwners ? fact("missing-owner", "Ownership campanii", "Campanii active sau programate fără responsabil canonic.", missingOwners, "warning", 100, "HIGH", "/admin/dashboard?panel=campaign-risks#campaign-risks") : null,
    missingBooked ? fact("missing-booked", "Acoperire BOOKED", "Campanii fără nicio rezervare BOOKED validă.", missingBooked, "warning", 100, "HIGH", "/admin/dashboard?panel=campaign-risks#campaign-risks") : null,
    input.unassignedTasks ? fact("assignment", "Assignment operațional", `${input.unassignedTasks} din ${input.activeTasks} taskuri active sunt nealocate.`, input.unassignedTasks, "neutral", input.activeTasks ? Math.round(((input.activeTasks - input.unassignedTasks) / input.activeTasks) * 100) : 0, "LOW", "/admin/operational") : null,
    input.inventory.manualUnavailable ? fact("manual-blocks", "Capacitate blocată manual", "Suporturi active indisponibile prin override sau compatibilitate legacy.", input.inventory.manualUnavailable, "neutral", 100, "HIGH", "/admin/locatii#locatii") : null
  ].filter((item): item is ExecutiveFactItem => Boolean(item)).slice(0, 5);
}

function fact(
  id: string,
  label: string,
  detail: string,
  count: number,
  severity: ExecutiveFactItem["severity"],
  confidence: number,
  dataQuality: ExecutiveFactItem["dataQuality"],
  href: string
): ExecutiveFactItem {
  return { id, label, detail, count, severity, confidence, dataQuality, href };
}

function taskGroupCount(rows: Array<{ kind: string; _count: { _all: number } }>, kind: string) {
  return rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row._count._all, 0);
}

function riskSort(a: ExecutiveCampaignRisk, b: ExecutiveCampaignRisk) {
  const priority = { P0: 0, P1: 1, P2: 2, DATA_QUALITY: 3 };
  return priority[a.severity] - priority[b.severity] ||
    String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
    a.campaignName.localeCompare(b.campaignName);
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
