import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { effectiveInstallationDate } from "@/lib/installation-date";
import { effectiveNeutralizationDate } from "@/lib/neutralization-date";
import { operationStatus } from "@/lib/operation-status";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { decideAvailability } from "@/lib/availability";
import { effectiveBlockingReservationWhere, effectiveHoldExpiresAt, effectiveHoldWhere } from "@/lib/reservation-lifecycle";
import { addUtcDays, daysFromToday, decimalString, startOfUtcDay } from "@/lib/dashboard/dashboard-utils";
import { campaignEffectiveStatusWhere } from "@/lib/campaigns/campaign-effective-status";

export type DashboardMoney = { currency: string; amount: string; count: number };

export type CooAttentionItem = {
  id: string;
  kind: "finance" | "campaign" | "operation" | "hold" | "crm";
  urgency: "critical" | "high" | "medium";
  title: string;
  reason: string;
  owner: string | null;
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  href: string;
  actionLabel: string;
};

export type CooDashboardData = Awaited<ReturnType<typeof getCooDashboardData>>;

const activeOpportunityStages = ["opportunity", "quoted", "negotiation", "contracting"];

export async function getCooDashboardData(session: AuthSession, now = new Date()) {
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) throw new Error("Dashboard COO nepermis pentru acest rol.");
  const today = startOfUtcDay(now);
  const inSevenDays = addUtcDays(today, 7);
  const inThirtyDays = addUtcDays(today, 30);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const invoiceBase: Prisma.FinancialReceivableWhereInput = { includedInReport: true, needsReview: false };
  const openInvoiceBase: Prisma.FinancialReceivableWhereInput = { ...invoiceBase, remainingAmount: { gt: 0 } };

  const [
    invoiceTotals,
    overdueTotals,
    dueSoonTotals,
    overdueInvoices,
    overdueClients,
    aging0to30,
    aging31to60,
    aging61to90,
    aging90plus,
    campaigns,
    campaignCounts,
    operationalReservations,
    holdRows,
    locations,
    crmSummary
  ] = await Promise.all([
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: invoiceBase,
      _count: { _all: true }, _sum: { invoicedAmount: true, collectedAmount: true, remainingAmount: true }
    }),
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: { ...openInvoiceBase, dueDate: { lt: today } },
      _count: { _all: true }, _sum: { remainingAmount: true }
    }),
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: { ...openInvoiceBase, dueDate: { gte: today, lte: inSevenDays } },
      _count: { _all: true }, _sum: { remainingAmount: true }
    }),
    prisma.financialReceivable.findMany({
      where: { ...openInvoiceBase, dueDate: { lt: inSevenDays } },
      select: {
        id: true, invoiceNumber: true, clientId: true, clientName: true, dueDate: true, remainingAmount: true, currency: true,
        client: { select: { companyName: true, accountOwner: { select: { name: true } } } }
      },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }],
      take: 20
    }),
    prisma.financialReceivable.groupBy({
      by: ["clientId", "clientName", "currency"], where: { ...openInvoiceBase, dueDate: { lt: today } },
      _count: { _all: true }, _sum: { remainingAmount: true },
      orderBy: { _sum: { remainingAmount: "desc" } }, take: 12
    }),
    agingRows(addUtcDays(today, -30), today, openInvoiceBase),
    agingRows(addUtcDays(today, -60), addUtcDays(today, -30), openInvoiceBase),
    agingRows(addUtcDays(today, -90), addUtcDays(today, -60), openInvoiceBase),
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: { ...openInvoiceBase, dueDate: { lt: addUtcDays(today, -90) } },
      _count: { _all: true }, _sum: { remainingAmount: true }
    }),
    prisma.campaign.findMany({
      where: {
        OR: [
          campaignEffectiveStatusWhere("ACTIVE", now),
          { AND: [campaignEffectiveStatusWhere("SCHEDULED", now), { startDate: { lte: inSevenDays } }] }
        ]
      },
      select: {
        id: true, campaignName: true, startDate: true, endDate: true,
        client: { select: { companyName: true } },
        sellerUser: { select: { name: true } }, accountOwner: { select: { name: true } }
      },
      orderBy: [{ startDate: "asc" }, { endDate: "asc" }], take: 100
    }),
    Promise.all([
      prisma.campaign.count({ where: campaignEffectiveStatusWhere("ACTIVE", now) }),
      prisma.campaign.count({ where: { AND: [{ OR: [campaignEffectiveStatusWhere("ACTIVE", now), campaignEffectiveStatusWhere("SCHEDULED", now)] }, { startDate: { gte: today, lte: inSevenDays } }] } }),
      prisma.campaign.count({ where: { AND: [campaignEffectiveStatusWhere("ACTIVE", now), { endDate: { gte: today, lte: inSevenDays } }] } })
    ]),
    prisma.reservation.findMany({
      where: { status: "BOOKED", periodEnd: { gte: addUtcDays(today, -120) } },
      select: {
        id: true, campaignId: true, clientName: true, campaignName: true, periodStart: true, periodEnd: true,
        installationDate: true, neutralizationDate: true, productionNotes: true,
        sellerUser: { select: { name: true } }, location: { select: { code: true, city: true } },
        _count: { select: { documents: { where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" } } } }
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }], take: 400
    }),
    prisma.reservation.findMany({
      where: effectiveHoldWhere(now),
      select: { id: true, status: true, clientName: true, campaignName: true, periodStart: true, periodEnd: true, createdAt: true, holdExpiresAt: true, sellerUser: { select: { name: true } }, location: { select: { id: true, code: true } } },
      orderBy: { holdExpiresAt: "asc" }, take: 300
    }),
    prisma.location.findMany({
      where: { lifecycleStatus: { not: "ARCHIVED" } },
      select: {
        id: true, status: true, lifecycleStatus: true, availabilityText: true,
        availableFrom: true, availableUntil: true, bookedFrom: true, bookedUntil: true,
        blockedReason: true, blockedFrom: true, blockedUntil: true,
        mainPhotoUrl: true, images: { select: { alt: true }, take: 20 },
        reservations: {
          where: { ...effectiveBlockingReservationWhere(now), periodStart: { lte: today }, periodEnd: { gte: today } },
          select: { id: true, status: true, periodStart: true, periodEnd: true, holdExpiresAt: true, createdAt: true }
        },
        availabilityOverrides: {
          where: { clearedAt: null, periodStart: { lte: today }, OR: [{ periodEnd: null }, { periodEnd: { gte: today } }] },
          select: { id: true, type: true, reason: true, periodStart: true, periodEnd: true, clearedAt: true }
        }
      }
    }),
    Promise.all([
      prisma.crmNextAction.count({ where: { status: "open", dueAt: { lt: today } } }),
      prisma.crmNextAction.count({ where: { status: "open", dueAt: { gte: today, lt: addUtcDays(today, 1) } } }),
      prisma.crmOpportunity.count({ where: { stage: { in: activeOpportunityStages }, nextActions: { none: { status: "open" } } } }),
      prisma.crmOpportunity.count({ where: { stage: "won", wonAt: { gte: monthStart } } })
    ])
  ]);

  const finance = invoiceTotals.map((row) => {
    const currency = row.currency || "NECUNOSCUT";
    const overdue = overdueTotals.find((item) => item.currency === row.currency);
    const dueSoon = dueSoonTotals.find((item) => item.currency === row.currency);
    const remaining = new Prisma.Decimal(row._sum.remainingAmount || 0);
    const overdueAmount = new Prisma.Decimal(overdue?._sum.remainingAmount || 0);
    return {
      currency,
      invoiceCount: row._count._all,
      invoiced: decimalString(row._sum.invoicedAmount),
      collected: decimalString(row._sum.collectedAmount),
      remaining: decimalString(remaining),
      overdue: decimalString(overdueAmount),
      overdueCount: overdue?._count._all || 0,
      inTerm: decimalString(Prisma.Decimal.max(remaining.minus(overdueAmount), 0)),
      dueSoon: decimalString(dueSoon?._sum.remainingAmount),
      dueSoonCount: dueSoon?._count._all || 0
    };
  });

  const operations = operationalItems(operationalReservations, today, inThirtyDays);
  const activeHolds = holdRows
    .filter((row) => row.status === "HOLD" || row.status === "RESERVED")
    .map((row) => ({ ...row, expiresAt: effectiveHoldExpiresAt(row) }));
  const expiringHolds = activeHolds.filter((row) => row.expiresAt <= addUtcDays(now, 3));
  const inventoryDecisions = locations.map((location) => ({
    location,
    decision: decideAvailability({ ...location, periodStart: today, periodEnd: today, now })
  }));
  const occupiedIds = new Set(inventoryDecisions
    .filter(({ decision }) => decision.conflictingIntervals.some((interval) => interval.status === "BOOKED"))
    .map(({ location }) => location.id));
  const heldIds = new Set(inventoryDecisions
    .filter(({ decision }) => decision.conflictingIntervals.some((interval) => interval.status === "HOLD" || interval.status === "RESERVED"))
    .map(({ location }) => location.id));
  const blockedIds = new Set(inventoryDecisions
    .filter(({ decision }) => decision.status === "BLOCKED")
    .map(({ location }) => location.id));
  const availableCount = inventoryDecisions.filter(({ decision }) => decision.isBookable).length;
  const missingPhotoCount = locations.filter((row) => !row.mainPhotoUrl && !row.images.length).length;
  const missingSketchCount = locations.filter((row) => !row.images.some((image) => String(image.alt || "").toUpperCase().startsWith("PRODUCTION_SKETCH"))).length;

  const attention: CooAttentionItem[] = [];
  for (const row of overdueInvoices.filter((item) => item.dueDate && item.dueDate < today).slice(0, 5)) {
    attention.push({
      id: `invoice-${row.id}`, kind: "finance", urgency: daysFromToday(row.dueDate!, today) <= -30 ? "critical" : "high",
      title: `${row.client?.companyName || row.clientName || "Client"} · ${row.invoiceNumber || "Factură"}`,
      reason: `${Math.abs(daysFromToday(row.dueDate!, today))} zile întârziere`, owner: row.client?.accountOwner?.name || null,
      dueDate: row.dueDate?.toISOString() || null, amount: decimalString(row.remainingAmount), currency: row.currency,
      href: row.clientId ? `/admin/clienti?clientId=${encodeURIComponent(row.clientId)}` : "/admin/financiar/incasari?status=overdue",
      actionLabel: row.clientId ? "Vezi clientul" : "Vezi factura"
    });
  }
  for (const item of operations.delayed.slice(0, 4)) attention.push(operationAttention(item));
  for (const row of expiringHolds.slice(0, 3)) {
    attention.push({
      id: `hold-${row.id}`, kind: "hold", urgency: "high", title: `${row.location.code} · ${row.clientName}`,
      reason: "HOLD-ul expiră curând", owner: row.sellerUser?.name || null, dueDate: row.expiresAt.toISOString(), amount: null, currency: null,
      href: `/admin/locatii?reservationId=${encodeURIComponent(row.id)}#rezervari`, actionLabel: "Vezi rezervarea"
    });
  }
  const startingWithoutCompletedOperation = campaigns.filter((row) => row.startDate && row.startDate >= today && row.startDate <= inSevenDays)
    .filter((campaign) => operations.all.some((item) => item.campaignId === campaign.id && item.kind === "decoration" && item.status !== "DONE"));
  for (const row of startingWithoutCompletedOperation.slice(0, 3)) {
    attention.push({
      id: `campaign-${row.id}`, kind: "campaign", urgency: "high", title: row.campaignName,
      reason: "Campania începe în 7 zile și decorarea nu este finalizată", owner: row.sellerUser?.name || row.accountOwner?.name || null,
      dueDate: row.startDate?.toISOString() || null, amount: null, currency: null,
      href: `/admin/campanii?campaignId=${encodeURIComponent(row.id)}`, actionLabel: "Vezi campania"
    });
  }
  if (crmSummary[0] > 0) attention.push({
    id: "crm-overdue", kind: "crm", urgency: "medium", title: `${crmSummary[0]} follow-up-uri CRM restante`,
    reason: "Echipa comercială are acțiuni fără răspuns la termen", owner: null, dueDate: null, amount: null, currency: null,
    href: "/admin/crm?view=today", actionLabel: "Vezi CRM"
  });

  const decisions = [
    ...agingDecision(aging31to60, "31-60", "facturi restante între 31 și 60 de zile"),
    ...agingDecision(aging61to90, "61-90", "facturi restante între 61 și 90 de zile"),
    ...agingDecision(aging90plus, "90+", "facturi restante de peste 90 de zile"),
    ...(operations.delayed.length ? [{ id: "ops-delayed", tone: "red" as const, text: `${operations.delayed.length} lucrări operaționale sunt întârziate.`, href: "/admin/operational?panel=decorations", actionLabel: "Planifică intervenția" }] : []),
    ...(expiringHolds.length ? [{ id: "holds-expiring", tone: "yellow" as const, text: `${expiringHolds.length} HOLD-uri expiră în următoarele 3 zile.`, href: "/admin/locatii?panel=sales#rezervari", actionLabel: "Cere decizia" }] : []),
    ...(missingSketchCount ? [{ id: "missing-sketch", tone: "neutral" as const, text: `${missingSketchCount} locații nu au schiță de producție.`, href: "/admin/locatii#locatii", actionLabel: "Completează inventarul" }] : [])
  ].slice(0, 8);

  return {
    kind: "coo" as const,
    role: session.role,
    generatedAt: now.toISOString(),
    summary: {
      finance,
      campaigns: { active: campaignCounts[0], startingSoon: campaignCounts[1], endingSoon: campaignCounts[2] },
      operations: { delayed: operations.delayed.length, pendingDecorations: operations.pendingDecorations.length, pendingNeutralizations: operations.pendingNeutralizations.length },
      holds: { active: activeHolds.length, expiringSoon: expiringHolds.length },
      inventory: { total: locations.length, available: availableCount, occupied: occupiedIds.size, held: heldIds.size, blocked: blockedIds.size }
    },
    attention: attention.sort(attentionSort).slice(0, 12),
    financial: {
      currencies: finance,
      aging: [agingBucket("0-30", aging0to30), agingBucket("31-60", aging31to60), agingBucket("61-90", aging61to90), agingBucket("90+", aging90plus)],
      topOverdueClients: overdueClients.map((row) => ({
        clientId: row.clientId, clientName: row.clientName || "Client nealocat", currency: row.currency || "NECUNOSCUT",
        amount: decimalString(row._sum.remainingAmount), invoiceCount: row._count._all,
        href: row.clientId ? `/admin/clienti?clientId=${encodeURIComponent(row.clientId)}` : "/admin/financiar/incasari?status=overdue"
      }))
    },
    commercial: {
      overdueFollowUps: crmSummary[0], dueTodayFollowUps: crmSummary[1], missingNextStep: crmSummary[2], wonThisMonth: crmSummary[3],
      startingSoon: campaignRows(campaigns.filter((row) => row.startDate && row.startDate >= today && row.startDate <= inSevenDays), "startDate"),
      endingSoon: campaignRows(campaigns.filter((row) => row.endDate && row.endDate >= today && row.endDate <= inSevenDays), "endDate")
    },
    operations: {
      delayed: operations.delayed.slice(0, 10), pendingDecorations: operations.pendingDecorations.slice(0, 8), pendingNeutralizations: operations.pendingNeutralizations.slice(0, 8)
    },
    inventory: { total: locations.length, available: availableCount, occupied: occupiedIds.size, held: heldIds.size, blocked: blockedIds.size, missingPhoto: missingPhotoCount, missingSketch: missingSketchCount },
    decisions
  };
}

