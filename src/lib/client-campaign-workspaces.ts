import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import { moneyNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import {
  activeCampaignBookingWhere,
  campaignEffectiveStatusWhere,
  deriveCampaignEffectiveStatus,
  type CampaignEffectiveStatus
} from "@/lib/campaigns/campaign-effective-status";
import {
  CAMPAIGN_COMMERCIAL_SUMMARY_SOURCE,
  deriveCampaignCommercialSummary
} from "@/lib/campaigns/campaign-commercial-summary";

export const CLIENT_CAMPAIGN_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;

export type WorkspacePage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
  query: string;
};

export type ClientListItem = {
  id: string;
  companyName: string;
  clientType: string;
  status: string;
  taxId: string | null;
  accountOwnerUserId: string | null;
  accountOwnerName: string | null;
  campaignCount: number;
  contactCount: number;
  isOwned: boolean;
  canEdit: boolean;
  updatedAt: string;
};

export type CampaignListItem = {
  id: string;
  clientId: string;
  campaignName: string;
  campaignCode: string | null;
  status: string;
  effectiveStatus: CampaignEffectiveStatus;
  clientName: string;
  companyEntity: string | null;
  sellerUserId: string | null;
  sellerName: string | null;
  accountOwnerUserId: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: "RON" | "EUR" | null;
  totalContractValue: number | null;
  totalsByCurrency: { RON: number; EUR: number };
  paymentTermType: string | null;
  paymentTermDays: number | null;
  billingRule: string | null;
  billingFrequency: string | null;
  reservationCount: number;
  canEdit: boolean;
  updatedAt: string;
};

export type ClientOverview = {
  id: string;
  companyName: string;
  normalizedName: string;
  clientType: string;
  status: string;
  taxId: string | null;
  registryNumber: string | null;
  billingAddress: string | null;
  generalEmail: string | null;
  generalPhone: string | null;
  website: string | null;
  notes: string | null;
  accountOwnerUserId: string | null;
  accountOwnerName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canViewSensitive: boolean;
};

export type CampaignOverview = {
  id: string;
  clientId: string;
  clientName: string;
  campaignName: string;
  campaignCode: string | null;
  status: string;
  effectiveStatus: CampaignEffectiveStatus;
  campaignType: string;
  companyEntity: string | null;
  sellerUserId: string | null;
  sellerName: string | null;
  accountOwnerUserId: string | null;
  accountOwnerName: string | null;
  startDate: string | null;
  endDate: string | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  effectivePeriodSource: "CAMPAIGN" | "BOOKED";
  commercialSummarySource: typeof CAMPAIGN_COMMERCIAL_SUMMARY_SOURCE;
  bookedReservationCount: number;
  currency: "RON" | "EUR" | null;
  totalContractValue: number | null;
  totalsByCurrency: { RON: number; EUR: number };
  commercialDataQualityReasons: string[];
  paymentTermType: string | null;
  paymentTermDays: number | null;
  billingRule: string | null;
  billingFrequency: string | null;
  notes: string | null;
  canEdit: boolean;
};

export type WorkspaceDocument = {
  id: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  documentType: string;
  uploadedAt: string;
  expiryDate: string | null;
  status: string;
  uploadedByName: string | null;
};

export type FinanceSummary = {
  invoicedRon: number;
  invoicedEur: number;
  collectedRon: number;
  collectedEur: number;
  remainingRon: number;
  remainingEur: number;
  overdueRon: number;
  overdueEur: number;
  openCount: number;
  rows: Array<{
    id: string;
    invoiceNumber: string | null;
    dueDate: string | null;
    currency: string;
    invoiced: number;
    collected: number;
    remaining: number;
    status: string;
  }>;
};

type PageInput = {
  query?: string;
  cursor?: string | null;
  limit?: number;
};

export const CAMPAIGN_DATE_FILTERS = [
  "STARTS_ON",
  "ENDS_ON",
  "STARTS_WITHIN_7_DAYS",
  "ENDS_WITHIN_7_DAYS"
] as const;

export type CampaignDateFilter = (typeof CAMPAIGN_DATE_FILTERS)[number];

type CampaignPageInput = PageInput & {
  clientId?: string | null;
  ownerUserId?: string | null;
  effectiveStatus?: CampaignEffectiveStatus | null;
  snapshotDate?: string | null;
  companyEntityValues?: string[];
  dateFilter?: CampaignDateFilter | null;
};

