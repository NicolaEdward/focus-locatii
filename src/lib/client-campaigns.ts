import type { AuthSession } from "@/lib/auth";
import { normalizeClientName, normalizeInvoiceNumber, validAccountOwners } from "@/lib/clients";
import { moneyNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export type ClientCampaignsData = {
  clients: ClientCampaignSummary[];
  campaigns: ClientCampaignRow[];
  invoices: ClientReceivableRow[];
  duplicateInvoices: DuplicateInvoiceGroup[];
  duplicateClients: DuplicateClientGroup[];
  campaignLikeClients: CampaignLikeClientIssue[];
  accountOwners: AccountOwnerOption[];
  totals: {
    clients: number;
    clientsMissingOwner: number;
    campaigns: number;
    activeCampaigns: number;
    campaignsMissingClient: number;
    campaignsMissingBilling: number;
    openReceivables: number;
    overdueReceivables: number;
    archivedReceivables: number;
    remainingRon: number;
    remainingEur: number;
  };
};

export type AccountOwnerOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ClientCampaignSummary = {
  key: string;
  clientId: string | null;
  companyName: string;
  normalizedName: string;
  clientType: string | null;
  status: string | null;
  taxId: string | null;
  registryNumber: string | null;
  billingAddress: string | null;
  generalEmail: string | null;
  generalPhone: string | null;
  website: string | null;
  accountOwnerUserId: string | null;
  accountOwnerName: string | null;
  accountOwnerEmail: string | null;
  notes: string | null;
  source: "client" | "campaign" | "financial";
  contacts: ClientContactRow[];
  documents: ClientDocumentRow[];
  campaigns: ClientCampaignRow[];
  receivables: ClientReceivableRow[];
  nextDueDate: string | null;
  nextInvoiceDate: string | null;
  latestCampaignEnd: string | null;
  remainingRon: number;
  remainingEur: number;
  overdueRon: number;
  overdueEur: number;
};

export type ClientContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
};

export type ClientDocumentRow = {
  id: string;
  clientId: string | null;
  reservationId: string | null;
  billingItemId: string | null;
  financialReceivableId: string | null;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  documentType: string;
  uploadedBy: string | null;
  uploadedAt: string;
  expiryDate: string | null;
  notes: string | null;
  status: string;
};

export type ClientCampaignRow = {
  id: string;
  clientId: string | null;
  clientKey: string;
  campaignName: string | null;
  status: string;
  clientName: string;
  clientCompany: string | null;
  contractCompany: string | null;
  locationCode: string;
  city: string | null;
  periodStart: string;
  periodEnd: string;
  sellerUserId: string | null;
  sellerName: string | null;
  amount: number;
  monthlyRentTotal: number;
  currency: string | null;
  paymentTermType: string | null;
  paymentTermDays: number | null;
  billingRule: string | null;
  billingFrequency: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  billingStatus: string | null;
  notes: string | null;
  issues: string[];
  rentalCount: number;
  accountOwnerUserId: string | null;
  rentals: ClientCampaignRentalRow[];
};

export type ClientCampaignRentalRow = {
  id: string;
  locationId: string;
  locationCode: string;
  city: string | null;
  status: string;
  periodStart: string;
  periodEnd: string;
  installationDate: string | null;
  neutralizationDate: string | null;
  monthlyRent: number;
  currency: string | null;
  productionNotes: string | null;
};

export type ClientReceivableRow = {
  id: string;
  clientId: string | null;
  billingItemId: string | null;
  companyName: string;
  invoiceNumber: string | null;
  normalizedInvoiceNumber: string | null;
  campaignDetails: string | null;
  location: string | null;
  clientName: string | null;
  dueDate: string | null;
  amount: number;
  collected: number;
  remaining: number;
  currency: string | null;
  status: string;
  collectedAt: string | null;
  paymentMethod: string | null;
  collectionNotes: string | null;
  archived: boolean;
};

