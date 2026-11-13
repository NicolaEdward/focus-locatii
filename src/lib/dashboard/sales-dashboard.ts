import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { effectiveInstallationDate } from "@/lib/installation-date";
import { effectiveNeutralizationDate } from "@/lib/neutralization-date";
import { operationStatus } from "@/lib/operation-status";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { effectiveHoldExpiresAt, effectiveHoldWhere } from "@/lib/reservation-lifecycle";
import { addUtcDays, daysFromToday, decimalString, startOfUtcDay } from "@/lib/dashboard/dashboard-utils";
import { bucharestDateKey, campaignEffectiveStatusWhere } from "@/lib/campaigns/campaign-effective-status";
import { receivableOwnershipWhere } from "@/lib/receivables-ownership";
import { getInventoryAvailabilitySummary } from "@/lib/inventory-availability-summary";
import { bucharestDayBounds, dateKeyAsStorageDate } from "@/lib/dashboard/executive/time";
import { emitStructuredLog } from "@/lib/observability";
import { sortSalesAgenda, type SalesAgendaItem } from "@/lib/dashboard/sales-agenda";

export type { SalesAgendaItem } from "@/lib/dashboard/sales-agenda";

export type SalesDashboardData = Awaited<ReturnType<typeof getSalesDashboardData>>;

