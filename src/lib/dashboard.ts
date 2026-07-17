import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";
import { calculateProrata } from "@/lib/prorata";
import { isOperationActive, operationExtraTasks, operationStatus, type OperationKind, type OperationStatus } from "@/lib/operation-status";
import { DECORATION_LOOKAHEAD_DAYS, NEUTRALIZATION_LOOKAHEAD_DAYS, OPERATION_HISTORY_DAYS } from "@/lib/operation-schedule";
import { hasAnyPermission, hasPermission } from "@/lib/rbac";
import { parseOfferRequestMeta } from "@/lib/offer-request-meta";
import { getFinancialDashboardData } from "@/lib/financial-dashboard";
import { sortOperationalLocations } from "@/lib/location-order";
import { calculateLocationProfit } from "@/lib/profit";
import { getCrmTeamDashboardData } from "@/lib/crm-dashboard";
import { crmCurrentOpportunityValue, crmNextActionLabel } from "@/lib/crm-domain";
import { effectiveInstallationDate, hasMissingInstallationSchedule } from "@/lib/installation-date";
import { effectiveNeutralizationDate, hasMissingNeutralizationSchedule } from "@/lib/neutralization-date";
import { HOLD_DURATION_DAYS } from "@/lib/reservation-lifecycle";
import {
  listOperationalTasksWithFallback,
  operationTaskReadsEnabled,
  reportOperationTaskReadComparison
} from "@/lib/operation-task-read-adapter";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  canViewOperationalProofPhoto,
  isOperationalProofActive,
  operationalProofDownloadPath,
  parseOperationalProofNotes
} from "@/lib/operational-proof";
import {
  hasSellerReportActivity,
  normalizeSellerName,
  reportableLooseSellerName,
  reportableSellerName
} from "@/lib/seller-reporting";

type CampaignRow = {
  id: string;
  campaignId: string | null;
  clientId: string | null;
  status: string;
  clientName: string;
  clientCompany: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  campaignName: string | null;
  salesperson: string | null;
  sellerUserId: string | null;
  sellerUser: { id: string; name: string; email: string; role: string } | null;
  amount: number | null;
  monthlyRentShare: number | null;
  monthlyRentTotal: number | null;
  contractGroupId: string | null;
  periodStart: Date;
  periodEnd: Date;
  installationDate: Date | null;
  neutralizationDate: Date | null;
  productionNotes: string | null;
  bookedAt: Date | null;
  holdExpiresAt: Date | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  contractCompany: string | null;
  currency: string | null;
  paymentTermType: string | null;
  paymentTermDays: number | null;
  billingRule: string | null;
  billingFrequency: string | null;
  nextInvoiceDate: Date | null;
  location: {
    id: string;
    code: string;
    city: string | null;
    county: string | null;
    address: string | null;
    type: string | null;
    size: string | null;
    sqm: number | null;
    isPremium: boolean;
    monthlyCost: number | null;
    costCurrency: string | null;
  };
  documents?: Array<{
    id: string;
    fileName: string | null;
    fileType: string | null;
    uploadedAt: Date;
    expiryDate: Date | null;
    notes: string | null;
    status: string;
    uploadedBy: { name: string | null } | null;
  }>;
};

type LocationRow = {
  id: string;
  code: string;
  city: string | null;
  county: string | null;
  type: string | null;
  size: string | null;
  sqm: number | null;
  address: string | null;
  status: string;
  lifecycleStatus: "ACTIVE" | "INACTIVE" | "ARCHIVED" | "MAINTENANCE";
  isPremium: boolean;
  showInPublic: boolean;
  reportingGroupName: string | null;
  displayOrder: number | null;
  locationGroupOrder: number | null;
  faceOrder: number | null;
  directionOrder: number | null;
  blockedReason: string | null;
  blockedByUserId: string | null;
  blockedFrom: Date | null;
  blockedUntil: Date | null;
  blockedNotes: string | null;
};