export type DuplicateInvoiceGroup = {
  key: string;
  normalizedInvoiceNumber: string;
  companyName: string;
  clientName: string;
  invoices: ClientReceivableRow[];
};

export type DuplicateClientGroup = {
  normalizedName: string;
  clients: Array<{ id: string; companyName: string; accountOwnerName: string | null; campaigns: number; invoices: number }>;
};

export type CampaignLikeClientIssue = {
  clientId: string;
  companyName: string;
  reason: string;
};

type ClientGroup = ClientCampaignSummary;

export async function getClientCampaignsData(session: AuthSession, query = ""): Promise<ClientCampaignsData> {
  const search = query.trim();
  const normalizedSearch = normalizeClientName(search);
  const now = new Date();
  const canViewAll = session.role !== "SALES_AGENT";
  const activeUpload = await prisma.financialReportUpload.findFirst({
    where: { activeVersion: true, status: "confirmed" },
    select: { id: true },
    orderBy: { uploadedAt: "desc" }
  });

  const clientWhere = {
    ...(canViewAll ? { status: { notIn: ["merged", "archived"] } } : { accountOwnerUserId: session.id, status: { notIn: ["merged", "archived"] } }),
    ...(search ? {
      OR: [
        { companyName: { contains: search } },
        { normalizedName: { contains: normalizedSearch } },
        { taxId: { contains: search } },
        { generalEmail: { contains: search } },
        { generalPhone: { contains: search } },
        { contacts: { some: { OR: [{ name: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] } } }
      ]
    } : {})
  };
  const campaignWhere = {
    archivedAt: null,
    status: { not: "archived" },
    ...(canViewAll ? {} : {
      OR: [
        { sellerUserId: session.id },
        { accountOwnerUserId: session.id },
        { client: { accountOwnerUserId: session.id } }
      ]
    }),
    ...(search ? {
      AND: [{
        OR: [
          { campaignName: { contains: search } },
          { companyEntity: { contains: search } },
          { client: { companyName: { contains: search } } },
          { reservations: { some: { location: { code: { contains: search } } } } }
        ]
      }]
    } : {})
  };
  const receivableWhere = {
    includedInReport: true,
    needsReview: false,
    ...(activeUpload ? { uploadId: activeUpload.id } : {}),
    ...(canViewAll ? {} : {
      OR: [
        { accountOwnerUserId: session.id },
        { client: { accountOwnerUserId: session.id } }
      ]
    }),
    ...(search ? {
      AND: [{
        OR: [
          { clientName: { contains: search } },
          { invoiceNumber: { contains: search } },
          { normalizedInvoiceNumber: { contains: normalizeInvoiceNumber(search) } },
          { campaignDetails: { contains: search } },
          { location: { contains: search } },
          { client: { companyName: { contains: search } } }
        ]
      }]
    } : {})
  };

  const [clients, campaigns, receivables, accountOwners] = await Promise.all([
    prisma.clientAccount.findMany({
      where: clientWhere,
      include: {
        accountOwner: { select: { id: true, name: true, email: true, role: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 8 },
        documents: {
          where: { status: "active" },
          include: { uploadedBy: { select: { name: true, email: true } } },
          orderBy: { uploadedAt: "desc" },
          take: 20
        }
      },
      orderBy: { companyName: "asc" },
      take: search ? 500 : 5000
    }),
    prisma.campaign.findMany({
      where: campaignWhere,
      include: {
        client: { include: { accountOwner: { select: { id: true, name: true, email: true, role: true } } } },
        sellerUser: { select: { id: true, name: true, email: true } },
        reservations: {
          where: { status: { in: ["BOOKED", "HOLD", "RESERVED"] } },
          include: { location: { select: { code: true, city: true } } },
          orderBy: [{ periodStart: "asc" }]
        }
      },
      orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }],
      take: search ? 300 : 600
    }),
    prisma.financialReceivable.findMany({
      where: receivableWhere,
      include: { client: { include: { accountOwner: { select: { id: true, name: true, email: true, role: true } } } } },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }],
      take: search ? 300 : 800
    }),
    validAccountOwners()
  ]);

  const groups = new Map<string, ClientGroup>();

  for (const client of clients) {
    const normalizedName = normalizeClientName(client.companyName);
    groups.set(clientKey(client.id, client.companyName), {
      key: clientKey(client.id, client.companyName),
      clientId: client.id,
      companyName: client.companyName,
      normalizedName,
      clientType: client.clientType,
      status: client.status,
      taxId: client.taxId,
      registryNumber: client.registryNumber,
      billingAddress: client.billingAddress,
      generalEmail: client.generalEmail,
      generalPhone: client.generalPhone,
      website: client.website,
      accountOwnerUserId: client.accountOwnerUserId,
      accountOwnerName: client.accountOwner?.name || null,
      accountOwnerEmail: client.accountOwner?.email || null,
      notes: client.notes,
      source: "client",
      contacts: client.contacts.map(serializeContact),
      documents: client.documents.map(serializeDocument),
      campaigns: [],
      receivables: [],
      nextDueDate: null,
      nextInvoiceDate: null,
      latestCampaignEnd: null,
      remainingRon: 0,
      remainingEur: 0,
      overdueRon: 0,
      overdueEur: 0
    });
  }

  const flatCampaigns: ClientCampaignRow[] = [];
  for (const campaign of campaigns) {
    const name = campaign.client?.companyName || "Client fara nume";
    const group = ensureGroup(groups, campaign.clientId, name, {
      source: "campaign",
      accountOwnerUserId: campaign.client?.accountOwnerUserId || campaign.sellerUserId || campaign.accountOwnerUserId || null,
      accountOwnerName: campaign.client?.accountOwner?.name || campaign.sellerUser?.name || null,
      accountOwnerEmail: campaign.client?.accountOwner?.email || campaign.sellerUser?.email || null,
      status: campaign.client?.status || null,
      taxId: campaign.client?.taxId || null,
      generalEmail: campaign.client?.generalEmail || null,
      generalPhone: campaign.client?.generalPhone || null
    });
    const issues = [
      !campaign.clientId ? "Fara clientId" : null,
      campaign.paymentTermDays == null ? "Fara termen plata" : null,
      !campaign.billingRule ? "Fara regula facturare" : null,
      !campaign.reservations.length ? "Fara inchirieri" : null
    ].filter(Boolean) as string[];
    const linkedClientName = campaign.client?.companyName || null;
    const locations = campaign.reservations.map((reservation) => reservation.location.code).filter(Boolean);
    const cities = [...new Set(campaign.reservations.map((reservation) => reservation.location.city).filter(Boolean) as string[])];
    const periodStart = campaign.startDate || minDate(campaign.reservations.map((reservation) => reservation.periodStart));
    const periodEnd = campaign.endDate || maxDate(campaign.reservations.map((reservation) => reservation.periodEnd));
    const rentals = campaign.reservations.map((reservation) => ({
      id: reservation.id,
      locationId: reservation.locationId,
      locationCode: reservation.location.code,
      city: reservation.location.city,
      status: reservation.status,
      periodStart: reservation.periodStart.toISOString(),
      periodEnd: reservation.periodEnd.toISOString(),
      installationDate: reservation.installationDate?.toISOString() || null,
      neutralizationDate: reservation.neutralizationDate?.toISOString() || null,
      monthlyRent: moneyNumber(reservation.monthlyRentShare ?? reservation.amount),
      currency: reservation.currency || campaign.currency,
      productionNotes: reservation.productionNotes
    }));
    const serialized: ClientCampaignRow = {
      id: campaign.id,
      clientId: campaign.clientId,
      clientKey: group.key,
      campaignName: campaign.campaignName,
      status: campaign.status,
      clientName: linkedClientName || name,
      clientCompany: null,
      contractCompany: campaign.companyEntity,
      locationCode: locations.length ? locations.join(", ") : "-",
      city: cities.length ? cities.join(", ") : null,
      periodStart: (periodStart || campaign.createdAt).toISOString(),
      periodEnd: (periodEnd || campaign.createdAt).toISOString(),
      sellerUserId: campaign.sellerUserId,
      sellerName: campaign.sellerUser?.name || null,
      amount: moneyNumber(campaign.totalContractValue),
      monthlyRentTotal: campaign.reservations.reduce((sum, reservation) => sum + moneyNumber(reservation.monthlyRentShare ?? reservation.amount), 0),
      currency: campaign.currency || "RON",
      paymentTermType: campaign.paymentTermType,
      paymentTermDays: campaign.paymentTermDays,
      billingRule: campaign.billingRule,
      billingFrequency: campaign.billingFrequency,
      invoiceDate: null,
      dueDate: null,
      billingStatus: null,
      notes: campaign.notes,
      issues,
      rentalCount: campaign.reservations.length,
      accountOwnerUserId: campaign.accountOwnerUserId,
      rentals
    };
    group.campaigns.push(serialized);
    flatCampaigns.push(serialized);
    group.nextInvoiceDate = minIsoDate(group.nextInvoiceDate, serialized.invoiceDate);
    group.latestCampaignEnd = maxIsoDate(group.latestCampaignEnd, serialized.periodEnd);
  }

  const flatInvoices: ClientReceivableRow[] = [];
  for (const row of receivables) {
    const name = row.client?.companyName || row.clientName || "Client fara nume";
    const group = ensureGroup(groups, row.clientId, name, {
      source: "financial",
      accountOwnerUserId: row.client?.accountOwnerUserId || row.accountOwnerUserId || null,
      accountOwnerName: row.client?.accountOwner?.name || null,
      accountOwnerEmail: row.client?.accountOwner?.email || null,
      status: row.client?.status || null,
      taxId: row.client?.taxId || null,
      generalEmail: row.client?.generalEmail || null,
      generalPhone: row.client?.generalPhone || null
    });
    const remaining = moneyNumber(row.remainingAmount);
    const currency = row.currency || "RON";
    const receivable: ClientReceivableRow = {
      id: row.id,
      clientId: row.clientId,
      billingItemId: row.billingItemId,
      companyName: row.companyName,
      invoiceNumber: row.invoiceNumber,
      normalizedInvoiceNumber: row.normalizedInvoiceNumber || normalizeInvoiceNumber(row.invoiceNumber),
      campaignDetails: row.campaignDetails,
      location: row.location,
      clientName: row.clientName,
      dueDate: row.dueDate?.toISOString() || null,
      amount: moneyNumber(row.invoicedAmount),
      collected: moneyNumber(row.collectedAmount),
      remaining,
      currency,
      status: row.status,
      collectedAt: row.collectedAt?.toISOString() || null,
      paymentMethod: row.paymentMethod,
      collectionNotes: row.collectionNotes,
      archived: ["collected", "paid", "cancelled", "archived", "excluded"].includes(row.status) || remaining <= 0
    };
    group.receivables.push(receivable);
    flatInvoices.push(receivable);
    if (!receivable.archived) {
      group.nextDueDate = minIsoDate(group.nextDueDate, receivable.dueDate);
      if (currency === "EUR") group.remainingEur += remaining;
      else group.remainingRon += remaining;
      if (row.dueDate && row.dueDate < now) {
        if (currency === "EUR") group.overdueEur += remaining;
        else group.overdueRon += remaining;
      }
    }
  }

  const rows = Array.from(groups.values())
    .map((group) => ({
      ...group,
      campaigns: group.campaigns.sort((a, b) => Date.parse(b.periodEnd) - Date.parse(a.periodEnd)),
      receivables: group.receivables.sort((a, b) => Number(a.archived) - Number(b.archived) || nullableTime(a.dueDate) - nullableTime(b.dueDate))
    }))
    .filter((group) => {
      if (!normalizedSearch) return group.campaigns.length || group.receivables.length || group.source === "client";
      return [
        group.companyName,
        group.normalizedName,
        group.taxId,
        group.generalEmail,
        group.generalPhone,
        ...group.contacts.map((item) => `${item.name} ${item.email || ""} ${item.phone || ""}`),
        ...group.campaigns.map((item) => `${item.campaignName || ""} ${item.locationCode} ${item.clientName}`),
        ...group.receivables.map((item) => `${item.invoiceNumber || ""} ${item.campaignDetails || ""} ${item.location || ""}`)
      ].join(" ").toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) =>
      Number(Boolean(b.overdueRon || b.overdueEur)) - Number(Boolean(a.overdueRon || a.overdueEur)) ||
      nullableTime(a.nextDueDate) - nullableTime(b.nextDueDate) ||
      a.companyName.localeCompare(b.companyName, "ro")
    );

  const duplicateInvoices = buildDuplicateInvoices(flatInvoices);
  const duplicateClients = buildDuplicateClients(rows);
  const campaignLikeClients = rows
    .filter((client) => client.clientId && looksLikeCampaignName(client.companyName))
    .map((client) => ({
      clientId: client.clientId as string,
      companyName: client.companyName,
      reason: "Numele seamana cu o campanie/perioada, nu cu o firma."
    }));

  const openInvoices = flatInvoices.filter((invoice) => !invoice.archived);
  return {
    clients: rows,
    campaigns: flatCampaigns.sort((a, b) => Date.parse(b.periodEnd) - Date.parse(a.periodEnd)),
    invoices: flatInvoices.sort((a, b) => Number(a.archived) - Number(b.archived) || nullableTime(a.dueDate) - nullableTime(b.dueDate)),
    duplicateInvoices,
    duplicateClients,
    campaignLikeClients,
    accountOwners,
    totals: {
      clients: rows.length,
      clientsMissingOwner: rows.filter((row) => !row.accountOwnerUserId).length,
      campaigns: flatCampaigns.length,
      activeCampaigns: flatCampaigns.filter((campaign) => !["archived", "cancelled", "completed"].includes(campaign.status) && Date.parse(campaign.periodStart) <= now.getTime() && Date.parse(campaign.periodEnd) >= now.getTime()).length,
      campaignsMissingClient: flatCampaigns.filter((campaign) => !campaign.clientId).length,
      campaignsMissingBilling: flatCampaigns.filter((campaign) => campaign.issues.some((issue) => issue.includes("termen") || issue.includes("regula"))).length,
      openReceivables: openInvoices.length,
      overdueReceivables: openInvoices.filter((item) => item.status === "overdue").length,
      archivedReceivables: flatInvoices.filter((item) => item.archived).length,
      remainingRon: openInvoices.filter((item) => item.currency !== "EUR").reduce((sum, item) => sum + item.remaining, 0),
      remainingEur: openInvoices.filter((item) => item.currency === "EUR").reduce((sum, item) => sum + item.remaining, 0)
    }
  };
}