function agingRows(from: Date, to: Date, base: Prisma.FinancialReceivableWhereInput) {
  return prisma.financialReceivable.groupBy({
    by: ["currency"], where: { ...base, dueDate: { gte: from, lt: to } },
    _count: { _all: true }, _sum: { remainingAmount: true }
  });
}

type OperationReservation = {
  id: string;
  campaignId: string | null;
  clientName: string;
  campaignName: string | null;
  periodStart: Date;
  periodEnd: Date;
  installationDate: Date | null;
  neutralizationDate: Date | null;
  productionNotes: string | null;
  sellerUser: { name: string } | null;
  location: { code: string; city: string | null };
  _count: { documents: number };
};

function operationalItems(rows: OperationReservation[], today: Date, limitDate: Date) {
  const all = rows.flatMap((row) => {
    const decorationDate = effectiveInstallationDate(row).date;
    const neutralizationDate = effectiveNeutralizationDate(row).date;
    return ([
      operationItem(row, "decoration", decorationDate, operationStatus(row.productionNotes, "decoration"), today),
      operationItem(row, "neutralization", neutralizationDate, operationStatus(row.productionNotes, "neutralization"), today)
    ]).filter((item) => item.taskDate && (item.overdue || new Date(item.taskDate) <= limitDate));
  });
  return {
    all,
    delayed: all.filter((item) => item.overdue && item.status !== "DONE" && item.status !== "ARCHIVED").sort(taskSort),
    pendingDecorations: all.filter((item) => item.kind === "decoration" && item.status !== "DONE" && item.status !== "ARCHIVED").sort(taskSort),
    pendingNeutralizations: all.filter((item) => item.kind === "neutralization" && item.status !== "DONE" && item.status !== "ARCHIVED").sort(taskSort)
  };
}