export async function getClientsPage(session: AuthSession, input: PageInput = {}): Promise<WorkspacePage<ClientListItem>> {
  const query = String(input.query || "").trim().slice(0, 120);
  const limit = safeLimit(input.limit);
  const where: Prisma.ClientAccountWhereInput = {
    status: { notIn: ["merged", "archived"] },
    ...(query ? {
      OR: [
        { companyName: { contains: query } },
        { normalizedName: { contains: normalizeClientName(query) } },
        { taxId: { contains: query } }
      ]
    } : {})
  };
  const [rows, total] = await Promise.all([
    prisma.clientAccount.findMany({
      where,
      select: {
        id: true,
        companyName: true,
        clientType: true,
        status: true,
        taxId: true,
        accountOwnerUserId: true,
        accountOwner: { select: { name: true } },
        _count: { select: { campaigns: true, contacts: true } },
        updatedAt: true
      },
      orderBy: [{ companyName: "asc" }, { id: "asc" }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit + 1
    }),
    prisma.clientAccount.count({ where })
  ]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: visible.map((row) => ({
      id: row.id,
      companyName: row.companyName,
      clientType: row.clientType,
      status: row.status,
      taxId: row.taxId,
      accountOwnerUserId: row.accountOwnerUserId,
      accountOwnerName: row.accountOwner?.name || null,
      campaignCount: row._count.campaigns,
      contactCount: row._count.contacts,
      isOwned: row.accountOwnerUserId === session.id,
      canEdit: canEditClient(session, row.accountOwnerUserId),
      updatedAt: row.updatedAt.toISOString()
    })),
    nextCursor: hasMore ? visible.at(-1)?.id || null : null,
    total,
    query
  };
}

export async function getCampaignsPage(session: AuthSession, input: CampaignPageInput = {}): Promise<WorkspacePage<CampaignListItem>> {
  const now = campaignSnapshotNow(input.snapshotDate);
  const query = String(input.query || "").trim().slice(0, 120);
  const limit = safeLimit(input.limit);
  const snapshotRange = campaignSnapshotRange(input.snapshotDate);
  const snapshotWindow = campaignSnapshotWindow(input.snapshotDate, 7);
  const where: Prisma.CampaignWhereInput = {
    AND: [
      { archivedAt: null, status: { not: "archived" } },
      ...(input.clientId ? [{ clientId: input.clientId }] : []),
      ...(input.ownerUserId ? [campaignOwnerWhere(input.ownerUserId)] : []),
      ...(input.effectiveStatus ? [campaignEffectiveStatusWhere(input.effectiveStatus, now)] : []),
      ...(input.companyEntityValues?.length ? [{ companyEntity: { in: input.companyEntityValues } }] : []),
      ...campaignDateConditions(input.dateFilter, snapshotRange, snapshotWindow, now),
      campaignReadScope(session),
      ...(query ? [{
        OR: [
          { campaignName: { contains: query } },
          { campaignCode: { contains: query } },
          { client: { companyName: { contains: query } } },
          { companyEntity: { contains: query } }
        ]
      }] : [])
    ]
  };
  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        campaignName: true,
        campaignCode: true,
        status: true,
        companyEntity: true,
        sellerUserId: true,
        accountOwnerUserId: true,
        startDate: true,
        endDate: true,
        currency: true,
        totalContractValue: true,
        paymentTermType: true,
        paymentTermDays: true,
        billingRule: true,
        billingFrequency: true,
        updatedAt: true,
        client: { select: { companyName: true, accountOwnerUserId: true } },
        sellerUser: { select: { name: true } },
        reservations: {
          where: activeCampaignBookingWhere(now),
          select: { status: true, periodStart: true, periodEnd: true },
          take: 20
        },
        _count: { select: { reservations: true } }
      },
      orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit + 1
    }),
    prisma.campaign.count({ where })
  ]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: visible.map((row) => {
      const effectiveStatus = deriveCampaignEffectiveStatus({ ...row, bookedPeriods: row.reservations }, now);
      const currency = row.currency === "RON" || row.currency === "EUR" ? row.currency : null;
      const totalContractValue = currency ? moneyNumber(row.totalContractValue) : null;
      return {
        id: row.id,
        clientId: row.clientId,
        campaignName: row.campaignName,
        campaignCode: row.campaignCode,
        status: row.status,
        effectiveStatus: effectiveStatus.effectiveStatus,
        clientName: row.client.companyName,
        companyEntity: row.companyEntity,
        sellerUserId: row.sellerUserId,
        sellerName: row.sellerUser?.name || null,
        accountOwnerUserId: row.accountOwnerUserId,
        startDate: row.startDate?.toISOString() || null,
        endDate: row.endDate?.toISOString() || null,
        currency,
        totalContractValue,
        totalsByCurrency: {
          RON: currency === "RON" ? totalContractValue || 0 : 0,
          EUR: currency === "EUR" ? totalContractValue || 0 : 0
        },
        paymentTermType: row.paymentTermType,
        paymentTermDays: row.paymentTermDays,
        billingRule: row.billingRule,
        billingFrequency: row.billingFrequency,
        reservationCount: row._count.reservations,
        canEdit: canEditCampaign(session, row),
        updatedAt: row.updatedAt.toISOString()
      };
    }),
    nextCursor: hasMore ? visible.at(-1)?.id || null : null,
    total,
    query
  };
}