function ensureGroup(groups: Map<string, ClientGroup>, clientId: string | null, companyName: string, fallback: Partial<ClientGroup>) {
  const key = clientKey(clientId, companyName);
  const existing = groups.get(key);
  if (existing) return existing;
  const normalizedName = normalizeClientName(companyName);
  const byName = clientId ? null : Array.from(groups.values()).find((group) => group.normalizedName === normalizedName);
  if (byName) return byName;
  const group: ClientGroup = {
    key,
    clientId,
    companyName,
    normalizedName,
    clientType: fallback.clientType || null,
    status: fallback.status || null,
    taxId: fallback.taxId || null,
    registryNumber: fallback.registryNumber || null,
    billingAddress: fallback.billingAddress || null,
    generalEmail: fallback.generalEmail || null,
    generalPhone: fallback.generalPhone || null,
    website: fallback.website || null,
    accountOwnerUserId: fallback.accountOwnerUserId || null,
    accountOwnerName: fallback.accountOwnerName || null,
    accountOwnerEmail: fallback.accountOwnerEmail || null,
    notes: fallback.notes || null,
    source: fallback.source || "campaign",
    contacts: [],
    documents: [],
    campaigns: [],
    receivables: [],
    nextDueDate: null,
    nextInvoiceDate: null,
    latestCampaignEnd: null,
    remainingRon: 0,
    remainingEur: 0,
    overdueRon: 0,
    overdueEur: 0
  };
  groups.set(key, group);
  return group;
}