type OfferRequestRow = {
  id: string;
  status: string;
  clientName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  selectedLocationIds: unknown;
  selectedCodes: string | null;
  source: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

type CrmLeadRow = {
  id: string;
  leadDate: Date | null;
  companyName: string;
  opportunityName: string | null;
  clientType: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  status: string;
  estimatedValue: number | null;
  currency: string | null;
  probability: number | null;
  expectedCloseDate: Date | null;
  nextFollowUpDate: Date | null;
  nextStep: string | null;
  locationsInterested: string | null;
  notes: string | null;
  lostReason: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedTo: { name: string; email: string } | null;
};

async function listDashboardCrmRows(session: AuthSession): Promise<CrmLeadRow[]> {
  const ownerWhere = session.role === "SALES_AGENT" ? { ownerId: session.id } : {};
  const [prospects, opportunities] = await Promise.all([
    prisma.crmProspect.findMany({
      where: ownerWhere,
      select: {
        id: true, source: true, ownerId: true, createdByUserId: true, status: true, createdAt: true, updatedAt: true,
        company: { select: { name: true, contacts: { where: { isPrimary: true }, select: { name: true, phone: true, email: true }, take: 1 } } },
        owner: { select: { name: true, email: true } },
        nextActions: { where: { status: "open" }, select: { type: true, description: true, dueAt: true }, orderBy: { dueAt: "asc" }, take: 1 }
      },
      orderBy: { updatedAt: "desc" },
      take: 150
    }),
    prisma.crmOpportunity.findMany({
      where: ownerWhere,
      select: {
        id: true, name: true, needSummary: true, geography: true, formats: true, ownerId: true, createdByUserId: true, stage: true,
        currency: true, quotedValue: true, revisedValue: true, agreedValue: true, decisionDate: true, lostReason: true, createdAt: true, updatedAt: true,
        company: { select: { name: true, contacts: { where: { isPrimary: true }, select: { name: true, phone: true, email: true }, take: 1 } } },
        owner: { select: { name: true, email: true } },
        nextActions: { where: { status: "open" }, select: { type: true, description: true, dueAt: true }, orderBy: { dueAt: "asc" }, take: 1 }
      },
      orderBy: { updatedAt: "desc" },
      take: 150
    })
  ]);
  const prospectRows: CrmLeadRow[] = prospects.map((row) => {
    const contact = row.company.contacts[0];
    const action = row.nextActions[0];
    return {
      id: row.id, leadDate: row.createdAt, companyName: row.company.name, opportunityName: null, clientType: null,
      contactName: contact?.name || null, phone: contact?.phone || null, email: contact?.email || null, source: row.source,
      assignedToUserId: row.ownerId, createdByUserId: row.createdByUserId, status: row.status, estimatedValue: null, currency: null,
      probability: null, expectedCloseDate: null, nextFollowUpDate: action?.dueAt || null,
      nextStep: action ? crmNextActionLabel(action.type, action.description) : null, locationsInterested: null, notes: null, lostReason: null,
      lastActivityAt: row.updatedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, assignedTo: row.owner
    };
  });
  const opportunityRows: CrmLeadRow[] = opportunities.map((row) => {
    const contact = row.company.contacts[0];
    const action = row.nextActions[0];
    return {
      id: row.id, leadDate: row.createdAt, companyName: row.company.name, opportunityName: row.name, clientType: null,
      contactName: contact?.name || null, phone: contact?.phone || null, email: contact?.email || null, source: null,
      assignedToUserId: row.ownerId, createdByUserId: row.createdByUserId, status: row.stage,
      estimatedValue: crmCurrentOpportunityValue(row), currency: row.currency, probability: null, expectedCloseDate: row.decisionDate,
      nextFollowUpDate: action?.dueAt || null, nextStep: action ? crmNextActionLabel(action.type, action.description) : null,
      locationsInterested: [row.geography, row.formats].filter(Boolean).join(" / ") || null, notes: row.needSummary, lostReason: row.lostReason,
      lastActivityAt: row.updatedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, assignedTo: row.owner
    };
  });
  return [...prospectRows, ...opportunityRows].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).slice(0, 300);
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData(session: AuthSession) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const decorationWindowEnd = new Date(now.getTime() + DECORATION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const neutralizationWindowEnd = new Date(now.getTime() + NEUTRALIZATION_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const operationWindowStart = new Date(now.getTime() - OPERATION_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const financeOnly = session.role === "FINANCE_OPERATOR";
  const ownWhere =
    session.role === "SALES_AGENT"
      ? { OR: [{ sellerUserId: session.id }, { ownerId: session.id }, { ownerId: null, salesperson: { in: [session.name, session.email] } }] }
      : {};

  const financePromise = hasPermission(session.role, "finance.view") ? getFinancialDashboardData() : Promise.resolve(null);
  const canReadCrm = hasAnyPermission(session.role, ["leads.view", "leads.view.own"]);
  const crmTeamPromise = ["COO", "SUPER_ADMIN"].includes(session.role)
    ? getCrmTeamDashboardData(now)
    : Promise.resolve(null);
  const [locations, campaigns, operationCampaigns, offerRequests, users, auditLogs, crmRows, finance, crmTeam] = await Promise.all([
    financeOnly
      ? Promise.resolve([]) as Promise<LocationRow[]>
      : prisma.location.findMany({
          where: { lifecycleStatus: { not: "ARCHIVED" } },
          select: {
            id: true,
            code: true,
            city: true,
            county: true,
            address: true,
            type: true,
            size: true,
            sqm: true,
            status: true,
            lifecycleStatus: true,
            isPremium: true,
            showInPublic: true,
            reportingGroupName: true,
            displayOrder: true,
            locationGroupOrder: true,
            faceOrder: true,
            directionOrder: true,
            blockedReason: true,
            blockedByUserId: true,
            blockedFrom: true,
            blockedUntil: true,
            blockedNotes: true
          }
        }) as Promise<LocationRow[]>,
    financeOnly
      ? Promise.resolve([]) as Promise<CampaignRow[]>
      : prisma.reservation.findMany({
          where: ownWhere,
          include: {
            sellerUser: { select: { id: true, name: true, email: true, role: true } },
            location: {
              select: {
                id: true,
                code: true,
                city: true,
                county: true,
                address: true,
                type: true,
                size: true,
                sqm: true,
                isPremium: true,
                monthlyCost: true,
                costCurrency: true
              }
            }
          },
          orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }],
          take: 1000
        }) as Promise<CampaignRow[]>,
    prisma.reservation.findMany({
      where: {
        status: "BOOKED",
        OR: [
          { installationDate: { gte: operationWindowStart, lte: decorationWindowEnd } },
          { neutralizationDate: { gte: operationWindowStart, lte: neutralizationWindowEnd } },
          { installationDate: null, periodStart: { gte: operationWindowStart, lte: decorationWindowEnd } },
          { neutralizationDate: null, periodEnd: { gte: operationWindowStart, lte: neutralizationWindowEnd } }
        ]
      },
      include: {
        documents: {
          where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" },
          orderBy: { uploadedAt: "desc" },
          take: 40,
          select: {
            id: true,
            fileName: true,
            fileType: true,
            uploadedAt: true,
            expiryDate: true,
            notes: true,
            status: true,
            uploadedBy: { select: { name: true } }
          }
        },
        sellerUser: { select: { id: true, name: true, email: true, role: true } },
        location: {
          select: {
            id: true,
            code: true,
            city: true,
            county: true,
            address: true,
            type: true,
            size: true,
            sqm: true,
            isPremium: true,
            monthlyCost: true,
            costCurrency: true
          }
        }
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "desc" }],
      take: 1000
    }) as Promise<CampaignRow[]>,
    financeOnly
      ? Promise.resolve([]) as Promise<OfferRequestRow[]>
      : prisma.offerRequest.findMany({
          where:
            session.role === "SALES_AGENT"
              ? { OR: [{ ownerId: session.id }, { ownerId: null }] }
              : {},
          orderBy: { createdAt: "desc" },
          take: 300
        }) as Promise<OfferRequestRow[]>,
    hasPermission(session.role, "users.manage")
      ? prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true } })
      : Promise.resolve([]) as Promise<UserRow[]>,
    ["SUPER_ADMIN", "COO"].includes(session.role)
      ? prisma.auditLog.findMany({
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 12
        })
      : Promise.resolve([]),
    financeOnly || !canReadCrm
      ? Promise.resolve([]) as Promise<CrmLeadRow[]>
      : listDashboardCrmRows(session),
    financePromise,
    crmTeamPromise
  ]);

  const active = campaigns.filter((item) => item.status === "BOOKED" && item.periodStart <= now && item.periodEnd >= now);
  const future = campaigns
    .filter((item) => item.status === "BOOKED" && item.periodStart > now)
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  const completed = campaigns.filter((item) => item.status === "BOOKED" && item.periodEnd < now);
  const cancelled = campaigns.filter((item) => item.status === "CANCELLED");
  const holds = campaigns.filter((item) => ["HOLD", "RESERVED"].includes(item.status) && holdIsActive(item, now));
  const expiredHolds = campaigns
    .filter((item) => item.status === "EXPIRED" || (["HOLD", "RESERVED"].includes(item.status) && !holdIsActive(item, now)))
    .sort((a, b) => (b.holdExpiresAt || b.updatedAt).getTime() - (a.holdExpiresAt || a.updatedAt).getTime());
  const inventoryIds = new Set(locations.map((location) => location.id));
  const occupiedIds = new Set(active.filter((item) => inventoryIds.has(item.location.id)).map((item) => item.location.id));
  const heldIds = new Set(holds
    .filter((item) => inventoryIds.has(item.location.id) && item.periodStart <= now && item.periodEnd >= now)
    .map((item) => item.location.id));
  const blockedLocations = locations
    .filter((location) => location.lifecycleStatus !== "ACTIVE" || isLocationBlocked(location, now))
    .sort(sortOperationalLocations);
  const blockedIds = new Set(blockedLocations.map((location) => location.id));
  const availableLocations = locations
    .filter((location) => !occupiedIds.has(location.id) && !heldIds.has(location.id) && !blockedIds.has(location.id))
    .sort(sortOperationalLocations);
  const atRisk = campaigns.filter((item) => {
    if (item.status !== "BOOKED" || item.periodStart < now || item.periodStart > inSevenDays) return false;
    return operationStatus(item.productionNotes, "decoration") !== "DONE";
  });
  const conflicts = findConflicts(campaigns, now);
  const endingSoon = active
    .filter((item) => item.periodEnd <= inThirtyDays)
    .sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime());
  const startingSoon = future.filter((item) => item.periodStart <= inThirtyDays);
  const missingInstallations = campaigns.filter(
    (item) => item.status === "BOOKED" && item.periodStart <= inThirtyDays && hasMissingInstallationSchedule(item)
  );
  const missingNeutralizations = campaigns.filter((item) => item.status === "BOOKED" && hasMissingNeutralizationSchedule(item));
  const monthlySales = campaigns.filter(
    (item) => item.status === "BOOKED" && item.periodStart <= monthEnd && item.periodEnd >= monthStart
  );
  const confirmedRevenue = roundMoney(
    monthlySales.reduce((sum, item) => sum + recognizedMonthlyRevenue(item, monthStart, monthEnd), 0)
  );
  const offerPipeline = countBy(offerRequests, (item) => item.status);
  const agentPerformance = groupPerformance(monthlySales, reportableSellerName, monthStart, monthEnd);
  const cityPerformance = groupPerformance(monthlySales, (item) => item.location.city || "Fara oras", monthStart, monthEnd);
  const topClients = groupPerformance(monthlySales, (item) => item.clientName || "Fara client", monthStart, monthEnd);
  const legacyDecorationTasks = operationTasks(operationCampaigns, "decoration", now, operationWindowStart, decorationWindowEnd, session);
  const legacyNeutralizationTasks = operationTasks(operationCampaigns, "neutralization", now, operationWindowStart, neutralizationWindowEnd, session);
  const operationTaskReadResult = operationTaskReadsEnabled()
    ? await listOperationalTasksWithFallback({
        reservations: operationCampaigns,
        now,
        windowStart: operationWindowStart,
        decorationWindowEnd,
        neutralizationWindowEnd
      })
    : null;
  if (operationTaskReadResult) reportOperationTaskReadComparison(operationTaskReadResult.comparison);
  const decorationTasks = operationTaskReadResult
    ? operationTaskReadResult.active.filter((task) => task.kind === "decoration").map(withoutDashboardProofPhotos)
    : legacyDecorationTasks;
  const neutralizationTasks = operationTaskReadResult
    ? operationTaskReadResult.active.filter((task) => task.kind === "neutralization").map(withoutDashboardProofPhotos)
    : legacyNeutralizationTasks;
  const overdueTasks = [...decorationTasks, ...neutralizationTasks].filter((task) => task.overdue);
  const operations = {
    decorations: decorationTasks.length,
    neutralizations: neutralizationTasks.length,
    overdue: overdueTasks.length
  };
  const sellers = sellerActivity(users, offerRequests, crmRows, campaigns, monthlySales, now, monthStart, monthEnd);
  const crmLeads = [
    ...crmRows.map(serializeRealCrmLead),
    ...offerRequests
    .filter((item) => item.status !== "ARCHIVED")
    .slice(0, Math.max(0, 40 - crmRows.length))
    .map((item) => serializeCrmLead(item, campaigns))
  ].slice(0, 60);
  const inventoryByCity = inventoryBreakdown(locations, active, holds, now, (location) => location.city || "Fara oras");
  const inventoryByType = inventoryBreakdown(locations, active, holds, now, (location) => location.type || "Fara tip");
  const activeCampaignGroups = serializeCampaignGroups(active);
  const startingSoonGroups = serializeCampaignGroups(startingSoon);
  const endingSoonGroups = serializeCampaignGroups(endingSoon);
  const structuredProblems = buildProblemCenter({
    conflicts,
    missingInstallations,
    missingNeutralizations,
    overdueTasks,
    blockedLocations,
    crmLeads,
    campaigns,
    finance,
    now,
    lastThirtyDays
  });

  return {
    generatedAt: now.toISOString(),
    role: session.role,
    monthLabel: new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" }).format(now),
    totals: {
      locations: locations.length,
      occupied: occupiedIds.size,
      held: heldIds.size,
      available: availableLocations.length,
      occupancyPercent: locations.length ? Math.round((occupiedIds.size / locations.length) * 100) : 0,
      active: active.length,
      future: future.length,
      completed: completed.length,
      cancelled: cancelled.length,
      atRisk: atRisk.length,
      conflicts: conflicts.length,
      expiredHolds: expiredHolds.length,
      blocked: blockedLocations.length,
      decorations: decorationTasks.length,
      neutralizations: neutralizationTasks.length,
      overdueTasks: overdueTasks.length,
      confirmedRevenue,
      openLeads: offerRequests.filter((item) => ["NEW", "CONTACTED", "QUOTED"].includes(item.status)).length,
      pendingApprovals: holds.length,
      users: users.length,
      activeUsers: users.filter((item) => item.active).length
    },
    offerPipeline,
    agentPerformance: agentPerformance.slice(0, 8),
    cityPerformance: cityPerformance.slice(0, 8),
    topClients: topClients.slice(0, 6),
    operations,
    alerts: [
      ...(conflicts.length ? [{ tone: "red" as const, label: `${conflicts.length} conflicte de perioada necesita verificare` }] : []),
      ...(atRisk.length ? [{ tone: "yellow" as const, label: `${atRisk.length} campanii pornesc in 7 zile fara decorare finalizata` }] : []),
      ...(overdueTasks.length ? [{ tone: "yellow" as const, label: `${overdueTasks.length} taskuri operationale intarziate` }] : []),
      ...(holds.length ? [{ tone: "blue" as const, label: `${holds.length} hold-uri active asteapta decizie` }] : []),
      ...(finance && !finance.todayReportLoaded ? [{ tone: "yellow" as const, label: "Raportul financiar de azi nu a fost incarcat." }] : [])
    ],
    recentCampaigns: campaigns.slice(0, 8).map(serializeCampaign),
    upcomingCampaigns: future.slice(0, 8).map(serializeCampaign),
    coo: {
      health: {
        activeCampaigns: activeCampaignGroups.length,
        startingSoon: startingSoonGroups.length,
        endingSoon: endingSoonGroups.length,
        availableLocations: availableLocations.length,
        occupiedLocations: occupiedIds.size,
        heldLocations: heldIds.size,
        blockedLocations: blockedLocations.length,
        issues: structuredProblems.length
      },
      problems: structuredProblems,
      conflicts: conflicts.slice(0, 20).map(([first, second]) => serializeConflict(first, second)),
      holds: holds.slice(0, 30).map(serializeCampaign),
      expiredHolds: expiredHolds.slice(0, 20).map(serializeCampaign),
      activeCampaigns: activeCampaignGroups.slice(0, 30),
      startingSoon: startingSoonGroups.slice(0, 30),
      endingSoon: endingSoonGroups.slice(0, 30),
      availableLocations: availableLocations.slice(0, 20).map(serializeLocation),
      occupiedLocations: active.slice(0, 20).map(serializeCampaign),
      blockedLocations: blockedLocations.slice(0, 20).map(serializeLocation),
      missingInstallations: missingInstallations.slice(0, 20).map(serializeCampaign),
      missingNeutralizations: missingNeutralizations.slice(0, 20).map(serializeCampaign),
      decorationTasks: decorationTasks.slice(0, 100),
      neutralizationTasks: neutralizationTasks.slice(0, 100),
      overdueTasks: overdueTasks.slice(0, 100),
      ...(operationTaskReadResult ? { operationTaskReadComparison: operationTaskReadResult.comparison } : {}),
      sellers,
      crmLeads,
      crmTeam,
      inventoryByCity,
      inventoryByType,
      approvalQueue: holds.slice(0, 20).map(serializeCampaign),
      reports: {
        availabilityUrl: "/api/admin/availability/excel",
        salesUrl: "/api/admin/sales-report/excel",
        billingUrl: "/api/admin/financial/export"
      }
    },
    auditLogs: auditLogs.map((item) => ({
      id: item.id,
      action: item.action,
      entityType: item.entityType,
      actor: item.user?.name || item.user?.email || "Sistem",
      createdAt: item.createdAt.toISOString()
    })),
    usersByRole: countBy(users.filter((item) => item.active), (item) => item.role),
    finance
  };
}