function operationItem(row: OperationReservation, kind: "decoration" | "neutralization", taskDate: Date | null, status: string, today: Date) {
  return {
    id: `${kind}-${row.id}`, reservationId: row.id, campaignId: row.campaignId || null, kind, status,
    locationCode: row.location.code, city: row.location.city || null, clientName: row.clientName,
    campaignName: row.campaignName || null, owner: row.sellerUser?.name || null,
    taskDate: taskDate?.toISOString() || null, overdue: Boolean(taskDate && startOfUtcDay(taskDate) < today),
    proofPhotoCount: row._count?.documents || 0,
    href: `/admin/operational?panel=${kind === "decoration" ? "decorations" : "neutralizations"}&reservationId=${encodeURIComponent(row.id)}`
  };
}

function operationAttention(item: ReturnType<typeof operationItem>): CooAttentionItem {
  return {
    id: item.id, kind: "operation", urgency: "high", title: `${item.locationCode} · ${item.clientName}`,
    reason: `${item.kind === "decoration" ? "Decorare" : "Neutralizare"} întârziată`, owner: item.owner,
    dueDate: item.taskDate, amount: null, currency: null, href: item.href, actionLabel: "Vezi operațional"
  };
}

function campaignRows(rows: any[], dateField: "startDate" | "endDate") {
  return rows.slice(0, 8).map((row) => ({
    id: row.id, campaignName: row.campaignName, clientName: row.client.companyName,
    owner: row.sellerUser?.name || row.accountOwner?.name || null, date: row[dateField]?.toISOString() || null,
    href: `/admin/campanii?campaignId=${encodeURIComponent(row.id)}`
  }));
}

function agingBucket(label: string, rows: any[]) {
  return { label, values: rows.map((row) => ({ currency: row.currency || "NECUNOSCUT", amount: decimalString(row._sum.remainingAmount), count: row._count._all })) };
}

function agingDecision(rows: any[], id: string, label: string) {
  const count = rows.reduce((sum, row) => sum + row._count._all, 0);
  if (!count) return [];
  return [{ id: `aging-${id}`, tone: "red" as const, text: `${count} ${label}.`, href: "/admin/financiar/incasari?status=overdue", actionLabel: "Prioritizează încasarea" }];
}

function attentionSort(left: CooAttentionItem, right: CooAttentionItem) {
  const weight = { critical: 0, high: 1, medium: 2 };
  return weight[left.urgency] - weight[right.urgency] || String(left.dueDate || "9999").localeCompare(String(right.dueDate || "9999"));
}

function taskSort(left: { taskDate: string | null }, right: { taskDate: string | null }) {
  return String(left.taskDate || "9999").localeCompare(String(right.taskDate || "9999"));
}