function buildDuplicateInvoices(invoices: ClientReceivableRow[]) {
  const groups = new Map<string, ClientReceivableRow[]>();
  for (const invoice of invoices) {
    const normalized = invoice.normalizedInvoiceNumber || normalizeInvoiceNumber(invoice.invoiceNumber);
    if (!normalized) continue;
    const key = [normalized, invoice.companyName, invoice.clientId || normalizeClientName(invoice.clientName || "")].join("|");
    groups.set(key, [...(groups.get(key) || []), invoice]);
  }
  return Array.from(groups.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      normalizedInvoiceNumber: rows[0].normalizedInvoiceNumber || normalizeInvoiceNumber(rows[0].invoiceNumber),
      companyName: rows[0].companyName,
      clientName: rows[0].clientName || "Client neclar",
      invoices: rows
    }));
}

function buildDuplicateClients(clients: ClientCampaignSummary[]) {
  const groups = new Map<string, ClientCampaignSummary[]>();
  for (const client of clients.filter((item) => item.clientId)) {
    groups.set(client.normalizedName, [...(groups.get(client.normalizedName) || []), client]);
  }
  return Array.from(groups.entries())
    .filter(([normalizedName, rows]) => Boolean(normalizedName) && rows.length > 1)
    .map(([normalizedName, rows]) => ({
      normalizedName,
      clients: rows.map((row) => ({
        id: row.clientId as string,
        companyName: row.companyName,
        accountOwnerName: row.accountOwnerName,
        campaigns: row.campaigns.length,
        invoices: row.receivables.length
      }))
    }));
}

