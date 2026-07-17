import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import {
  canAccessCrmLead,
  CRM_ACTIVE_DB_STATUSES,
  CRM_STATUS_OPTIONS,
  crmDefaultProbability,
  crmDbStatusesFor,
  crmDueWhere,
  crmLeadAttention,
  crmLeadClassificationAttention,
  crmLeadScope,
  crmOpportunityPriority,
  crmQualificationScore,
  crmStageAgeDays,
  crmStageIsStalled,
  crmStatusAtLeast,
  monthlyCrmOutcomes,
  normalizeCrmQualificationData,
  normalizeCrmStatus,
  summarizeCrmLeads,
  validateCrmState,
  type CrmQualificationData
} from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export type CrmListInput = {
  query?: string;
  status?: string;
  assignee?: string;
  due?: "all" | "attention" | "overdue" | "today" | "upcoming" | "missing";
  clientType?: string;
  source?: string;
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
      ...(query
        ? [{
            OR: [
              { companyName: { contains: query } },
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
  const campaigns = lead.clientId
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
    : [];
  return serializeCrmLeadDetail(lead, campaigns);
}

export async function createCrmLead(input: {
  leadDate?: Date | null;
  companyName: string;
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
  const status = validateCrmState({
    status: input.status,
    nextFollowUpDate: input.nextFollowUpDate,
    clientId: input.clientId
  });
  const probability = input.probability ?? crmDefaultProbability(status);
  const now = new Date();
  const firstContactedAt = crmStatusAtLeast(status, "contacted") ? now : null;
  const qualifiedAt = crmStatusAtLeast(status, "qualified") ? now : null;
  const nextStep = input.nextStep?.trim() || "Contact initial";
  return prisma.crmLead.create({
    data: {
      companyName: input.companyName,
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
  const nextStatus = normalizeCrmStatus(patch.status ?? existing.status);
  const nextClientId = patch.clientId === undefined ? existing.clientId : patch.clientId;
  const nextFollowUpDate = patch.nextFollowUpDate === undefined ? existing.nextFollowUpDate : patch.nextFollowUpDate;
  const nextLostReason = patch.lostReason === undefined ? existing.lostReason : patch.lostReason;
  const nextLostReasonCode = patch.lostReasonCode === undefined ? existing.lostReasonCode : patch.lostReasonCode;
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
  const statusChanged = nextStatus !== normalizeCrmStatus(existing.status);
  const ownerChanged = assignedToUserId !== existing.assignedToUserId;
  const shouldApplyStageProbability = statusChanged
    && patch.probability === undefined
    && (existing.probability == null || existing.probability === crmDefaultProbability(existing.status));
  const nextProbability = patch.probability !== undefined
    ? patch.probability
    : shouldApplyStageProbability
      ? crmDefaultProbability(nextStatus)
      : existing.probability;
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
      ...(patch.probability !== undefined || shouldApplyStageProbability ? { probability: nextProbability } : {}),
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
  validateCrmState({
    status: nextStatus,
    nextFollowUpDate,
    lostReason: lead.lostReason,
    lostReasonCode: lead.lostReasonCode,
    clientId: lead.clientId
  });
  const shouldApplyStageProbability = nextStatus !== currentStatus
    && (lead.probability == null || lead.probability === crmDefaultProbability(currentStatus));
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
        ...(shouldApplyStageProbability ? { probability: crmDefaultProbability(nextStatus) } : {}),
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

export async function findCrmDuplicates(query: string, actor: AuthSession) {
  crmLeadScope(actor);
  const value = query.trim();
  if (value.length < 2) return { clients: [], leads: [] };
  const normalized = normalizeClientName(value);
  const [clients, leads] = await Promise.all([
    prisma.clientAccount.findMany({
      where: {
        status: { notIn: ["merged", "archived"] },
        OR: [
          { companyName: { contains: value } },
          ...(normalized ? [{ normalizedName: { contains: normalized } }] : [])
        ]
      },
      select: {
        id: true,
        companyName: true,
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
        OR: [{ companyName: { contains: value } }, { email: { contains: value } }, { phone: { contains: value } }]
      },
      select: {
        id: true,
        companyName: true,
        opportunityName: true,
        status: true,
        assignedTo: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    })
  ]);
  return {
    clients,
    leads: leads.map((lead) => ({ ...lead, status: normalizeCrmStatus(lead.status), canOpen: canAccessCrmLead(actor, { assignedToUserId: lead.assignedTo?.id || null }) }))
  };
}

export async function convertCrmLeadToClient(input: {
  leadId: string;
  clientId?: string | null;
}, actor: AuthSession) {
  const lead = await prisma.crmLead.findUnique({ where: { id: input.leadId } });
  if (!lead || !canAccessCrmLead(actor, lead)) throw new Error("Lead-ul nu este accesibil.");

  const converted = await prisma.$transaction(async (tx) => {
    let client = input.clientId
      ? await tx.clientAccount.findFirst({ where: { id: input.clientId, status: { notIn: ["merged", "archived"] } } })
      : await tx.clientAccount.findFirst({
          where: { normalizedName: normalizeClientName(lead.companyName), status: { notIn: ["merged", "archived"] } },
          orderBy: { updatedAt: "desc" }
        });
    if (client?.accountOwnerUserId && actor.role === "SALES_AGENT" && client.accountOwnerUserId !== actor.id) {
      throw new Error("Clientul exista la alt owner. COO trebuie sa confirme legatura sau reasignarea.");
    }
    if (!client) {
      client = await tx.clientAccount.create({
        data: {
          companyName: lead.companyName,
          normalizedName: normalizeClientName(lead.companyName),
          clientType: lead.clientType || "direct_client",
          generalEmail: lead.email,
          generalPhone: lead.phone,
          accountOwnerUserId: lead.assignedToUserId,
          createdByUserId: actor.id,
          status: "active"
        }
      });
      if (lead.contactName) {
        await tx.clientContact.create({
          data: {
            clientId: client.id,
            name: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            isPrimary: true
          }
        });
      }
    }
    const updatedLead = await tx.crmLead.update({
      where: { id: lead.id },
      data: {
        clientId: client.id,
        status: "won",
        nextFollowUpDate: null,
        nextStep: null,
        probability: 100,
        stageChangedAt: new Date(),
        lastActivityAt: new Date(),
        activities: {
          create: {
            userId: actor.id,
            type: "conversion",
            actionType: "status_change",
            statusAtTime: "won",
            details: `Lead convertit in client: ${client.companyName}.`,
            note: "Conversie CRM confirmata."
          }
        }
      }
    });
    return { client, lead: updatedLead };
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
  campaigns: Array<Record<string, any>>
) {
  const qualification = crmQualificationScore(lead.qualificationData);
  return {
    ...lead,
    status: normalizeCrmStatus(lead.status),
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
    }))
  };
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
