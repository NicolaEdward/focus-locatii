import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import {
  canAccessCrmLead,
  CRM_ACTIVE_DB_STATUSES,
  CRM_STATUS_OPTIONS,
  crmDbStatusesFor,
  crmDueWhere,
  crmEffectiveProbability,
  crmForecastCategoryForStatus,
  crmLeadAttention,
  crmLeadClassificationAttention,
  crmLeadScope,
  crmOpportunityPriority,
  crmProbabilityForUpdate,
  crmQualificationScore,
  crmStageAgeDays,
  crmStageIsStalled,
  crmStatusAtLeast,
  isActiveCrmStatus,
  monthlyCrmOutcomes,
  nextCrmForecastCategory,
  normalizeCrmQualificationData,
  normalizeCrmStatus,
  summarizeCrmLeads,
  validateCrmForecast,
  validateCrmState,
  type CrmQualificationData
} from "@/lib/crm";
import { prisma } from "@/lib/prisma";
import { canonicalTaxId, normalizeTaxId, taxIdSearchValues } from "@/lib/tax-id";

export type CrmListInput = {
  query?: string;
  status?: string;
  assignee?: string;
  due?: "all" | "attention" | "overdue" | "today" | "upcoming" | "missing";
  clientType?: string;
  source?: string;
  industry?: string;
  page?: number;
  limit?: number;
};