function campaignSnapshotNow(snapshotDate?: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || "")
    ? new Date(`${snapshotDate}T12:00:00.000Z`)
    : new Date();
}

function campaignSnapshotRange(snapshotDate?: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || "")) return null;
  const start = new Date(`${snapshotDate}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

function campaignSnapshotWindow(snapshotDate?: string | null, days = 7) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || "")) return null;
  const start = new Date(`${snapshotDate}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + (days + 1) * 86_400_000) };
}

function campaignDateConditions(
  dateFilter: CampaignDateFilter | null | undefined,
  snapshotRange: { gte: Date; lt: Date } | null,
  snapshotWindow: { gte: Date; lt: Date } | null,
  now: Date
): Prisma.CampaignWhereInput[] {
  if (dateFilter === "STARTS_ON" && snapshotRange) return [{ startDate: snapshotRange }];
  if (dateFilter === "ENDS_ON" && snapshotRange) return [{ endDate: snapshotRange }];
  if (dateFilter === "STARTS_WITHIN_7_DAYS" && snapshotWindow) {
    return [
      { startDate: snapshotWindow },
      { OR: [campaignEffectiveStatusWhere("ACTIVE", now), campaignEffectiveStatusWhere("SCHEDULED", now)] }
    ];
  }
  if (dateFilter === "ENDS_WITHIN_7_DAYS" && snapshotWindow) {
    return [{ endDate: snapshotWindow }, campaignEffectiveStatusWhere("ACTIVE", now)];
  }
  return [];
}

function campaignOwnerWhere(ownerUserId: string): Prisma.CampaignWhereInput {
  return {
    OR: [
      { sellerUserId: ownerUserId },
      { accountOwnerUserId: ownerUserId },
      { client: { is: { accountOwnerUserId: ownerUserId } } }
    ]
  };
}

export async function getClientOverview(session: AuthSession, clientId: string): Promise<ClientOverview | null> {
  const client = await prisma.clientAccount.findUnique({
    where: { id: clientId },
    select: {
      id: true, companyName: true, normalizedName: true, clientType: true, status: true, taxId: true,
      registryNumber: true, billingAddress: true, generalEmail: true, generalPhone: true, website: true,
      notes: true, accountOwnerUserId: true, accountOwner: { select: { name: true } }, createdAt: true, updatedAt: true
    }
  });
  if (!client || ["merged", "archived"].includes(client.status)) return null;
  const canViewSensitive = canViewSensitiveClient(session, client.accountOwnerUserId);
  return {
    id: client.id,
    companyName: client.companyName,
    normalizedName: client.normalizedName || normalizeClientName(client.companyName),
    clientType: client.clientType,
    status: client.status,
    taxId: client.taxId,
    registryNumber: canViewSensitive ? client.registryNumber : null,
    billingAddress: canViewSensitive ? client.billingAddress : null,
    generalEmail: canViewSensitive ? client.generalEmail : null,
    generalPhone: canViewSensitive ? client.generalPhone : null,
    website: client.website,
    notes: canViewSensitive ? client.notes : null,
    accountOwnerUserId: client.accountOwnerUserId,
    accountOwnerName: client.accountOwner?.name || null,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    canEdit: canEditClient(session, client.accountOwnerUserId),
    canViewSensitive
  };
}