function serializeCampaign(item: CampaignRow) {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const amount = item.amount ?? item.monthlyRentShare ?? item.monthlyRentTotal ?? 0;
  const profit = calculateLocationProfit({
    monthlyRevenue: amount,
    revenueCurrency: "EUR",
    monthlyCost: item.location.monthlyCost,
    costCurrency: item.location.costCurrency,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    reportStart: monthStart,
    reportEnd: monthEnd
  });
  const daysRemaining = Math.ceil((item.periodEnd.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000));
  const installation = effectiveInstallationDate(item);
  const neutralization = item.status === "BOOKED"
    ? effectiveNeutralizationDate(item)
    : { date: item.neutralizationDate, source: item.neutralizationDate ? "neutralizationDate" as const : null };
  return {
    id: item.id,
    campaignId: item.campaignId,
    reservationId: item.id,
    clientId: item.clientId,
    locationId: item.location.id,
    code: item.location.code,
    city: item.location.city,
    county: item.location.county,
    type: item.location.type,
    size: item.location.size,
    sqm: item.location.sqm,
    address: item.location.address,
    clientName: item.clientName,
    clientCompany: item.clientCompany,
    contractCompany: item.contractCompany,
    campaignName: item.campaignName,
    salesperson: sellerName(item),
    sellerUserId: item.sellerUserId,
    status: item.status,
    amount,
    currency: item.currency || "EUR",
    paymentTermType: item.paymentTermType,
    paymentTermDays: item.paymentTermDays,
    billingRule: item.billingRule,
    billingFrequency: item.billingFrequency,
    nextInvoiceDate: item.nextInvoiceDate?.toISOString() || null,
    revenue: profit.revenue,
    revenueCurrency: profit.revenueCurrency,
    cost: profit.cost,
    costCurrency: profit.costCurrency,
    grossProfit: profit.grossProfit,
    grossMargin: profit.grossMargin,
    costStatus: profit.costStatus,
    contractGroupId: item.contractGroupId,
    periodStart: item.periodStart.toISOString(),
    periodEnd: item.periodEnd.toISOString(),
    installationDate: installation.date?.toISOString() || null,
    installationDateSource: installation.source,
    neutralizationDate: neutralization.date?.toISOString() || null,
    neutralizationDateSource: neutralization.source,
    holdExpiresAt: item.holdExpiresAt?.toISOString() || null,
    bookedAt: item.bookedAt?.toISOString() || item.createdAt.toISOString(),
    daysRemaining
  };
}