export async function listCrmLeads(input: CrmListInput, actor: AuthSession) {
  const page = Math.max(1, Math.floor(input.page || 1));
  const limit = Math.max(10, Math.min(60, Math.floor(input.limit || 30)));
  const scope = crmLeadScope(actor);
  const query = input.query?.trim() || "";
  const status = CRM_STATUS_OPTIONS.some((option) => option.value === input.status) ? input.status as never : null;
  const where: Prisma.CrmLeadWhereInput = {
    AND: [
      scope,
      crmDueWhere(input.due || "all"),
      ...(status ? [{ status: { in: crmDbStatusesFor(status) } }] : []),
      ...(input.assignee && actor.role !== "SALES_AGENT" ? [{ assignedToUserId: input.assignee }] : []),
      ...(input.clientType ? [{ clientType: input.clientType }] : []),
      ...(input.source ? [{ source: { contains: input.source } }] : []),
      ...(input.industry ? [{ industry: input.industry }] : []),
      ...(query
        ? [{
            OR: [
              { companyName: { contains: query } },
              { taxId: { contains: query } },
              { opportunityName: { contains: query } },
              { contactName: { contains: query } },
              { email: { contains: query } },
              { phone: { contains: query } },
              { locationsInterested: { contains: query } },
              { nextStep: { contains: query } },
              { assignedTo: { name: { contains: query } } }
            ]
          }]
        : [])
    ]
  };

  const summaryWhere = crmLeadScope(actor);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [rows, total, summaryRows, outcomeEvents] = await Promise.all([
    prisma.crmLead.findMany({
      where,
      select: crmLeadSummarySelect,
      orderBy: [{ nextFollowUpDate: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.crmLead.count({ where }),
    prisma.crmLead.findMany({
      where: summaryWhere,
      select: {
        status: true,
        nextFollowUpDate: true,
        estimatedValue: true,
        currency: true,
        probability: true,
        forecastCategory: true,
        expectedCloseDate: true,
        updatedAt: true,
        stageChangedAt: true,
        firstContactedAt: true,
        qualifiedAt: true,
        lastActivityAt: true,
        qualificationData: true,
        noResponseCount: true
      }
    }),
    prisma.crmActivity.findMany({
      where: {
        activityDate: { gte: monthStart, lte: now },
        statusAtTime: { in: [...crmDbStatusesFor("won"), ...crmDbStatusesFor("lost")] },
        ...(actor.role === "SALES_AGENT" ? { lead: { assignedToUserId: actor.id } } : {})
      },
      select: { leadId: true, statusAtTime: true, activityDate: true },
      orderBy: { activityDate: "asc" },
      take: 5000
    })
  ]);
  const outcomes = monthlyCrmOutcomes(outcomeEvents, now);

  return {
    leads: rows.map(serializeCrmLeadSummary),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit))
    },
    summary: {
      ...summarizeCrmLeads(summaryRows, now),
      ...outcomes
    }
  };
}

export async function getCrmLead(id: string, actor: AuthSession) {
  const lead = await prisma.crmLead.findFirst({
    where: { id, ...crmLeadScope(actor) },
    include: {
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      client: {
        select: {
          id: true,
          companyName: true,
          taxId: true,
          status: true,
          accountOwnerUserId: true,
          generalEmail: true,
          generalPhone: true
        }
      },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: {
        orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
        take: 50,
        include: { user: { select: { id: true, name: true, role: true } } }
      }
    }
  });
  if (!lead) return null;
  const [campaigns, companyHistory] = await Promise.all([
    lead.clientId
    ? await prisma.campaign.findMany({
        where: { clientId: lead.clientId, archivedAt: null },
        select: {
          id: true,
          campaignName: true,
          status: true,
          startDate: true,
          endDate: true,
          totalContractValue: true,
          currency: true
        },
        orderBy: { updatedAt: "desc" },
        take: 12
      })
    : [],
    listCrmCompanyHistory({
      leadId: lead.id,
      clientId: lead.clientId,
      taxId: lead.taxId
    }, actor)
  ]);
  return serializeCrmLeadDetail(lead, campaigns, companyHistory);
}

export async function createCrmLead(input: {
  leadDate?: Date | null;
  companyName: string;
  taxId: string;
  industry: string;
  opportunityName?: string | null;
  clientType?: string | null;
  clientId?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  assignedToUserId?: string | null;
  status: string;
  estimatedValue?: number | null;
  currency?: string | null;
  probability?: number | null;
  expectedCloseDate?: Date | null;
  nextFollowUpDate?: Date | null;
  nextStep?: string | null;
  qualificationData?: Partial<CrmQualificationData> | null;
  locationsInterested?: string | null;
  notes?: string | null;
}, actor: AuthSession) {
  crmLeadScope(actor);
  const assignedToUserId = await resolveCrmAssignee(actor, input.assignedToUserId);
  const taxId = normalizeTaxId(input.taxId);
  if (!taxId) throw new Error("Completeaza CUI / CIF-ul firmei.");
  await assertCrmCompanyOwnership({
    taxId,
    companyName: input.companyName,
    opportunityName: input.opportunityName,
    clientId: input.clientId,
    assignedToUserId
  }, actor);
  const status = validateCrmState({
    status: input.status,
    nextFollowUpDate: input.nextFollowUpDate,
    clientId: input.clientId
  });
  const probability = crmEffectiveProbability(input.probability, status);
  const forecastCategory = validateCrmForecast({
    status,
    probability,
    estimatedValue: input.estimatedValue,
    expectedCloseDate: input.expectedCloseDate
  });
  const now = new Date();
  const firstContactedAt = crmStatusAtLeast(status, "contacted") ? now : null;
  const qualifiedAt = crmStatusAtLeast(status, "qualified") ? now : null;
  const nextStep = input.nextStep?.trim() || "Contact initial";
  return prisma.crmLead.create({
    data: {
      companyName: input.companyName,
      taxId,
      industry: input.industry.trim(),
      opportunityName: input.opportunityName,
      leadDate: input.leadDate || new Date(),
      clientType: input.clientType,
      clientId: input.clientId,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      source: input.source,
      assignedToUserId,
      createdByUserId: actor.id,
      status,
      estimatedValue: input.estimatedValue,
      currency: input.currency || "EUR",
      probability,
      forecastCategory,
      expectedCloseDate: input.expectedCloseDate,
      nextFollowUpDate: input.nextFollowUpDate,
      nextStep,
      qualificationData: normalizeCrmQualificationData(input.qualificationData) as Prisma.InputJsonValue,
      locationsInterested: input.locationsInterested,
      notes: input.notes,
      stageChangedAt: now,
      firstContactedAt,
      qualifiedAt,
      lastContactAt: firstContactedAt,
      lastActivityAt: now,
      contacts: input.contactName
        ? {
            create: {
              name: input.contactName,
              role: input.contactRole,
              phone: input.phone,
              email: input.email,
              isPrimary: true
            }
          }
        : undefined,
      activities: {
        create: {
          userId: actor.id,
          type: "prospectare",
          actionType: "prospectare",
          statusAtTime: status,
          details: input.notes || "Lead creat.",
          locations: input.locationsInterested,
          nextFollowUpDate: input.nextFollowUpDate,
          nextStep,
          note: input.notes || "Lead creat."
        }
      }
    },
    include: {
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: { orderBy: { activityDate: "desc" }, take: 8 }
    }
  });
}

export async function updateCrmLead(id: string, patch: {
  companyName?: string;
  taxId?: string;
  industry?: string;
  opportunityName?: string | null;
  leadDate?: Date | null;
  clientType?: string | null;
  clientId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  assignedToUserId?: string | null;
  status?: string;
  estimatedValue?: number | null;
  currency?: string | null;
  probability?: number | null;
  expectedCloseDate?: Date | null;
  nextFollowUpDate?: Date | null;
  nextStep?: string | null;
  qualificationData?: Partial<CrmQualificationData> | null;
  locationsInterested?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  lostReasonCode?: string | null;
  activityNote?: string | null;
}, actor: AuthSession) {
  const existing = await prisma.crmLead.findUnique({ where: { id } });
  if (!existing) throw new Error("Lead-ul nu exista.");
  if (!canAccessCrmLead(actor, existing)) throw new Error("Poti modifica doar lead-urile tale.");
  const assignedToUserId = patch.assignedToUserId === undefined
    ? existing.assignedToUserId
    : await resolveCrmAssignee(actor, patch.assignedToUserId);
  const nextTaxId = patch.taxId === undefined ? existing.taxId : normalizeTaxId(patch.taxId);
  if (patch.taxId !== undefined && !nextTaxId) throw new Error("CUI / CIF-ul nu este valid.");
  if (nextTaxId && (patch.taxId !== undefined || patch.clientId !== undefined || patch.assignedToUserId !== undefined)) {
    await assertCrmCompanyOwnership({
      taxId: nextTaxId,
      companyName: patch.companyName ?? existing.companyName,
      opportunityName: patch.opportunityName === undefined ? existing.opportunityName : patch.opportunityName,
      clientId: patch.clientId === undefined ? existing.clientId : patch.clientId,
      assignedToUserId,
      excludeLeadId: id
    }, actor);
  }
  const nextStatus = normalizeCrmStatus(patch.status ?? existing.status);
  if (patch.status !== undefined && nextStatus === "won" && normalizeCrmStatus(existing.status) !== "won") {
    throw new Error("Foloseste actiunea Inchide oportunitatea pentru a confirma castigarea si clientul.");
  }
  const nextClientId = patch.clientId === undefined ? existing.clientId : patch.clientId;
  const nextFollowUpDate = patch.nextFollowUpDate === undefined ? existing.nextFollowUpDate : patch.nextFollowUpDate;
  const nextLostReason = patch.lostReason === undefined ? existing.lostReason : patch.lostReason;
  const nextLostReasonCode = patch.lostReasonCode === undefined ? existing.lostReasonCode : patch.lostReasonCode;
  const nextEstimatedValue = patch.estimatedValue === undefined ? existing.estimatedValue : patch.estimatedValue;
  const nextExpectedCloseDate = patch.expectedCloseDate === undefined ? existing.expectedCloseDate : patch.expectedCloseDate;
  const nextProbability = crmProbabilityForUpdate({
    currentProbability: existing.probability,
    requestedProbability: patch.probability,
    nextStatus
  });
  const nextForecastCategory = nextCrmForecastCategory({
    nextStatus,
    probability: nextProbability
  });
  const nextNextStep = isTerminalStatus(nextStatus)
    ? null
    : patch.nextStep === undefined
      ? existing.nextStep
      : patch.nextStep;
  validateCrmState({
    status: nextStatus,
    nextFollowUpDate,
    lostReason: nextLostReason,
    lostReasonCode: nextLostReasonCode,
    clientId: nextClientId
  });
  validateCrmForecast({
    status: nextStatus,
    probability: nextProbability,
    estimatedValue: nextEstimatedValue,
    expectedCloseDate: nextExpectedCloseDate
  });
  const statusChanged = nextStatus !== normalizeCrmStatus(existing.status);
  const ownerChanged = assignedToUserId !== existing.assignedToUserId;
  const now = new Date();
  const firstContactedAt = existing.firstContactedAt
    || (crmStatusAtLeast(nextStatus, "contacted") ? now : null);
  const qualifiedAt = existing.qualifiedAt
    || (crmStatusAtLeast(nextStatus, "qualified") ? now : null);
  const activityChanged = statusChanged || ownerChanged || Boolean(patch.activityNote);

  return prisma.crmLead.update({
    where: { id },
    data: {
      ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
      ...(patch.taxId !== undefined ? { taxId: nextTaxId } : {}),
      ...(patch.industry !== undefined ? { industry: patch.industry.trim() } : {}),
      ...(patch.opportunityName !== undefined ? { opportunityName: patch.opportunityName } : {}),
      ...(patch.leadDate !== undefined ? { leadDate: patch.leadDate } : {}),
      ...(patch.clientType !== undefined ? { clientType: patch.clientType } : {}),
      ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
      ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.assignedToUserId !== undefined ? { assignedToUserId } : {}),
      ...(patch.status !== undefined ? { status: nextStatus } : {}),
      ...(patch.estimatedValue !== undefined ? { estimatedValue: patch.estimatedValue } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.probability !== undefined || ["won", "lost"].includes(nextStatus) ? { probability: nextProbability } : {}),
      forecastCategory: nextForecastCategory,
      ...(patch.expectedCloseDate !== undefined ? { expectedCloseDate: patch.expectedCloseDate } : {}),
      ...(patch.nextFollowUpDate !== undefined ? { nextFollowUpDate: patch.nextFollowUpDate } : {}),
      ...(patch.nextStep !== undefined || isTerminalStatus(nextStatus) ? { nextStep: nextNextStep } : {}),
      ...(patch.qualificationData !== undefined
        ? { qualificationData: normalizeCrmQualificationData(patch.qualificationData) as Prisma.InputJsonValue }
        : {}),
      ...(patch.locationsInterested !== undefined ? { locationsInterested: patch.locationsInterested } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.lostReason !== undefined ? { lostReason: patch.lostReason } : {}),
      ...(patch.lostReasonCode !== undefined ? { lostReasonCode: patch.lostReasonCode } : {}),
      ...(statusChanged ? { stageChangedAt: now } : {}),
      ...(firstContactedAt && !existing.firstContactedAt ? { firstContactedAt } : {}),
      ...(qualifiedAt && !existing.qualifiedAt ? { qualifiedAt } : {}),
      ...(activityChanged ? { lastActivityAt: now } : {}),
      activities: activityChanged
        ? {
            create: {
              userId: actor.id,
              type: statusChanged ? "status_change" : ownerChanged ? "reassignment" : "note",
              actionType: statusChanged ? "status_change" : ownerChanged ? "reassignment" : "note",
              statusAtTime: nextStatus,
              details: patch.activityNote || (ownerChanged ? "Responsabil CRM schimbat." : null),
              locations: patch.locationsInterested,
              nextFollowUpDate,
              nextStep: isTerminalStatus(nextStatus) ? null : nextNextStep || "Continua follow-up-ul comercial.",
              note: patch.activityNote || (statusChanged ? `Status schimbat din ${normalizeCrmStatus(existing.status)} in ${nextStatus}.` : "Lead actualizat.")
            }
          }
        : undefined
    },
    include: {
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: { orderBy: { activityDate: "desc" }, take: 8 }
    }
  });
}