export async function getSalesDashboardData(session: AuthSession, now = new Date()) {
  if (!["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role)) throw new Error("Dashboard Sales nepermis pentru acest rol.");
  const snapshotDate = bucharestDateKey(now);
  const today = dateKeyAsStorageDate(snapshotDate);
  const instantDay = bucharestDayBounds(snapshotDate);
  const tomorrow = addUtcDays(today, 1);
  const inSevenDays = addUtcDays(today, 7);
  const campaignWindowEnd = addUtcDays(today, 8);
  const renewalWindowEnd = addUtcDays(today, 61);
  const ownerId = session.id;

  const invoiceOwnership: Prisma.FinancialReceivableWhereInput = receivableOwnershipWhere(ownerId);
  const campaignOwnership: Prisma.CampaignWhereInput = {
    OR: [{ sellerUserId: ownerId }, { accountOwnerUserId: ownerId }, { client: { is: { accountOwnerUserId: ownerId } } }]
  };
  const reservationOwnership: Prisma.ReservationWhereInput = {
    OR: [{ sellerUserId: ownerId }, { ownerId }, { client: { is: { accountOwnerUserId: ownerId } } }]
  };

  const [actions, invoices, campaigns, operations, holds, summaryCounts, inventory] = await Promise.all([
    prisma.crmNextAction.findMany({
      where: { ownerId, status: "open", dueAt: { lte: inSevenDays } },
      select: {
        id: true, type: true, description: true, dueAt: true, priority: true, prospectId: true, opportunityId: true,
        company: { select: { name: true } },
        prospect: { select: { id: true } }, opportunity: { select: { id: true, name: true } }
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }], take: 500
    }),
    prisma.financialReceivable.findMany({
      where: { includedInReport: true, needsReview: false, remainingAmount: { gt: 0 }, ...invoiceOwnership, dueDate: { lte: inSevenDays } },
      select: {
        id: true, invoiceNumber: true, dueDate: true, remainingAmount: true, currency: true, status: true, clientId: true,
        client: { select: { companyName: true } }, clientName: true
      },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }, { id: "asc" }], take: 500
    }),
    prisma.campaign.findMany({
      where: {
        AND: [
          campaignOwnership,
          { OR: [campaignEffectiveStatusWhere("ACTIVE", now), campaignEffectiveStatusWhere("SCHEDULED", now)] },
          {
            OR: [
              { startDate: { lt: campaignWindowEnd }, endDate: { gte: today } },
              { endDate: { gte: today, lt: renewalWindowEnd } }
            ]
          }
        ]
      },
      select: { id: true, campaignName: true, startDate: true, endDate: true, client: { select: { companyName: true } } },
      orderBy: [{ endDate: "asc" }, { id: "asc" }], take: 500
    }),
    prisma.reservation.findMany({
      where: { status: "BOOKED", ...reservationOwnership, periodEnd: { gte: addUtcDays(today, -90) } },
      select: {
        id: true, campaignId: true, clientName: true, campaignName: true, periodStart: true, periodEnd: true,
        installationDate: true, neutralizationDate: true, productionNotes: true, location: { select: { code: true } },
        _count: { select: { documents: { where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" } } } }
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { id: "asc" }], take: 500
    }),
    prisma.reservation.findMany({
      where: { AND: [effectiveHoldWhere(now), reservationOwnership] },
      select: { id: true, status: true, clientName: true, campaignName: true, holdExpiresAt: true, createdAt: true, location: { select: { code: true } } },
      orderBy: [{ holdExpiresAt: "asc" }, { id: "asc" }], take: 500
    }),
    Promise.all([
      prisma.crmNextAction.count({ where: { ownerId, status: "open", dueAt: { lt: instantDay.start } } }),
      prisma.crmNextAction.count({ where: { ownerId, status: "open", dueAt: { gte: instantDay.start, lt: instantDay.endExclusive } } }),
      prisma.financialReceivable.count({ where: { includedInReport: true, needsReview: false, remainingAmount: { gt: 0 }, dueDate: { lt: today }, ...invoiceOwnership } }),
      prisma.financialReceivable.count({ where: { includedInReport: true, needsReview: false, remainingAmount: { gt: 0 }, dueDate: { gte: today, lte: inSevenDays }, ...invoiceOwnership } }),
      prisma.campaign.count({ where: { AND: [campaignOwnership, { OR: [campaignEffectiveStatusWhere("ACTIVE", now), campaignEffectiveStatusWhere("SCHEDULED", now)] }, { startDate: { gte: today, lt: campaignWindowEnd } }] } }),
      prisma.campaign.count({ where: { AND: [campaignOwnership, campaignEffectiveStatusWhere("ACTIVE", now), { endDate: { gte: today, lt: campaignWindowEnd } }] } })
    ]),
    getInventoryAvailabilitySummary({ now }).catch(() => {
      emitStructuredLog("error", "sales_inventory_snapshot_failed", { route: "/admin/dashboard", operation: "inventory_snapshot", role: session.role });
      return null;
    })
  ]);

  const operationalItems = operations.flatMap((row) => {
    const decorationDate = effectiveInstallationDate(row).date;
    const neutralizationDate = effectiveNeutralizationDate(row).date;
    return [
      salesOperation(row, "decoration", decorationDate, today),
      salesOperation(row, "neutralization", neutralizationDate, today)
    ].filter((item) => item.status !== "DONE" && item.status !== "ARCHIVED" && item.dueDate && (item.overdue || new Date(item.dueDate) <= inSevenDays));
  }).sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));

  const agenda: SalesAgendaItem[] = [
    ...invoices.map((row): SalesAgendaItem => {
      const days = row.dueDate ? daysFromToday(row.dueDate, today) : 999;
      return {
        id: `invoice-${row.id}`, kind: "invoice", urgency: days < 0 ? "critical" : days === 0 ? "high" : "medium",
        title: row.client?.companyName || row.clientName || "Client", context: `${row.invoiceNumber || "Factură"} · ${days < 0 ? `${Math.abs(days)} zile întârziere` : days === 0 ? "scadentă azi" : `scadentă în ${days} zile`}`,
        dueDate: row.dueDate?.toISOString() || null, amount: decimalString(row.remainingAmount), currency: row.currency,
        href: row.clientId ? `/admin/clienti?clientId=${encodeURIComponent(row.clientId)}` : "/admin/clienti?tab=invoices",
        actionLabel: row.clientId ? "Vezi clientul" : "Vezi facturile"
      };
    }),
    ...actions.map((row): SalesAgendaItem => ({
      id: `follow-${row.id}`, kind: "follow_up", urgency: row.dueAt < instantDay.start ? "critical" : row.dueAt < instantDay.endExclusive ? "high" : "normal",
      title: row.company.name, context: row.description || row.opportunity?.name || `Follow-up ${row.type}`,
      dueDate: row.dueAt.toISOString(), amount: null, currency: null,
      href: row.opportunityId
        ? `/admin/crm?view=today&kind=opportunity&record=${encodeURIComponent(row.opportunityId)}`
        : row.prospect?.id
          ? `/admin/crm?view=today&kind=prospect&record=${encodeURIComponent(row.prospect.id)}`
          : "/admin/crm?view=today",
      actionLabel: "Notează follow-up"
    })),
    ...campaigns.flatMap((row): SalesAgendaItem[] => {
      const items: SalesAgendaItem[] = [];
      if (row.startDate && row.startDate >= today && row.startDate < campaignWindowEnd) items.push({
        id: `campaign-start-${row.id}`, kind: "campaign_start", urgency: "medium", title: row.client.companyName,
        context: `${row.campaignName} începe curând`, dueDate: row.startDate.toISOString(), amount: null, currency: null,
        href: `/admin/campanii?campaignId=${encodeURIComponent(row.id)}`, actionLabel: "Vezi campania"
      });
      if (row.endDate && row.endDate >= today && row.endDate < renewalWindowEnd) items.push({
        id: `campaign-end-${row.id}`, kind: "campaign_end", urgency: row.endDate < campaignWindowEnd ? "high" : "normal", title: row.client.companyName,
        context: `${row.campaignName} · pregătește reînnoirea; final în ${daysFromToday(row.endDate, today)} zile`, dueDate: row.endDate.toISOString(), amount: null, currency: null,
        href: `/admin/campanii?campaignId=${encodeURIComponent(row.id)}`, actionLabel: "Pregătește reînnoirea"
      });
      return items;
    }),
    ...operationalItems.map((row): SalesAgendaItem => ({
      id: row.id, kind: "operation", urgency: row.overdue ? "high" : "medium", title: `${row.locationCode} · ${row.clientName}`,
      context: `${row.kind === "decoration" ? "Decorare" : "Neutralizare"} ${row.overdue ? "întârziată" : "programată"}`,
      dueDate: row.dueDate, amount: null, currency: null, href: row.href, actionLabel: "Vezi operațional"
    })),
    ...holds.map((row): SalesAgendaItem => {
      const expires = effectiveHoldExpiresAt(row);
      const remaining = expires.getTime() - now.getTime();
      return {
        id: `hold-${row.id}`, kind: "hold", urgency: remaining <= 2 * 3_600_000 ? "critical" : remaining <= 86_400_000 ? "high" : "medium",
        title: `${row.location.code} · ${row.clientName}`, context: `${row.campaignName || "Rezervare temporară"} · HOLD expiră ${expires.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
        dueDate: expires.toISOString(), amount: null, currency: null,
        href: `/admin/locatii?reservationId=${encodeURIComponent(row.id)}#rezervari`, actionLabel: "Verifică HOLD-ul",
      };
    }),
  ].sort(sortSalesAgenda);

  const invoiceRows = invoices.map((row) => ({
    id: row.id, clientId: row.clientId, clientName: row.client?.companyName || row.clientName || "Client",
    invoiceNumber: row.invoiceNumber || "Fără număr", amount: decimalString(row.remainingAmount), currency: row.currency || "",
    dueDate: row.dueDate?.toISOString() || null, daysUntilDue: row.dueDate ? daysFromToday(row.dueDate, today) : null,
    status: row.dueDate && row.dueDate < today ? "overdue" : "due_soon",
    href: row.clientId ? `/admin/clienti?clientId=${encodeURIComponent(row.clientId)}` : "/admin/clienti?tab=invoices"
  }));
  const startingCampaigns = campaigns.filter((row) => row.startDate && row.startDate >= today && row.startDate < campaignWindowEnd);
  const endingCampaigns = campaigns.filter((row) => row.endDate && row.endDate >= today && row.endDate < campaignWindowEnd);

  return {
    kind: "sales" as const,
    role: session.role,
    userName: session.name,
    generatedAt: now.toISOString(),
    inventory,
    agendaCoverage: {
      cappedSources: [actions.length >= 500 ? "follow-up-uri" : null, invoices.length >= 500 ? "facturi" : null,
        campaigns.length >= 500 ? "campanii" : null, operations.length >= 500 ? "lucrări" : null,
        holds.length >= 500 ? "HOLD-uri" : null].filter((value): value is string => Boolean(value)),
    },
    links: {
      campaignsStarting: campaignDrillDownHref("STARTS_WITHIN_7_DAYS", snapshotDate, ownerId, summaryCounts[4], startingCampaigns),
      campaignsEnding: campaignDrillDownHref("ENDS_WITHIN_7_DAYS", snapshotDate, ownerId, summaryCounts[5], endingCampaigns)
    },
    summary: {
      followUpsDue: summaryCounts[0] + summaryCounts[1], overdueFollowUps: summaryCounts[0],
      overdueInvoices: summaryCounts[2], dueSoonInvoices: summaryCounts[3],
      campaignsStarting: summaryCounts[4], campaignsEnding: summaryCounts[5],
      operationalProblems: operationalItems.filter((row) => row.overdue).length
    },
    agenda,
    invoices: invoiceRows.slice(0, 12),
    followUps: actions.slice(0, 10).map((row) => ({
      id: row.id, companyName: row.company.name, description: row.description || row.opportunity?.name || row.type,
      dueDate: row.dueAt.toISOString(), overdue: row.dueAt < instantDay.start,
      href: row.opportunityId ? `/admin/crm?view=today&kind=opportunity&record=${encodeURIComponent(row.opportunityId)}` : "/admin/crm?view=today"
    })),
    campaigns: campaigns.slice(0, 12).map((row) => ({
      id: row.id, campaignName: row.campaignName, clientName: row.client.companyName,
      startDate: row.startDate?.toISOString() || null, endDate: row.endDate?.toISOString() || null,
      href: `/admin/campanii?campaignId=${encodeURIComponent(row.id)}`
    })),
    operations: operationalItems.slice(0, 10),
    holds: holds.filter((row) => row.status === "HOLD" || row.status === "RESERVED").map((row) => ({
      id: row.id, locationCode: row.location.code, clientName: row.clientName, campaignName: row.campaignName,
      expiresAt: effectiveHoldExpiresAt(row).toISOString(),
      href: `/admin/locatii?reservationId=${encodeURIComponent(row.id)}#rezervari`
    })).slice(0, 8)
  };
}

function campaignDrillDownHref(
  dateFilter: "STARTS_WITHIN_7_DAYS" | "ENDS_WITHIN_7_DAYS",
  snapshotDate: string,
  ownerUserId: string,
  count: number,
  rows: Array<{ id: string }>
) {
  if (count === 1 && rows[0]) return `/admin/campanii?campaignId=${encodeURIComponent(rows[0].id)}`;
  const params = new URLSearchParams({ dateFilter, snapshot: snapshotDate, owner: ownerUserId });
  return `/admin/campanii?${params}`;
}

function salesOperation(row: any, kind: "decoration" | "neutralization", date: Date | null, today: Date) {
  return {
    id: `${kind}-${row.id}`, reservationId: row.id, campaignId: row.campaignId || null, kind,
    status: operationStatus(row.productionNotes, kind), locationCode: row.location.code,
    clientName: row.clientName, campaignName: row.campaignName || null, dueDate: date?.toISOString() || null,
    proofPhotoCount: row._count.documents,
    overdue: Boolean(date && startOfUtcDay(date) < today),
    href: `/admin/operational?panel=${kind === "decoration" ? "decorations" : "neutralizations"}&reservationId=${encodeURIComponent(row.id)}`
  };
}