export async function getClientContacts(session: AuthSession, clientId: string) {
  await assertClientSensitiveAccess(session, clientId);
  return prisma.clientContact.findMany({
    where: { clientId },
    select: { id: true, name: true, role: true, email: true, phone: true, isPrimary: true, notes: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    take: 100
  });
}

export async function getClientDocuments(session: AuthSession, clientId: string): Promise<WorkspaceDocument[]> {
  await assertClientSensitiveAccess(session, clientId);
  const rows = await prisma.clientDocument.findMany({
    where: {
      clientId,
      status: "active",
      documentType: { not: OPERATIONAL_PROOF_DOCUMENT_TYPE },
      ...financialDocumentScope(session)
    },
    select: {
      id: true, fileName: true, fileType: true, fileSize: true, documentType: true,
      uploadedAt: true, expiryDate: true, status: true, uploadedBy: { select: { name: true } }
    },
    orderBy: { uploadedAt: "desc" },
    take: 100
  });
  return rows.map(serializeDocument);
}

export async function getClientFinanceSummary(session: AuthSession, clientId: string): Promise<FinanceSummary> {
  await assertClientSensitiveAccess(session, clientId);
  return financeSummary({ clientId });
}

export async function getClientPortfolioFinance(session: AuthSession): Promise<FinanceSummary> {
  const ownScope: Prisma.FinancialReceivableWhereInput = ["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role)
    ? { OR: [{ accountOwnerUserId: session.id }, { client: { accountOwnerUserId: session.id } }] }
    : {};
  return financeSummary(ownScope);
}

export async function getCampaignOverview(session: AuthSession, campaignId: string): Promise<CampaignOverview | null> {
  const now = new Date();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true, clientId: true, campaignName: true, campaignCode: true, status: true, campaignType: true,
      companyEntity: true, sellerUserId: true, accountOwnerUserId: true, startDate: true, endDate: true,
      currency: true, totalContractValue: true, paymentTermType: true, paymentTermDays: true,
      billingRule: true, billingFrequency: true, notes: true,
      client: { select: { companyName: true, accountOwnerUserId: true } },
      sellerUser: { select: { name: true } }, accountOwner: { select: { name: true } },
      reservations: {
        where: { status: "BOOKED" },
        select: {
          status: true,
          periodStart: true,
          periodEnd: true,
          amount: true,
          monthlyRentShare: true,
          monthlyRentTotal: true,
          contractGroupId: true,
          currency: true
        }
      }
    }
  });
  if (!campaign || campaign.status === "archived") return null;
  assertCampaignReadAccess(session, campaign);
  const commercial = deriveCampaignCommercialSummary(campaign.reservations);
  const effectiveStatus = deriveCampaignEffectiveStatus({
    ...campaign,
    startDate: commercial.periodStart,
    endDate: commercial.periodEnd,
    bookedPeriods: campaign.reservations
  }, now);
  return {
    id: campaign.id,
    clientId: campaign.clientId,
    clientName: campaign.client.companyName,
    campaignName: campaign.campaignName,
    campaignCode: campaign.campaignCode,
    status: campaign.status,
    effectiveStatus: effectiveStatus.effectiveStatus,
    campaignType: campaign.campaignType,
    companyEntity: campaign.companyEntity,
    sellerUserId: campaign.sellerUserId,
    sellerName: campaign.sellerUser?.name || null,
    accountOwnerUserId: campaign.accountOwnerUserId,
    accountOwnerName: campaign.accountOwner?.name || null,
    startDate: commercial.periodStart?.toISOString() || null,
    endDate: commercial.periodEnd?.toISOString() || null,
    effectiveStartDate: effectiveStatus.startDate,
    effectiveEndDate: effectiveStatus.endDate,
    effectivePeriodSource: effectiveStatus.periodSource,
    commercialSummarySource: commercial.source,
    bookedReservationCount: commercial.bookedReservationCount,
    currency: commercial.currency,
    totalContractValue: commercial.totalContractValue,
    totalsByCurrency: commercial.totalsByCurrency,
    commercialDataQualityReasons: commercial.dataQualityReasons,
    paymentTermType: campaign.paymentTermType,
    paymentTermDays: campaign.paymentTermDays,
    billingRule: campaign.billingRule,
    billingFrequency: campaign.billingFrequency,
    notes: campaign.notes,
    canEdit: canEditCampaign(session, campaign)
  };
}