function serializeCampaignGroups(items: CampaignRow[]) {
  const groups = new Map<string, CampaignRow[]>();
  for (const item of items) {
    const key = item.campaignId
      ? `campaign:${item.campaignId}`
      : item.contractGroupId
        ? `contract:${item.contractGroupId}`
        : `reservation:${item.id}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.values()]
    .map(serializeCampaignGroup)
    .sort((a, b) => Date.parse(a.periodStart) - Date.parse(b.periodStart) || String(a.clientName || "").localeCompare(String(b.clientName || ""), "ro"));
}

function serializeCampaignGroup(items: CampaignRow[]) {
  const sorted = [...items].sort((a, b) => a.location.code.localeCompare(b.location.code, "ro"));
  const base = sorted[0];
  const rows = sorted.map(serializeCampaign);
  const periodStart = earliestDate(sorted.map((item) => item.periodStart)) || base.periodStart;
  const periodEnd = latestDate(sorted.map((item) => item.periodEnd)) || base.periodEnd;
  const amount = roundMoney(rows.reduce((sum, item) => sum + (item.amount || 0), 0));
  const revenue = roundMoney(rows.reduce((sum, item) => sum + (item.revenue || 0), 0));
  const sameCostCurrency = rows.every((item) => item.costCurrency === rows[0]?.costCurrency);
  const cost = sameCostCurrency ? roundMoney(rows.reduce((sum, item) => sum + (item.cost || 0), 0)) : 0;
  const grossProfit = sameCostCurrency ? roundMoney(revenue - cost) : null;

  return {
    ...rows[0],
    id: base.campaignId ? `campaign:${base.campaignId}` : rows[0].id,
    reservationId: rows[0].reservationId,
    reservationIds: rows.map((item) => item.reservationId),
    campaignId: base.campaignId,
    code: `${rows.length} locatii`,
    amount,
    revenue,
    cost,
    grossProfit,
    grossMargin: revenue && grossProfit != null ? Math.round((grossProfit / revenue) * 100) : null,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    daysRemaining: Math.ceil((periodEnd.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)),
    locationCount: rows.length,
    locations: rows.map((item) => ({
      reservationId: item.reservationId,
      locationId: item.locationId,
      code: item.code,
      city: item.city,
      county: item.county,
      type: item.type,
      size: item.size,
      address: item.address,
      amount: item.amount,
      currency: item.currency,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      status: item.status
    }))
  };
}

function serializeLocation(item: LocationRow) {
  return {
    id: item.id,
    code: item.code,
    city: item.city,
    county: item.county,
    address: item.address,
    type: item.type,
    size: item.size,
    sqm: item.sqm,
    status: item.status,
    lifecycleStatus: item.lifecycleStatus,
    isPremium: item.isPremium,
    reportingGroupName: item.reportingGroupName,
    blockedReason: item.blockedReason,
    blockedByUserId: item.blockedByUserId,
    blockedFrom: item.blockedFrom?.toISOString() || null,
    blockedUntil: item.blockedUntil?.toISOString() || null,
    blockedNotes: item.blockedNotes
  };
}

function serializeConflict(first: CampaignRow, second: CampaignRow) {
  return {
    id: `${first.id}:${second.id}`,
    locationCode: first.location.code,
    city: first.location.city,
    reservations: [serializeCampaign(first), serializeCampaign(second)],
    overlapStart: maxDate(first.periodStart, second.periodStart).toISOString(),
    overlapEnd: minDate(first.periodEnd, second.periodEnd).toISOString()
  };
}

function operationTasks(items: CampaignRow[], kind: OperationKind, now: Date, windowStart: Date, windowEnd: Date, viewer: AuthSession) {
  return items
    .filter((item) => item.status === "BOOKED")
    .flatMap((item) => {
      const taskDate = kind === "decoration" ? item.installationDate || item.periodStart : item.neutralizationDate || item.periodEnd;
      const status = operationStatus(item.productionNotes, kind);
      const baseTask = {
        id: `${kind}-${item.id}`,
        reservationId: item.id,
        taskId: null as string | null,
        kind,
        status,
        taskDate: taskDate.toISOString(),
        overdue: isOperationActive(status) && taskDate < now,
        note: null as string | null,
        code: item.location.code,
        city: item.location.city,
        clientName: item.clientName,
        campaignName: item.campaignName,
        salesperson: sellerName(item),
        periodStart: item.periodStart.toISOString(),
        periodEnd: item.periodEnd.toISOString(),
        proofPhotos: operationalDashboardProofPhotos(item, kind, null, viewer)
      };
      const extraTasks = operationExtraTasks(item.productionNotes, kind).map((task) => ({
        ...baseTask,
        id: `${kind}-${item.id}-${task.id}`,
        taskId: task.id,
        status: task.status,
        taskDate: task.taskDate,
        overdue: isOperationActive(task.status) && new Date(task.taskDate) < now,
        note: task.note || null,
        proofPhotos: operationalDashboardProofPhotos(item, kind, task.id, viewer)
      }));
      return [baseTask, ...extraTasks];
    })
    .filter((item) => {
      const taskDate = new Date(item.taskDate);
      return isOperationActive(item.status as OperationStatus) && taskDate >= windowStart && taskDate <= windowEnd;
    })
    .sort((a, b) => new Date(a.taskDate).getTime() - new Date(b.taskDate).getTime());
}

function operationalDashboardProofPhotos(item: CampaignRow, kind: OperationKind, taskId: string | null, viewer: AuthSession) {
  if (!canViewOperationalProofPhoto(viewer, {
    status: item.status as never,
    ownerId: item.ownerId,
    sellerUserId: item.sellerUserId,
    salesperson: item.salesperson
  })) return [];
  return (item.documents || [])
    .filter((document) => {
      if (!isOperationalProofActive(document)) return false;
      const notes = parseOperationalProofNotes(document.notes);
      return notes?.kind === kind && (notes.taskId || null) === (taskId || null);
    })
    .map((document) => ({
      id: document.id,
      fileName: document.fileName || "poza-dovada",
      uploadedAt: document.uploadedAt.toISOString(),
      expiryDate: document.expiryDate?.toISOString() || null,
      uploadedBy: document.uploadedBy?.name || "Utilizator",
      downloadUrl: operationalProofDownloadPath(document.id)
    }))
    .slice(0, 10);
}

function withoutDashboardProofPhotos<T extends object>(task: T) {
  return { ...task, proofPhotos: [] as Array<never> };
}

function serializeCrmLead(request: OfferRequestRow, campaigns: CampaignRow[]) {
  const meta = parseOfferRequestMeta(request.source);
  const relatedCodes = new Set(String(request.selectedCodes || "").split(",").map((code) => code.trim()).filter(Boolean));
  const relatedCampaigns = campaigns
    .filter((campaign) => relatedCodes.has(campaign.location.code) || campaign.clientName === request.clientName || campaign.clientCompany === request.company)
    .slice(0, 4)
    .map(serializeCampaign);
  return {
    id: request.id,
    sourceKind: "request" as const,
    clientName: request.clientName,
    company: request.company,
    email: request.email,
    phone: request.phone,
    salesperson: meta.salesperson || "Nealocat",
    status: request.status,
    crmStatus: normalizeCrmStatus(meta.crmStatus) || statusToCrmStatus(request.status),
    estimatedValue: meta.estimatedValue ?? relatedCampaigns.reduce((sum, campaign) => sum + campaign.amount, 0),
    nextFollowUpAt: meta.nextFollowUpAt,
    notes: meta.notes,
    lastActivityAt: meta.lastActivityAt || request.updatedAt.toISOString(),
    selectedCodes: request.selectedCodes,
    message: request.message,
    relatedCampaigns,
    createdAt: request.createdAt.toISOString()
  };
}

function serializeRealCrmLead(lead: CrmLeadRow) {
  return {
    id: lead.id,
    sourceKind: "crm" as const,
    assignedToUserId: lead.assignedToUserId,
    leadDate: lead.leadDate?.toISOString() || null,
    clientType: lead.clientType,
    clientName: lead.contactName || lead.companyName,
    company: lead.companyName,
    email: lead.email,
    phone: lead.phone,
    salesperson: lead.assignedTo?.name || "Nealocat",
    status: dbCrmStatusToUi(lead.status),
    crmStatus: dbCrmStatusToUi(lead.status),
    estimatedValue: lead.estimatedValue || 0,
    currency: lead.currency || "EUR",
    probability: lead.probability,
    expectedCloseDate: lead.expectedCloseDate?.toISOString() || null,
    nextFollowUpAt: lead.nextFollowUpDate?.toISOString() || null,
    locationsInterested: lead.locationsInterested,
    notes: lead.nextStep || lead.notes,
    lastActivityAt: (lead.lastActivityAt || lead.updatedAt).toISOString(),
    selectedCodes: null,
    message: lead.opportunityName || lead.lostReason || lead.source,
    relatedCampaigns: [],
    createdAt: lead.createdAt.toISOString()
  };
}

function buildProblemCenter(input: {
  conflicts: Array<[CampaignRow, CampaignRow]>;
  missingInstallations: CampaignRow[];
  missingNeutralizations: CampaignRow[];
  overdueTasks: ReturnType<typeof operationTasks>;
  blockedLocations: LocationRow[];
  crmLeads: Array<{
    id: string;
    company?: string | null;
    crmStatus: string;
    nextFollowUpAt?: string | null;
    assignedToUserId?: string | null;
  }>;
  campaigns: CampaignRow[];
  finance: Awaited<ReturnType<typeof getFinancialDashboardData>> | null;
  now: Date;
  lastThirtyDays: Date;
}) {
  const problems: Array<{
    id: string;
    module: "Operational" | "Vanzari" | "Financiar" | "CRM" | "Inventar" | "Date incomplete";
    type: string;
    title: string;
    plainLanguageDescription: string;
    entityType: string;
    entityId: string;
    severity: "low" | "medium" | "high" | "critical";
    ownerUserId: string | null;
    dueDate: string | null;
    recommendedAction: string;
    status: "open" | "in_progress" | "resolved" | "ignored";
  }> = [];

  input.conflicts.forEach(([first, second]) => problems.push({
    id: `conflict-${first.id}-${second.id}`,
    module: "Operational",
    type: "reservation_conflict",
    title: `Suprapunere pe locatia ${first.location.code}`,
    plainLanguageDescription: `${first.clientName} si ${second.clientName} se suprapun pe aceeasi locatie.`,
    entityType: "reservation",
    entityId: first.id,
    severity: "critical",
    ownerUserId: first.sellerUserId || second.sellerUserId,
    dueDate: first.periodStart.toISOString(),
    recommendedAction: "Verifica perioadele si corecteaza manual una dintre inchirieri.",
    status: "open"
  }));

  input.missingInstallations.forEach((campaign) => problems.push({
    id: `missing-install-${campaign.id}`,
    module: "Operational",
    type: "missing_installation_schedule",
    title: `Campanie fara data valida de montaj: ${campaign.clientName}`,
    plainLanguageDescription: `Campania ${campaign.campaignName || campaign.location.code} nu are nici data de montaj, nici data valida de start.`,
    entityType: "reservation",
    entityId: campaign.id,
    severity: "medium",
    ownerUserId: campaign.sellerUserId || campaign.ownerId,
    dueDate: null,
    recommendedAction: "Corecteaza data de start sau seteaza explicit data de montaj.",
    status: "open"
  }));

  input.missingNeutralizations.forEach((campaign) => problems.push({
    id: `missing-neutral-${campaign.id}`,
    module: "Operational",
    type: "missing_neutralization_schedule",
    title: `Campanie fara data valida de neutralizare: ${campaign.clientName}`,
    plainLanguageDescription: `Campania ${campaign.campaignName || campaign.location.code} nu are nici data de neutralizare, nici data valida de final.`,
    entityType: "reservation",
    entityId: campaign.id,
    severity: "medium",
    ownerUserId: campaign.sellerUserId || campaign.ownerId,
    dueDate: null,
    recommendedAction: "Corecteaza data de final sau seteaza explicit data de neutralizare.",
    status: "open"
  }));

  input.overdueTasks.forEach((task) => problems.push({
    id: `overdue-operation-${task.id}`,
    module: "Operational",
    type: "overdue_operation",
    title: `Lucrare intarziata: ${task.code}`,
    plainLanguageDescription: `${task.kind === "decoration" ? "Decorarea" : "Neutralizarea"} pentru ${task.clientName} nu este finalizata la termen.`,
    entityType: "reservation",
    entityId: task.reservationId,
    severity: "high",
    ownerUserId: null,
    dueDate: task.taskDate,
    recommendedAction: "Verifica responsabilul si actualizeaza starea lucrarii.",
    status: "open"
  }));

  input.blockedLocations.forEach((location) => {
    problems.push({
        id: `blocked-location-${location.id}`,
        module: "Inventar",
        type: "blocked_location",
        title: `Locatie blocata: ${location.code}`,
        plainLanguageDescription: location.blockedReason || `Status inventar: ${location.lifecycleStatus}.`,
        entityType: "location",
        entityId: location.id,
        severity: "medium",
        ownerUserId: location.blockedByUserId,
        dueDate: location.blockedUntil?.toISOString() || null,
        recommendedAction: "Verifica motivul blocarii si deblocheaza locatia daca poate fi vanduta.",
        status: "open"
      });
  });

  input.campaigns.filter((campaign) => campaign.status === "BOOKED").forEach((campaign) => {
    if (!campaign.clientId) problems.push(incompleteProblem(campaign, "missing_client", "Inchiriere fara clientId", "Leaga inchirierea de un Client Account."));
    if (!campaign.paymentTermDays && campaign.paymentTermDays !== 0) problems.push(incompleteProblem(campaign, "missing_payment_term", "Inchiriere fara termen de plata", "Completeaza termenul de plata."));
    if (!campaign.billingRule) problems.push(incompleteProblem(campaign, "missing_billing_rule", "Inchiriere fara regula de facturare", "Completeaza regula de facturare."));
  });

  input.crmLeads.filter((lead) => {
    if (!lead.nextFollowUpAt) return true;
    return new Date(lead.nextFollowUpAt) < input.now && !["WON", "LOST", "INACTIVE"].includes(lead.crmStatus);
  }).slice(0, 30).forEach((lead) => problems.push({
    id: `crm-followup-${lead.id}`,
    module: "CRM",
    type: "crm_followup_missing",
    title: `Lead fara follow-up: ${lead.company || "fara companie"}`,
    plainLanguageDescription: `Lead-ul nu are follow-up setat sau follow-up-ul este depasit.`,
    entityType: "crm_lead",
    entityId: lead.id,
    severity: "medium",
    ownerUserId: lead.assignedToUserId || null,
    dueDate: lead.nextFollowUpAt || null,
    recommendedAction: "Adauga activitate si seteaza urmatorul follow-up.",
    status: "open"
  }));

  input.finance?.lists.overdueReceivables.forEach((row) => problems.push({
    id: `finance-receivable-${row.id}`,
    module: "Financiar",
    type: "receivable_overdue",
    title: `Client depasit: ${row.name}`,
    plainLanguageDescription: `${row.name} are rest de incasat ${row.remaining} ${row.currency || ""}.`,
    entityType: "financial_receivable",
    entityId: row.id,
    severity: "high",
    ownerUserId: null,
    dueDate: row.dueDate,
    recommendedAction: "Notifica account owner-ul si seteaza follow-up.",
    status: "open"
  }));

  return problems.slice(0, 120);
}

function incompleteProblem(campaign: CampaignRow, type: string, title: string, action: string) {
  return {
    id: `${type}-${campaign.id}`,
    module: "Date incomplete" as const,
    type,
    title,
    plainLanguageDescription: `${campaign.clientName} / ${campaign.location.code} are date comerciale incomplete.`,
    entityType: "reservation",
    entityId: campaign.id,
    severity: "medium" as const,
    ownerUserId: campaign.sellerUserId || campaign.ownerId,
    dueDate: campaign.periodStart.toISOString(),
    recommendedAction: action,
    status: "open" as const
  };
}

function sellerActivity(
  users: UserRow[],
  requests: OfferRequestRow[],
  crmRows: CrmLeadRow[],
  campaigns: CampaignRow[],
  monthlySales: CampaignRow[],
  now: Date,
  monthStart: Date,
  monthEnd: Date
) {
  const sellerNames = new Set<string>();
  const excludedUserNames = new Set(
    users
      .filter((user) => !user.active || !["SALES_AGENT", "SALES_DIRECTOR", "COO"].includes(user.role))
      .map((user) => normalizeSellerName(user.name))
  );
  users
    .filter((user) => user.active && ["SALES_AGENT", "SALES_DIRECTOR", "COO"].includes(user.role))
    .forEach((user) => sellerNames.add(user.name));
  requests.forEach((request) => {
    const seller = reportableLooseSellerName(parseOfferRequestMeta(request.source).salesperson, excludedUserNames);
    if (seller) sellerNames.add(seller);
  });
  campaigns.forEach((campaign) => {
    const seller = reportableSellerName(campaign);
    if (seller) sellerNames.add(seller);
  });
  crmRows.forEach((lead) => {
    const seller = reportableLooseSellerName(lead.assignedTo?.name, excludedUserNames);
    if (seller) sellerNames.add(seller);
  });

  return [...sellerNames].sort((a, b) => a.localeCompare(b, "ro")).map((seller) => {
    const sellerRequests = requests.filter(
      (request) => reportableLooseSellerName(parseOfferRequestMeta(request.source).salesperson, excludedUserNames) === seller
    );
    const sellerCrmRows = crmRows.filter(
      (lead) => reportableLooseSellerName(lead.assignedTo?.name, excludedUserNames) === seller
    );
    const sellerCampaigns = campaigns.filter((campaign) => reportableSellerName(campaign) === seller);
    const sellerSales = monthlySales.filter((campaign) => reportableSellerName(campaign) === seller);
    const activeHolds = sellerCampaigns.filter((campaign) => ["HOLD", "RESERVED"].includes(campaign.status) && holdIsActive(campaign, now));
    const expiredHolds = sellerCampaigns.filter((campaign) => campaign.status === "EXPIRED");
    const confirmed = sellerCampaigns.filter((campaign) => campaign.status === "BOOKED");
    const openLeads = sellerRequests.filter((request) => ["NEW", "CONTACTED", "QUOTED"].includes(request.status));
    const openCrmLeads = sellerCrmRows.filter((lead) => !["WON", "LOST", "INACTIVE"].includes(dbCrmStatusToUi(lead.status)));
    const wonLeads = sellerRequests.filter((request) => request.status === "WON").length + sellerCrmRows.filter((lead) => dbCrmStatusToUi(lead.status) === "WON").length;
    const lostLeads = sellerRequests.filter((request) => request.status === "LOST").length + sellerCrmRows.filter((lead) => dbCrmStatusToUi(lead.status) === "LOST").length;
    const pipelineValue =
      openLeads.reduce((sum, request) => sum + (parseOfferRequestMeta(request.source).estimatedValue || 0), 0) +
      openCrmLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0) +
      activeHolds.reduce((sum, campaign) => sum + (campaign.amount ?? campaign.monthlyRentShare ?? 0), 0);
    const soldValue = sellerSales.reduce(
      (sum, campaign) => sum + recognizedMonthlyRevenue(campaign, monthStart, monthEnd),
      0
    );
    const overdueFollowUps = sellerRequests.filter((request) => {
      const followUp = parseOfferRequestMeta(request.source).nextFollowUpAt;
      return followUp ? new Date(followUp) < now && !["WON", "LOST", "ARCHIVED"].includes(request.status) : false;
    }).length + sellerCrmRows.filter((lead) => lead.nextFollowUpDate && lead.nextFollowUpDate < now && !["WON", "LOST", "INACTIVE"].includes(dbCrmStatusToUi(lead.status))).length;
    return {
      seller,
      activeLeads: openLeads.length + openCrmLeads.length,
      receivedRequests: sellerRequests.length,
      reservationsCreated: uniqueCampaignCount(sellerCampaigns.filter((campaign) => ["HOLD", "RESERVED"].includes(campaign.status))),
      activeHolds: activeHolds.length,
      expiredHolds: expiredHolds.length,
      confirmedCampaigns: uniqueCampaignCount(confirmed),
      soldValue: roundMoney(soldValue),
      pipelineValue: roundMoney(pipelineValue),
      overdueFollowUps,
      conversionRate: wonLeads + lostLeads ? Math.round((wonLeads / (wonLeads + lostLeads)) * 100) : null,
      latestActivityAt: latestDate([
        ...sellerRequests.map((request) => request.updatedAt),
        ...sellerCrmRows.map((lead) => lead.updatedAt),
        ...sellerCampaigns.map((campaign) => campaign.updatedAt)
      ])?.toISOString() || null
    };
  }).filter(hasSellerReportActivity);
}

function inventoryBreakdown(
  locations: LocationRow[],
  active: CampaignRow[],
  holds: CampaignRow[],
  now: Date,
  key: (location: LocationRow) => string
) {
  const occupied = new Set(active.map((item) => item.location.id));
  const held = new Set(holds.filter((item) => item.periodStart <= now && item.periodEnd >= now).map((item) => item.location.id));
  const groups = new Map<string, { label: string; total: number; available: number; occupied: number; held: number; blocked: number; premium: number }>();
  for (const location of locations) {
    const label = key(location);
    const current = groups.get(label) || { label, total: 0, available: 0, occupied: 0, held: 0, blocked: 0, premium: 0 };
    current.total += 1;
    if (occupied.has(location.id)) current.occupied += 1;
    else if (held.has(location.id)) current.held += 1;
    else if (location.lifecycleStatus !== "ACTIVE" || isLocationBlocked(location, now)) current.blocked += 1;
    else current.available += 1;
    if (location.isPremium) current.premium += 1;
    groups.set(label, current);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "ro"));
}

function uniqueCampaignCount(items: CampaignRow[]) {
  return new Set(items.map((item) => item.campaignId || item.contractGroupId || item.id)).size;
}

function holdIsActive(item: Pick<CampaignRow, "holdExpiresAt" | "createdAt">, now: Date) {
  if (item.holdExpiresAt) return item.holdExpiresAt > now;
  const legacyCutoff = new Date(now);
  legacyCutoff.setUTCDate(legacyCutoff.getUTCDate() - HOLD_DURATION_DAYS);
  return item.createdAt > legacyCutoff;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const value = key(item);
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function groupPerformance(
  items: CampaignRow[],
  key: (item: CampaignRow) => string | null,
  monthStart: Date,
  monthEnd: Date
) {
  const groups = new Map<string, { label: string; campaignIds: Set<string>; revenue: number }>();
  for (const item of items) {
    const label = key(item);
    if (!label) continue;
    const current = groups.get(label) || { label, campaignIds: new Set<string>(), revenue: 0 };
    current.campaignIds.add(item.campaignId || item.contractGroupId || item.id);
    current.revenue += recognizedMonthlyRevenue(item, monthStart, monthEnd);
    groups.set(label, current);
  }
  return [...groups.values()]
    .map((item) => ({
      label: item.label,
      campaigns: item.campaignIds.size,
      revenue: roundMoney(item.revenue)
    }))
    .sort((a, b) => b.revenue - a.revenue || b.campaigns - a.campaigns);
}

function findConflicts(items: CampaignRow[], now: Date) {
  const active = items
    .filter((item) => {
      if (item.periodEnd < now) return false;
      if (item.status === "BOOKED") return true;
      return ["HOLD", "RESERVED"].includes(item.status) && holdIsActive(item, now);
    })
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  const conflicts: Array<[CampaignRow, CampaignRow]> = [];
  const byLocation = new Map<string, CampaignRow[]>();
  for (const item of active) {
    const group = byLocation.get(item.location.id) || [];
    for (const existing of group) {
      if (existing.periodEnd >= item.periodStart) conflicts.push([existing, item]);
    }
    group.push(item);
    byLocation.set(item.location.id, group);
  }
  return conflicts;
}

function recognizedMonthlyRevenue(item: CampaignRow, monthStart: Date, monthEnd: Date) {
  const monthly = item.amount ?? item.monthlyRentShare ?? (item.contractGroupId ? 0 : item.monthlyRentTotal ?? 0);
  return calculateProrata(monthly, item.periodStart, item.periodEnd, monthStart, monthEnd).amount;
}

function sellerName(item: CampaignRow) {
  return item.sellerUser?.name || item.salesperson || "Nealocat";
}

function isLocationBlocked(location: LocationRow, now: Date) {
  if (!location.blockedReason) return false;
  if (location.blockedFrom && location.blockedFrom > now) return false;
  if (location.blockedUntil && location.blockedUntil < now) return false;
  return true;
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date) {
  return left < right ? left : right;
}

function latestDate(values: Date[]) {
  return values.reduce<Date | null>((latest, value) => !latest || value > latest ? value : latest, null);
}

function earliestDate(values: Date[]) {
  return values.reduce<Date | null>((earliest, value) => !earliest || value < earliest ? value : earliest, null);
}

function statusToCrmStatus(status: string) {
  if (status === "CONTACTED") return "CONTACTED";
  if (status === "QUOTED") return "OFFER_SENT";
  if (status === "WON") return "WON";
  if (status === "LOST" || status === "ARCHIVED") return "LOST";
  return "NEW";
}

function normalizeCrmStatus(value?: string | null) {
    const allowed = [
      "COLD",
      "QUALIFIED",
      "IN_ANALYSIS",
      "IN_OFFER",
      "IN_NEGOTIATION",
      "IN_CONTRACTING",
      "ON_HOLD",
      "NO_RESPONSE",
      "ACCOUNT_MANAGEMENT",
      "WON",
      "LOST",
      "INACTIVE",
      "NEW",
      "CONTACTED",
      "OFFER_SENT",
      "NEGOTIATION",
      "RESERVATION_CREATED"
    ];
  return allowed.includes(String(value || "")) ? String(value) : null;
}

function dbCrmStatusToUi(status: string) {
  const map: Record<string, string> = {
    cold: "COLD",
    qualified: "QUALIFIED",
    in_analysis: "IN_ANALYSIS",
    in_offer: "IN_OFFER",
    in_negotiation: "IN_NEGOTIATION",
    in_contracting: "IN_CONTRACTING",
    on_hold: "ON_HOLD",
    no_response: "NO_RESPONSE",
    account_management: "ACCOUNT_MANAGEMENT",
    won: "WON",
    lost: "LOST",
    inactive: "INACTIVE",
    new: "COLD",
    contacted: "QUALIFIED",
    brief_received: "IN_ANALYSIS",
    offer_sent: "IN_OFFER",
    negotiation: "IN_NEGOTIATION",
    hold_created: "ON_HOLD"
  };
  return map[status] || status.toUpperCase();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