export async function listCrmActivities(leadId: string, actor: AuthSession, limit = 50) {
  const lead = await prisma.crmLead.findUnique({ where: { id: leadId }, select: { assignedToUserId: true } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");
  return prisma.crmActivity.findMany({
    where: { leadId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    take: Math.max(10, Math.min(100, limit))
  });
}

export async function addCrmActivity(leadId: string, input: {
  activityDate?: Date | null;
  actionType: string;
  details: string;
  locations?: string | null;
  nextStep?: string | null;
  nextFollowUpDate?: Date | null;
  status?: string | null;
}, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Poti adauga activitati doar pe lead-urile tale.");
  const nextFollowUpDate = input.nextFollowUpDate === undefined ? lead.nextFollowUpDate : input.nextFollowUpDate;
  const currentStatus = normalizeCrmStatus(lead.status);
  const nextStatus = input.status ? normalizeCrmStatus(input.status) : currentStatus;
  if (nextStatus === "won" && currentStatus !== "won") {
    throw new Error("Foloseste actiunea Inchide oportunitatea pentru a confirma castigarea si clientul.");
  }
  const nextForecastCategory = nextCrmForecastCategory({
    nextStatus,
    probability: crmEffectiveProbability(lead.probability, nextStatus)
  });
  validateCrmState({
    status: nextStatus,
    nextFollowUpDate,
    lostReason: lead.lostReason,
    lostReasonCode: lead.lostReasonCode,
    clientId: lead.clientId
  });
  validateCrmForecast({
    status: nextStatus,
    probability: crmEffectiveProbability(lead.probability, nextStatus),
    estimatedValue: lead.estimatedValue,
    expectedCloseDate: lead.expectedCloseDate
  });
  const activityDate = input.activityDate || new Date();
  const isNoResponse = input.actionType === "call_no_answer";
  const isContactAttempt = crmContactActionTypes.has(input.actionType) || isNoResponse;
  const isConfirmedContact = crmConfirmedContactActionTypes.has(input.actionType);
  const firstContactedAt = lead.firstContactedAt
    || (isConfirmedContact || crmStatusAtLeast(nextStatus, "contacted") ? activityDate : null);
  const qualifiedAt = lead.qualifiedAt
    || (crmStatusAtLeast(nextStatus, "qualified") ? activityDate : null);
  return prisma.$transaction(async (tx) => {
    const activity = await tx.crmActivity.create({
      data: {
        leadId,
        userId: actor.id,
        type: input.actionType,
        actionType: input.actionType,
        activityDate,
        statusAtTime: nextStatus,
        details: input.details,
        locations: input.locations,
        nextStep: input.nextStep,
        nextFollowUpDate,
        note: input.details
      },
      include: { user: { select: { id: true, name: true, role: true } } }
    });
    await tx.crmLead.update({
      where: { id: leadId },
      data: {
        nextFollowUpDate,
        nextStep: input.nextStep === undefined ? lead.nextStep : input.nextStep,
        ...(nextStatus !== currentStatus ? { status: nextStatus } : {}),
        ...(nextStatus !== currentStatus ? { stageChangedAt: activityDate } : {}),
        forecastCategory: nextForecastCategory,
        ...(firstContactedAt && !lead.firstContactedAt ? { firstContactedAt } : {}),
        ...(qualifiedAt && !lead.qualifiedAt ? { qualifiedAt } : {}),
        ...(isContactAttempt ? { lastContactAt: activityDate } : {}),
        lastActivityAt: activityDate,
        ...(isNoResponse
          ? { noResponseCount: { increment: 1 } }
          : isConfirmedContact
            ? { noResponseCount: 0 }
            : {}),
        ...(input.locations !== undefined ? { locationsInterested: input.locations } : {})
      }
    });
    return activity;
  });
}

export async function findCrmDuplicates(query: string, actor: AuthSession, taxIdInput?: string | null) {
  crmLeadScope(actor);
  const value = query.trim();
  const normalizedTaxId = normalizeTaxId(taxIdInput);
  const taxIdValues = taxIdSearchValues(normalizedTaxId);
  if (value.length < 2 && !normalizedTaxId) return { clients: [], leads: [] };
  const normalized = normalizeClientName(value);
  const [clients, leads] = await Promise.all([
    prisma.clientAccount.findMany({
      where: {
        status: { notIn: ["merged", "archived"] },
        OR: [
          ...(value.length >= 2 ? [{ companyName: { contains: value } }] : []),
          ...(normalized ? [{ normalizedName: { contains: normalized } }] : []),
          ...(taxIdValues.length ? [{ taxId: { in: taxIdValues } }] : [])
        ]
      },
      select: {
        id: true,
        companyName: true,
        taxId: true,
        status: true,
        clientType: true,
        accountOwner: { select: { id: true, name: true } }
      },
      orderBy: { companyName: "asc" },
      take: 8
    }),
    prisma.crmLead.findMany({
      where: {
        status: { in: CRM_ACTIVE_DB_STATUSES },
        OR: [
          ...(value.length >= 2 ? [
            { companyName: { contains: value } },
            { email: { contains: value } },
            { phone: { contains: value } }
          ] : []),
          ...(taxIdValues.length ? [{ taxId: { in: taxIdValues } }] : [])
        ]
      },
      select: {
        id: true,
        companyName: true,
        taxId: true,
        opportunityName: true,
        status: true,
        lastContactAt: true,
        lastActivityAt: true,
        assignedTo: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    })
  ]);
  return {
    clients: clients.map((client) => ({
      ...client,
      exactTaxIdMatch: Boolean(normalizedTaxId && canonicalTaxId(client.taxId) === canonicalTaxId(normalizedTaxId))
    })),
    leads: leads.map((lead) => ({
      ...lead,
      status: normalizeCrmStatus(lead.status),
      exactTaxIdMatch: Boolean(normalizedTaxId && canonicalTaxId(lead.taxId) === canonicalTaxId(normalizedTaxId)),
      canOpen: canAccessCrmLead(actor, { assignedToUserId: lead.assignedTo?.id || null }),
      lastContactAt: lead.lastContactAt?.toISOString() || null,
      lastActivityAt: lead.lastActivityAt?.toISOString() || null
    }))
  };
}

export async function listCrmDailyAgenda(input: { assignee?: string | null }, actor: AuthSession) {
  crmLeadScope(actor);
  const ownerId = resolveAgendaOwner(actor, input.assignee);
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = addDays(todayStart, 1);
  const nextWeek = addDays(todayStart, 8);
  const activeFinancialUpload = await prisma.financialReportUpload.findFirst({
    where: { activeVersion: true, status: "confirmed" },
    select: { id: true, reportDate: true, uploadedAt: true },
    orderBy: { uploadedAt: "desc" }
  });
  const leadOwnerWhere = ownerId ? { assignedToUserId: ownerId } : {};
  const receivableOwnerWhere: Prisma.FinancialReceivableWhereInput = ownerId
    ? { OR: [{ accountOwnerUserId: ownerId }, { client: { accountOwnerUserId: ownerId } }] }
    : {};

  const [calls, receivables, opportunities] = await Promise.all([
    prisma.crmLead.findMany({
      where: {
        ...leadOwnerWhere,
        status: { in: CRM_ACTIVE_DB_STATUSES },
        nextFollowUpDate: { lt: tomorrow }
      },
      select: crmLeadSummarySelect,
      orderBy: [{ nextFollowUpDate: "asc" }, { updatedAt: "desc" }],
      take: 30
    }),
    prisma.financialReceivable.findMany({
      where: {
        ...receivableOwnerWhere,
        uploadId: activeFinancialUpload?.id || "__no_active_financial_report__",
        includedInReport: true,
        needsReview: false,
        status: { notIn: ["collected", "included", "excluded", "archived"] },
        remainingAmount: { gt: 0 },
        dueDate: { gte: addDays(todayStart, -180), lt: nextWeek }
      },
      select: {
        id: true,
        clientId: true,
        clientName: true,
        companyName: true,
        invoiceNumber: true,
        dueDate: true,
        remainingAmount: true,
        currency: true,
        client: { select: { id: true, companyName: true, accountOwner: { select: { id: true, name: true } } } }
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 30
    }),
    prisma.crmLead.findMany({
      where: {
        ...leadOwnerWhere,
        status: { in: CRM_ACTIVE_DB_STATUSES },
        expectedCloseDate: { lt: nextWeek }
      },
      select: crmLeadSummarySelect,
      orderBy: [{ expectedCloseDate: "asc" }, { updatedAt: "desc" }],
      take: 60
    })
  ]);

  return {
    ownerId,
    generatedAt: now.toISOString(),
    financialReport: activeFinancialUpload
      ? {
          available: true,
          reportDate: activeFinancialUpload.reportDate?.toISOString() || null,
          uploadedAt: activeFinancialUpload.uploadedAt.toISOString()
        }
      : { available: false, reportDate: null, uploadedAt: null },
    counts: {
      calls: calls.length,
      receivables: receivables.length,
      opportunities: opportunities.filter((lead) => ["best_case", "commit"].includes(crmForecastCategoryForStatus(lead.status, lead.probability))).slice(0, 30).length
    },
    calls: calls.map(serializeCrmLeadSummary),
    receivables: receivables.map((row) => ({
      ...row,
      dueDate: row.dueDate?.toISOString() || null,
      remainingAmount: row.remainingAmount == null ? null : Number(row.remainingAmount)
    })),
    opportunities: opportunities
      .filter((lead) => ["best_case", "commit"].includes(crmForecastCategoryForStatus(lead.status, lead.probability)))
      .slice(0, 30)
      .map(serializeCrmLeadSummary)
  };
}

export async function convertCrmLeadToClient(input: {
  leadId: string;
  clientId?: string | null;
}, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: input.leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");
  if (normalizeCrmStatus(lead.status) === "won" && lead.clientId) {
    const client = await prisma.clientAccount.findFirst({
      where: { id: lead.clientId, status: { notIn: ["merged", "archived"] } }
    });
    if (client) return { client, lead, alreadyCompleted: true };
  }
  if (!isActiveCrmStatus(lead.status)) {
    throw new Error("Doar oportunitatile active pot fi inchise ca fiind castigate.");
  }

  const converted = await prisma.$transaction(async (tx) => {
    const requestedClientId = input.clientId || lead.clientId;
    let client = requestedClientId
      ? await tx.clientAccount.findFirst({ where: { id: requestedClientId, status: { notIn: ["merged", "archived"] } } })
      : await tx.clientAccount.findFirst({
          where: {
            status: { notIn: ["merged", "archived"] },
            OR: [
              ...(lead.taxId ? [{ taxId: { in: taxIdSearchValues(lead.taxId) } }] : []),
              { normalizedName: normalizeClientName(lead.companyName) }
            ]
          },
          orderBy: { updatedAt: "desc" }
        });
    if (requestedClientId && !client) throw new Error("Clientul selectat nu exista sau este arhivat.");
    if (client && lead.taxId && client.taxId && canonicalTaxId(client.taxId) !== canonicalTaxId(lead.taxId)) {
      throw new Error("CUI-ul oportunitatii nu corespunde clientului selectat.");
    }
    if (client?.accountOwnerUserId && actor.role === "SALES_AGENT" && client.accountOwnerUserId !== actor.id) {
      throw new Error("Clientul exista la alt owner. COO trebuie sa confirme legatura sau reasignarea.");
    }
    if (client && lead.taxId && !client.taxId) {
      client = await tx.clientAccount.update({ where: { id: client.id }, data: { taxId: lead.taxId } });
    }
    if (!client) {
      client = await tx.clientAccount.create({
        data: {
          companyName: lead.companyName,
          normalizedName: normalizeClientName(lead.companyName),
          taxId: lead.taxId,
          clientType: lead.clientType || "direct_client",
          generalEmail: lead.email,
          generalPhone: lead.phone,
          accountOwnerUserId: lead.assignedToUserId,
          createdByUserId: actor.id,
          status: "active"
        }
      });
    }
    if (lead.contactName) {
      const existingContact = await tx.clientContact.findFirst({
        where: {
          clientId: client.id,
          OR: [
            ...(lead.email ? [{ email: lead.email }] : []),
            ...(lead.phone ? [{ phone: lead.phone }] : []),
            { name: lead.contactName }
          ]
        },
        select: { id: true }
      });
      if (!existingContact) {
        const hasPrimaryContact = await tx.clientContact.findFirst({
          where: { clientId: client.id, isPrimary: true },
          select: { id: true }
        });
        await tx.clientContact.create({
          data: {
            clientId: client.id,
            name: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            isPrimary: !hasPrimaryContact
          }
        });
      }
    }
    await tx.crmContact.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id } });
    const completedAt = new Date();
    const updatedLead = await tx.crmLead.update({
      where: { id: lead.id },
      data: {
        clientId: client.id,
        status: "won",
        probability: 100,
        nextFollowUpDate: null,
        nextStep: null,
        forecastCategory: "closed",
        stageChangedAt: completedAt,
        lastActivityAt: completedAt,
        activities: {
          create: {
            userId: actor.id,
            type: "conversion",
            actionType: "status_change",
            statusAtTime: "won",
            details: `Oportunitate castigata. Client asociat: ${client.companyName}.`,
            note: "Inchidere comerciala confirmata."
          }
        }
      }
    });
    return { client, lead: updatedLead, alreadyCompleted: false };
  });

  return converted;
}

export async function validCrmAssignees() {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" }
  });
}