function serializeContact(contact: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  notes: string | null;
}) {
  return {
    id: contact.id,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
    notes: contact.notes
  };
}

function serializeDocument(document: {
  id: string;
  clientId: string | null;
  reservationId: string | null;
  billingItemId: string | null;
  financialReceivableId: string | null;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  documentType: string;
  uploadedAt: Date;
  expiryDate: Date | null;
  notes: string | null;
  status: string;
  uploadedBy?: { name: string; email: string } | null;
}) {
  return {
    id: document.id,
    clientId: document.clientId,
    reservationId: document.reservationId,
    billingItemId: document.billingItemId,
    financialReceivableId: document.financialReceivableId,
    fileName: document.fileName,
    fileType: document.fileType,
    fileSize: document.fileSize,
    documentType: document.documentType,
    uploadedBy: document.uploadedBy?.name || document.uploadedBy?.email || null,
    uploadedAt: document.uploadedAt.toISOString(),
    expiryDate: document.expiryDate?.toISOString() || null,
    notes: document.notes,
    status: document.status
  };
}

function clientKey(clientId: string | null | undefined, companyName: string) {
  return clientId ? `client:${clientId}` : `name:${normalizeClientName(companyName) || "unknown"}`;
}

function minIsoDate(left: string | null, right: string | null) {
  if (!right) return left;
  if (!left) return right;
  return Date.parse(right) < Date.parse(left) ? right : left;
}

function maxIsoDate(left: string | null, right: string | null) {
  if (!right) return left;
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function nullableTime(value: string | null) {
  return value ? Date.parse(value) : Number.MAX_SAFE_INTEGER;
}

function minDate(values: Date[]) {
  return values.length ? new Date(Math.min(...values.map((value) => value.getTime()))) : null;
}

function maxDate(values: Date[]) {
  return values.length ? new Date(Math.max(...values.map((value) => value.getTime()))) : null;
}

function looksLikeCampaignName(value: string) {
  return /\b(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|vara|iarna|campanie|dn\d|20\d{2})\b/i.test(value);
}