export async function getCampaignReservations(session: AuthSession, campaignId: string) {
  await assertCampaignAccessById(session, campaignId);
  const rows = await prisma.reservation.findMany({
    where: { campaignId },
    select: {
      id: true, locationId: true, status: true, periodStart: true, periodEnd: true,
      installationDate: true, neutralizationDate: true, monthlyRentShare: true, amount: true,
      currency: true, productionNotes: true, location: { select: { code: true, city: true, address: true } }
    },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 100
  });
  return rows.map((row) => ({
    id: row.id,
    locationId: row.locationId,
    locationCode: row.location.code,
    locationName: row.location.address,
    city: row.location.city,
    status: row.status,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    installationDate: row.installationDate?.toISOString() || null,
    neutralizationDate: row.neutralizationDate?.toISOString() || null,
    monthlyRent: moneyNumber(row.monthlyRentShare ?? row.amount),
    currency: row.currency || "EUR",
    productionNotes: row.productionNotes
  }));
}

export async function getCampaignDocuments(session: AuthSession, campaignId: string): Promise<WorkspaceDocument[]> {
  await assertCampaignAccessById(session, campaignId);
  const rows = await prisma.clientDocument.findMany({
    where: {
      campaignId,
      status: "active",
      documentType: { not: OPERATIONAL_PROOF_DOCUMENT_TYPE },
      ...financialDocumentScope(session)
    },
    select: {
      id: true, fileName: true, fileType: true, fileSize: true, documentType: true,
      uploadedAt: true, expiryDate: true, status: true, uploadedBy: { select: { name: true } }
    },
    orderBy: { uploadedAt: "desc" },
    take: 100
  });
  return rows.map(serializeDocument);
}

export async function getCampaignFinanceSummary(session: AuthSession, campaignId: string): Promise<FinanceSummary> {
  await assertCampaignAccessById(session, campaignId);
  return financeSummary({ campaignId });
}

export async function getClientMergePreview(session: AuthSession, primaryClientId: string, duplicateClientId: string) {
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) throw new Error("Doar COO sau SUPER_ADMIN pot combina clienti.");
  if (!primaryClientId || !duplicateClientId || primaryClientId === duplicateClientId) throw new Error("Alege doi clienti diferiti.");
  const [primary, duplicate] = await Promise.all([
    prisma.clientAccount.findUnique({ where: { id: primaryClientId }, select: { id: true, companyName: true, _count: { select: { contacts: true, campaigns: true, reservations: true, financialReceivables: true, documents: true } } } }),
    prisma.clientAccount.findUnique({ where: { id: duplicateClientId }, select: { id: true, companyName: true, _count: { select: { contacts: true, campaigns: true, reservations: true, financialReceivables: true, documents: true } } } })
  ]);
  if (!primary || !duplicate) throw new Error("Unul dintre clienti nu exista.");
  return { primary, duplicate, warning: "Merge-ul muta relatiile catre clientul principal si arhiveaza duplicatul. Operatiunea este auditata." };
}

export function canViewSensitiveClient(session: AuthSession, accountOwnerUserId: string | null) {
  if (session.role === "SALES_AGENT") return accountOwnerUserId === session.id;
  return true;
}

function canEditClient(session: AuthSession, accountOwnerUserId: string | null) {
  if (["COO", "SUPER_ADMIN", "SALES_DIRECTOR"].includes(session.role)) return true;
  return session.role === "SALES_AGENT" && accountOwnerUserId === session.id;
}

function canEditCampaign(session: AuthSession, campaign: { sellerUserId: string | null; accountOwnerUserId: string | null; client: { accountOwnerUserId: string | null } }) {
  if (["COO", "SUPER_ADMIN", "SALES_DIRECTOR"].includes(session.role)) return true;
  return session.role === "SALES_AGENT" && [campaign.sellerUserId, campaign.accountOwnerUserId, campaign.client.accountOwnerUserId].includes(session.id);
}

function campaignReadScope(session: AuthSession): Prisma.CampaignWhereInput {
  if (session.role !== "SALES_AGENT") return {};
  return { OR: [{ sellerUserId: session.id }, { accountOwnerUserId: session.id }, { client: { accountOwnerUserId: session.id } }] };
}

function financialDocumentScope(session: AuthSession): Prisma.ClientDocumentWhereInput {
  if (session.role !== "FINANCE_OPERATOR") return {};
  return {
    OR: [
      { billingItemId: { not: null } },
      { financialReceivableId: { not: null } },
      { financialPayableId: { not: null } }
    ]
  };
}