export async function addCrmContact(leadId: string, input: {
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.crmContact.updateMany({ where: { leadId }, data: { isPrimary: false } });
    }
    const contact = await tx.crmContact.create({
      data: {
        leadId,
        clientId: lead.clientId,
        name: input.name,
        role: input.role,
        phone: input.phone,
        email: input.email,
        isPrimary: Boolean(input.isPrimary),
        notes: input.notes
      }
    });
    if (input.isPrimary || !lead.contactName) {
      await tx.crmLead.update({
        where: { id: leadId },
        data: {
          contactName: input.name,
          phone: input.phone,
          email: input.email
        }
      });
    }
    return contact;
  });
}

export async function updateCrmContact(leadId: string, contactId: string, patch: {
  name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");
  const existing = await prisma.crmContact.findFirst({ where: { id: contactId, leadId } });
  if (!existing) throw new Error("Contactul nu exista.");
  return prisma.$transaction(async (tx) => {
    if (patch.isPrimary) {
      await tx.crmContact.updateMany({ where: { leadId, id: { not: contactId } }, data: { isPrimary: false } });
    }
    const contact = await tx.crmContact.update({ where: { id: contactId }, data: patch });
    if (contact.isPrimary) {
      await tx.crmLead.update({
        where: { id: leadId },
        data: { contactName: contact.name, phone: contact.phone, email: contact.email }
      });
    }
    return contact;
  });
}

export async function removeCrmContact(leadId: string, contactId: string, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");
  const existing = await prisma.crmContact.findFirst({ where: { id: contactId, leadId } });
  if (!existing) throw new Error("Contactul nu exista.");
  await prisma.crmContact.delete({ where: { id: contactId } });
  return { id: contactId };
}

const crmLeadSummarySelect = {
  id: true,
  leadDate: true,
  companyName: true,
  taxId: true,
  industry: true,
  opportunityName: true,
  clientType: true,
  contactName: true,
  phone: true,
  email: true,
  source: true,
  clientId: true,
  status: true,
  assignedToUserId: true,
  estimatedValue: true,
  currency: true,
  probability: true,
  forecastCategory: true,
  expectedCloseDate: true,
  nextFollowUpDate: true,
  nextStep: true,
  qualificationData: true,
  locationsInterested: true,
  lostReason: true,
  lostReasonCode: true,
  stageChangedAt: true,
  firstContactedAt: true,
  qualifiedAt: true,
  lastContactAt: true,
  lastActivityAt: true,
  noResponseCount: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  client: { select: { id: true, companyName: true, status: true } },
  _count: { select: { contacts: true, activities: true } },
  activities: {
    orderBy: [{ activityDate: "desc" as const }, { createdAt: "desc" as const }],
    take: 1,
    select: {
      id: true,
      actionType: true,
      activityDate: true,
      details: true,
      nextStep: true,
      nextFollowUpDate: true
    }
  }
} satisfies Prisma.CrmLeadSelect;

function serializeCrmLeadSummary(row: Prisma.CrmLeadGetPayload<{ select: typeof crmLeadSummarySelect }>) {
  const qualification = crmQualificationScore(row.qualificationData);
  return {
    ...row,
    status: normalizeCrmStatus(row.status),
    probability: crmEffectiveProbability(row.probability, row.status),
    forecastCategory: crmForecastCategoryForStatus(row.status, row.probability),
    leadDate: row.leadDate?.toISOString() || null,
    expectedCloseDate: row.expectedCloseDate?.toISOString() || null,
    nextFollowUpDate: row.nextFollowUpDate?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attention: crmLeadAttention(row),
    classificationAttention: crmLeadClassificationAttention(row),
    qualification,
    stageAgeDays: crmStageAgeDays(row.stageChangedAt),
    stageStalled: crmStageIsStalled(row),
    priority: crmOpportunityPriority(row),
    stageChangedAt: row.stageChangedAt.toISOString(),
    firstContactedAt: row.firstContactedAt?.toISOString() || null,
    qualifiedAt: row.qualifiedAt?.toISOString() || null,
    lastContactAt: row.lastContactAt?.toISOString() || null,
    lastActivityAt: row.lastActivityAt?.toISOString() || null,
    latestActivity: row.activities[0]
      ? {
          ...row.activities[0],
          activityDate: row.activities[0].activityDate.toISOString(),
          nextFollowUpDate: row.activities[0].nextFollowUpDate?.toISOString() || null
        }
      : null,
    activities: undefined
  };
}

function serializeCrmLeadDetail(
  lead: Awaited<ReturnType<typeof prisma.crmLead.findFirst>> & Record<string, any>,
  campaigns: Array<Record<string, any>>,
  companyHistory: Array<Record<string, any>>
) {
  const qualification = crmQualificationScore(lead.qualificationData);
  return {
    ...lead,
    status: normalizeCrmStatus(lead.status),
    probability: crmEffectiveProbability(lead.probability, lead.status),
    forecastCategory: crmForecastCategoryForStatus(lead.status, lead.probability),
    leadDate: lead.leadDate?.toISOString() || null,
    expectedCloseDate: lead.expectedCloseDate?.toISOString() || null,
    nextFollowUpDate: lead.nextFollowUpDate?.toISOString() || null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    qualificationData: normalizeCrmQualificationData(lead.qualificationData),
    qualification,
    stageAgeDays: crmStageAgeDays(lead.stageChangedAt),
    stageStalled: crmStageIsStalled(lead),
    priority: crmOpportunityPriority(lead),
    stageChangedAt: lead.stageChangedAt.toISOString(),
    firstContactedAt: lead.firstContactedAt?.toISOString() || null,
    qualifiedAt: lead.qualifiedAt?.toISOString() || null,
    lastContactAt: lead.lastContactAt?.toISOString() || null,
    lastActivityAt: lead.lastActivityAt?.toISOString() || null,
    activities: (lead.activities || []).map((activity: Record<string, any>) => ({
      ...activity,
      activityDate: activity.activityDate.toISOString(),
      nextFollowUpDate: activity.nextFollowUpDate?.toISOString() || null,
      createdAt: activity.createdAt.toISOString()
    })),
    contacts: (lead.contacts || []).map((contact: Record<string, any>) => ({
      ...contact,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString()
    })),
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      startDate: campaign.startDate?.toISOString() || null,
      endDate: campaign.endDate?.toISOString() || null,
      totalContractValue: campaign.totalContractValue == null ? null : Number(campaign.totalContractValue)
    })),
    companyHistory
  };
}

async function listCrmCompanyHistory(
  input: { leadId: string; clientId?: string | null; taxId?: string | null },
  actor: AuthSession
) {
  const taxIdValues = taxIdSearchValues(input.taxId);
  if (!input.clientId && !taxIdValues.length) return [];
  const rows = await prisma.crmLead.findMany({
    where: {
      OR: [
        ...(input.clientId ? [{ clientId: input.clientId }] : []),
        ...(taxIdValues.length ? [{ taxId: { in: taxIdValues } }] : [])
      ]
    },
    select: {
      id: true,
      companyName: true,
      opportunityName: true,
      status: true,
      assignedToUserId: true,
      createdAt: true,
      lastContactAt: true,
      lastActivityAt: true,
      assignedTo: { select: { id: true, name: true } },
      activities: {
        orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          actionType: true,
          activityDate: true,
          user: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    take: 20
  });
  return rows.map((row) => ({
    id: row.id,
    isCurrent: row.id === input.leadId,
    companyName: row.companyName,
    opportunityName: row.opportunityName,
    status: normalizeCrmStatus(row.status),
    assignedTo: row.assignedTo,
    createdAt: row.createdAt.toISOString(),
    lastContactAt: row.lastContactAt?.toISOString() || null,
    lastActivityAt: row.lastActivityAt?.toISOString() || null,
    latestActivity: row.activities[0]
      ? {
          ...row.activities[0],
          activityDate: row.activities[0].activityDate.toISOString()
        }
      : null,
    canOpen: canAccessCrmLead(actor, row)
  }));
}

async function assertCrmCompanyOwnership(input: {
  taxId: string;
  companyName: string;
  opportunityName?: string | null;
  clientId?: string | null;
  assignedToUserId: string | null;
  excludeLeadId?: string;
}, actor: AuthSession) {
  const taxIdValues = taxIdSearchValues(input.taxId);
  const [client, selectedClient, activeLeads] = await Promise.all([
    prisma.clientAccount.findFirst({
      where: { taxId: { in: taxIdValues }, status: { notIn: ["merged", "archived"] } },
      select: { id: true, companyName: true, accountOwnerUserId: true }
    }),
    input.clientId
      ? prisma.clientAccount.findFirst({
          where: { id: input.clientId, status: { notIn: ["merged", "archived"] } },
          select: { id: true, companyName: true, taxId: true }
        })
      : Promise.resolve(null),
    prisma.crmLead.findMany({
      where: {
        id: input.excludeLeadId ? { not: input.excludeLeadId } : undefined,
        taxId: { in: taxIdValues },
        status: { in: CRM_ACTIVE_DB_STATUSES }
      },
      select: { id: true, companyName: true, opportunityName: true, assignedToUserId: true, assignedTo: { select: { name: true } } },
      take: 10
    })
  ]);

  if (input.clientId && !selectedClient) throw new Error("Clientul selectat nu exista sau este arhivat.");
  if (selectedClient?.taxId && canonicalTaxId(selectedClient.taxId) !== canonicalTaxId(input.taxId)) {
    throw new Error(`CUI-ul introdus nu corespunde clientului ${selectedClient.companyName}.`);
  }
  if (client && input.clientId !== client.id) {
    throw new Error(`CUI-ul este deja inregistrat la clientul ${client.companyName}. Selecteaza clientul existent.`);
  }
  const otherOwner = activeLeads.find((lead) => lead.assignedToUserId && lead.assignedToUserId !== input.assignedToUserId);
  if (otherOwner && actor.role === "SALES_AGENT") {
    throw new Error(`Firma este deja lucrata de ${otherOwner.assignedTo?.name || "alt vanzator"}. Verifica istoricul inainte de a continua.`);
  }
  const duplicateOpportunity = activeLeads.find((lead) =>
    lead.assignedToUserId === input.assignedToUserId
    && normalizeClientName(lead.companyName) === normalizeClientName(input.companyName)
    && normalizeClientName(lead.opportunityName || "") === normalizeClientName(input.opportunityName || "")
  );
  if (duplicateOpportunity) {
    throw new Error("Exista deja o oportunitate activa identica pentru aceasta firma.");
  }
}

function resolveAgendaOwner(actor: AuthSession, requestedAssignee?: string | null) {
  if (actor.role === "SALES_AGENT") return actor.id;
  if (actor.role === "SALES_DIRECTOR") return requestedAssignee || actor.id;
  return requestedAssignee || null;
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

async function resolveCrmAssignee(actor: AuthSession, requestedId?: string | null) {
  crmLeadScope(actor);
  if (actor.role === "SALES_AGENT") {
    if (requestedId && requestedId !== actor.id) throw new Error("Nu poti asigna lead-ul catre alt vanzator.");
    return actor.id;
  }
  if (!requestedId) throw new Error("Alege agentul de vanzari responsabil.");
  const target = await prisma.user.findFirst({
    where: { id: requestedId, active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
    select: { id: true }
  });
  if (!target) throw new Error("Responsabilul CRM trebuie sa fie un agent sau director de vanzari activ.");
  return target.id;
}

function isTerminalStatus(status: string) {
  return ["won", "lost", "inactive"].includes(normalizeCrmStatus(status));
}

const crmContactActionTypes = new Set([
  "telefon",
  "email",
  "whatsapp",
  "meeting",
  "vizita",
  "call_connected",
  "email_sent",
  "meeting_held"
]);

const crmConfirmedContactActionTypes = new Set([
  "telefon",
  "email",
  "whatsapp",
  "meeting",
  "vizita",
  "call_connected",
  "email_sent",
  "meeting_held"
]);