async function assertClientSensitiveAccess(session: AuthSession, clientId: string) {
  const client = await prisma.clientAccount.findUnique({ where: { id: clientId }, select: { accountOwnerUserId: true } });
  if (!client) throw new Error("Clientul nu exista.");
  if (!canViewSensitiveClient(session, client.accountOwnerUserId)) throw new Error("Detaliile sunt disponibile doar owner-ului clientului.");
}

async function assertCampaignAccessById(session: AuthSession, campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sellerUserId: true, accountOwnerUserId: true, client: { select: { accountOwnerUserId: true } } }
  });
  if (!campaign) throw new Error("Campania nu exista.");
  assertCampaignReadAccess(session, campaign);
}

function assertCampaignReadAccess(session: AuthSession, campaign: { sellerUserId: string | null; accountOwnerUserId: string | null; client: { accountOwnerUserId: string | null } }) {
  if (session.role !== "SALES_AGENT") return;
  if (![campaign.sellerUserId, campaign.accountOwnerUserId, campaign.client.accountOwnerUserId].includes(session.id)) {
    throw new Error("Nu ai acces la aceasta campanie.");
  }
}

async function financeSummary(where: Prisma.FinancialReceivableWhereInput): Promise<FinanceSummary> {
  const now = new Date();
  const baseWhere: Prisma.FinancialReceivableWhereInput = { ...where, includedInReport: true, needsReview: false };
  const [rows, totals, overdue, openCount] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: baseWhere,
      select: { id: true, invoiceNumber: true, dueDate: true, currency: true, invoicedAmount: true, collectedAmount: true, remainingAmount: true, status: true },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 50
    }),
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: baseWhere,
      _sum: { invoicedAmount: true, collectedAmount: true, remainingAmount: true }
    }),
    prisma.financialReceivable.groupBy({
      by: ["currency"], where: { AND: [baseWhere, { remainingAmount: { gt: 0 }, dueDate: { lt: now } }] },
      _sum: { remainingAmount: true }
    }),
    prisma.financialReceivable.count({ where: { AND: [baseWhere, { remainingAmount: { gt: 0 } }] } })
  ]);
  const result: FinanceSummary = {
    invoicedRon: 0, invoicedEur: 0, collectedRon: 0, collectedEur: 0,
    remainingRon: 0, remainingEur: 0, overdueRon: 0, overdueEur: 0, openCount, rows: []
  };
  for (const row of totals) {
    if (row.currency === "EUR") {
      result.invoicedEur = moneyNumber(row._sum.invoicedAmount);
      result.collectedEur = moneyNumber(row._sum.collectedAmount);
      result.remainingEur = moneyNumber(row._sum.remainingAmount);
    } else {
      result.invoicedRon += moneyNumber(row._sum.invoicedAmount);
      result.collectedRon += moneyNumber(row._sum.collectedAmount);
      result.remainingRon += moneyNumber(row._sum.remainingAmount);
    }
  }
  for (const row of overdue) {
    if (row.currency === "EUR") result.overdueEur = moneyNumber(row._sum.remainingAmount);
    else result.overdueRon += moneyNumber(row._sum.remainingAmount);
  }
  for (const row of rows) {
    const currency = row.currency === "EUR" ? "EUR" : "RON";
    const invoiced = moneyNumber(row.invoicedAmount);
    const collected = moneyNumber(row.collectedAmount);
    const remaining = moneyNumber(row.remainingAmount);
    result.rows.push({
      id: row.id, invoiceNumber: row.invoiceNumber, dueDate: row.dueDate?.toISOString() || null,
      currency, invoiced, collected, remaining, status: row.status
    });
  }
  return result;
}

function serializeDocument(row: {
  id: string; fileName: string; fileType: string | null; fileSize: number | null; documentType: string;
  uploadedAt: Date; expiryDate: Date | null; status: string; uploadedBy: { name: string } | null;
}): WorkspaceDocument {
  return {
    id: row.id, fileName: row.fileName, fileType: row.fileType, fileSize: row.fileSize,
    documentType: row.documentType, uploadedAt: row.uploadedAt.toISOString(),
    expiryDate: row.expiryDate?.toISOString() || null, status: row.status,
    uploadedByName: row.uploadedBy?.name || null
  };
}

function safeLimit(value?: number) {
  const parsed = Number(value || CLIENT_CAMPAIGN_PAGE_SIZE);
  return Math.min(MAX_PAGE_SIZE, Math.max(10, Number.isFinite(parsed) ? Math.floor(parsed) : CLIENT_CAMPAIGN_PAGE_SIZE));
}
