import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import {
  CRM_ACTIVE_OPPORTUNITY_STAGES,
  CRM_ACTIVE_PROSPECT_STATUSES,
  crmAddBusinessDays,
  crmAssertOpportunityTransition,
  crmAssertProspectTransition,
  crmCurrentOpportunityValue,
  crmDefaultNextAction,
  crmForecastForStage,
  crmForecastLabel,
  crmNextActionLabel,
  crmNormalizeCompanyName,
  crmNormalizeEmail,
  crmNormalizePhone,
  crmNormalizeWebsiteDomain,
  crmOpportunityStageLabel,
  crmProspectStatusLabel,
  crmStartOfLocalDay,
  crmValidateActionForStage
} from "@/lib/crm-domain";
import { crmOpportunityTotals } from "@/lib/crm-analytics-v4";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { normalizeTaxId } from "@/lib/tax-id";

const activeProspectStatuses = [...CRM_ACTIVE_PROSPECT_STATUSES];
const activeOpportunityStages = [...CRM_ACTIVE_OPPORTUNITY_STAGES];
const closedProspectStatuses = ["return_later", "disqualified", "on_hold", "inactive"];
const closedOpportunityStages = ["won", "lost", "on_hold", "inactive"];
const defaultPageSize = 24;

export class CrmDomainError extends Error {
  constructor(message: string, public readonly code = "CRM_VALIDATION", public readonly status = 400, public readonly details?: unknown) {
    super(message);
  }
}

export type CrmWorkspaceInput = {
  view?: "today" | "prospecting" | "opportunities" | "all";
  query?: string;
  ownerId?: string;
  status?: string;
  stage?: string;
  source?: string;
  industry?: string;
  due?: "all" | "overdue" | "today" | "upcoming" | "missing";
  page?: number;
  limit?: number;
};

export async function getCrmWorkspace(input: CrmWorkspaceInput, actor: AuthSession) {
  assertCanView(actor);
  const view = input.view || "today";
  const page = Math.max(1, Math.floor(input.page || 1));
  const limit = Math.max(10, Math.min(50, Math.floor(input.limit || defaultPageSize)));
  const now = new Date();
  const dayStart = crmStartOfLocalDay(now);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const query = input.query?.trim() || "";
  const ownerId = scopedOwner(actor, input.ownerId);
  const companyFilter: Prisma.CrmCompanyWhereInput = {
    ...(input.industry ? { industry: input.industry } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { taxId: { contains: query } },
            { website: { contains: query } },
            { contacts: { some: { OR: [{ name: { contains: query } }, { email: { contains: query } }, { phone: { contains: query } }] } } }
          ]
        }
      : {})
  };
  const prospectWhere: Prisma.CrmProspectWhereInput = {
    ...(ownerId ? { ownerId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.status ? { status: input.status } : view === "prospecting" ? { status: { in: activeProspectStatuses } } : {}),
    company: companyFilter
  };
  const opportunityWhere: Prisma.CrmOpportunityWhereInput = {
    ...(ownerId ? { ownerId } : {}),
    ...(input.stage ? { stage: input.stage } : view === "opportunities" ? { stage: { in: activeOpportunityStages } } : {}),
    company: companyFilter
  };
  const actionWhere: Prisma.CrmNextActionWhereInput = {
    status: "open",
    ...(ownerId ? { ownerId } : {}),
    ...(input.due === "overdue" ? { dueAt: { lt: dayStart } } : {}),
    ...(input.due === "today" ? { dueAt: { gte: dayStart, lt: dayEnd } } : {}),
    ...(input.due === "upcoming" ? { dueAt: { gte: dayEnd } } : {}),
    ...(input.due === "missing" ? { id: "__none__" } : {}),
    company: companyFilter
  };

  const opportunityRowsPromise = view === "today" || view === "prospecting"
    ? Promise.resolve([])
    : view === "opportunities" && !input.stage
      ? Promise.all(activeOpportunityStages.map((stage) => prisma.crmOpportunity.findMany({
          where: { ...opportunityWhere, stage },
          select: opportunityCardSelect,
          orderBy: [{ decisionDate: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
          take: Math.min(limit, 25)
        }))).then((columns) => columns.flat())
      : prisma.crmOpportunity.findMany({
          where: opportunityWhere,
          select: opportunityCardSelect,
          orderBy: [{ decisionDate: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * limit,
          take: limit
        });
  const [prospectCount, opportunityCount, actionCount, prospectRows, opportunityRows, actionRows, metricOpportunities, recentWon] = await Promise.all([
    prisma.crmProspect.count({ where: prospectWhere }),
    prisma.crmOpportunity.count({ where: opportunityWhere }),
    prisma.crmNextAction.count({ where: actionWhere }),
    view === "today" || view === "opportunities"
      ? Promise.resolve([])
      : prisma.crmProspect.findMany({
          where: prospectWhere,
          select: prospectCardSelect,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * limit,
          take: limit
        }),
    opportunityRowsPromise,
    view !== "today"
      ? Promise.resolve([])
      : prisma.crmNextAction.findMany({
          where: actionWhere,
          select: actionCardSelect,
          orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
          skip: (page - 1) * limit,
          take: limit
        }),
    prisma.crmOpportunity.findMany({
      where: { ...(ownerId ? { ownerId } : {}), stage: { in: [...activeOpportunityStages, "won"] } },
      select: { stage: true, currency: true, quotedValue: true, revisedValue: true, agreedValue: true }
    }),
    prisma.crmOpportunity.count({
      where: { ...(ownerId ? { ownerId } : {}), stage: "won", wonAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }
    })
  ]);

  const [overdue, dueToday, missingAction, activeProspects, activeOpportunities] = await Promise.all([
    prisma.crmNextAction.count({ where: { status: "open", ...(ownerId ? { ownerId } : {}), dueAt: { lt: dayStart } } }),
    prisma.crmNextAction.count({ where: { status: "open", ...(ownerId ? { ownerId } : {}), dueAt: { gte: dayStart, lt: dayEnd } } }),
    countActiveRecordsWithoutAction(ownerId),
    prisma.crmProspect.count({ where: { ...(ownerId ? { ownerId } : {}), status: { in: activeProspectStatuses } } }),
    prisma.crmOpportunity.count({ where: { ...(ownerId ? { ownerId } : {}), stage: { in: activeOpportunityStages } } })
  ]);

  return {
    view,
    perspective: hasGlobalCrmAccess(actor) ? (input.ownerId ? "agent" : "team") : "personal",
    records: {
      actions: actionRows.map(serializeActionCard),
      prospects: prospectRows.map(serializeProspectCard),
      opportunities: opportunityRows.map(serializeOpportunityCard)
    },
    pagination: {
      page,
      limit,
      total: view === "today" ? actionCount : view === "prospecting" ? prospectCount : view === "opportunities" ? opportunityCount : prospectCount + opportunityCount,
      pages: Math.max(1, Math.ceil((view === "today" ? actionCount : view === "prospecting" ? prospectCount : view === "opportunities" ? opportunityCount : Math.max(prospectCount, opportunityCount)) / limit))
    },
    summary: {
      activeProspects,
      activeOpportunities,
      overdue,
      dueToday,
      missingAction,
      wonThisMonth: recentWon,
      forecastByLevel: crmOpportunityTotals(metricOpportunities)
    }
  };
}

export async function getCrmRecord(kind: "prospect" | "opportunity", id: string, actor: AuthSession, eventCursor?: string | null) {
  assertCanView(actor);
  if (kind === "prospect") {
    const row = await prisma.crmProspect.findFirst({
      where: { id, ...prospectScope(actor) },
      select: prospectDetailSelect
    });
    if (!row) throw new CrmDomainError("Prospectul nu exista sau nu iti este alocat.", "CRM_NOT_FOUND", 404);
    const events = await listEvents({ companyId: row.companyId, prospectId: id, cursor: eventCursor });
    return { kind, record: serializeProspectDetail(row), events };
  }
  const row = await prisma.crmOpportunity.findFirst({
    where: { id, ...opportunityScope(actor) },
    select: opportunityDetailSelect
  });
  if (!row) throw new CrmDomainError("Oportunitatea nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);
  const events = await listEvents({ companyId: row.companyId, opportunityId: id, cursor: eventCursor });
  return { kind, record: serializeOpportunityDetail(row), events };
}

export async function findCrmDuplicates(input: {
  companyName?: string | null;
  taxId?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
}, actor: AuthSession) {
  assertCanView(actor);
  const normalizedName = input.companyName ? crmNormalizeCompanyName(input.companyName) : null;
  const normalizedTaxId = normalizeTaxId(input.taxId || "") || null;
  const normalizedWebsiteDomain = crmNormalizeWebsiteDomain(input.website);
  const normalizedEmail = crmNormalizeEmail(input.email);
  const normalizedPhone = crmNormalizePhone(input.phone);
  const matches = await prisma.crmCompany.findMany({
    where: {
      OR: [
        ...(normalizedTaxId ? [{ normalizedTaxId }] : []),
        ...(normalizedName ? [{ normalizedName }] : []),
        ...(normalizedWebsiteDomain ? [{ normalizedWebsiteDomain }] : []),
        ...(normalizedEmail ? [{ contacts: { some: { normalizedEmail } } }] : []),
        ...(normalizedPhone ? [{ contacts: { some: { normalizedPhone } } }] : [])
      ]
    },
    select: {
      id: true,
      name: true,
      taxId: true,
      website: true,
      owner: { select: { id: true, name: true } },
      prospects: { where: { status: { in: activeProspectStatuses } }, select: { id: true, status: true }, take: 1 }
    },
    take: 8
  });
  return matches.map((company) => ({
    ...company,
    match: normalizedTaxId && normalizeTaxId(company.taxId || "") === normalizedTaxId ? "exact_tax_id" : "possible"
  }));
}

export async function createColdProspect(input: {
  companyName: string;
  taxId?: string | null;
  industry?: string | null;
  website?: string | null;
  source?: string | null;
  ownerId?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  email?: string | null;
  phone?: string | null;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
  allowPotentialDuplicate?: boolean;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  const ownerId = await resolveOwner(actor, input.ownerId);
  const companyName = requiredText(input.companyName, "Denumirea firmei este obligatorie.");
  const normalizedName = crmNormalizeCompanyName(companyName);
  const normalizedTaxId = normalizeTaxId(input.taxId || "") || null;
  const normalizedWebsiteDomain = crmNormalizeWebsiteDomain(input.website);
  const normalizedEmail = crmNormalizeEmail(input.email);
  const normalizedPhone = crmNormalizePhone(input.phone);
  const duplicates = await findCrmDuplicates(input, actor);
  const exact = duplicates.find((duplicate) => duplicate.match === "exact_tax_id");
  const reusable = exact || duplicates.find((duplicate) => duplicate.name.toLowerCase() === companyName.toLowerCase());
  if (reusable?.prospects.length) {
    throw new CrmDomainError("Firma are deja o prospectare activa.", "CRM_ACTIVE_PROSPECT_EXISTS", 409, { companyId: reusable.id, prospectId: reusable.prospects[0].id });
  }
  if (!reusable && duplicates.length && !input.allowPotentialDuplicate) {
    throw new CrmDomainError("Am gasit firme similare. Verifica inainte de a crea o inregistrare noua.", "CRM_POSSIBLE_DUPLICATE", 409, { duplicates });
  }
  const hasContact = Boolean(input.contactName?.trim() || input.email?.trim() || input.phone?.trim());
  const actionType = input.nextActionType || crmDefaultNextAction(hasContact);
  crmValidateActionForStage("prospecting", actionType, input.nextActionDescription);
  const dueAt = input.nextActionDueAt || crmAddBusinessDays(new Date(), 3);
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existingEvent = await tx.crmEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { prospectId: true } });
      if (existingEvent?.prospectId) return getProspectAfterTransaction(tx, existingEvent.prospectId);
    }
    const company = reusable
      ? await tx.crmCompany.update({
          where: { id: reusable.id },
          data: {
            ownerId,
            taxId: input.taxId?.trim() || undefined,
            normalizedTaxId: normalizedTaxId || undefined,
            industry: input.industry?.trim() || undefined,
            website: input.website?.trim() || undefined,
            normalizedWebsiteDomain: normalizedWebsiteDomain || undefined,
            version: { increment: 1 }
          }
        })
      : await tx.crmCompany.create({
          data: {
            name: companyName,
            normalizedName,
            taxId: input.taxId?.trim() || null,
            normalizedTaxId,
            industry: input.industry?.trim() || null,
            website: input.website?.trim() || null,
            normalizedWebsiteDomain,
            ownerId,
            createdByUserId: actor.id
          }
        });
    if (hasContact) {
      await tx.crmCompanyContact.create({
        data: {
          companyId: company.id,
          name: input.contactName?.trim() || input.email?.trim() || input.phone?.trim() || "Contact",
          role: input.contactRole?.trim() || null,
          email: input.email?.trim() || null,
          normalizedEmail,
          phone: input.phone?.trim() || null,
          normalizedPhone,
          isPrimary: true,
          createdByUserId: actor.id
        }
      });
    }
    const prospect = await tx.crmProspect.create({
      data: {
        companyId: company.id,
        ownerId,
        createdByUserId: actor.id,
        source: input.source?.trim() || "Prospectare proprie",
        status: "prospecting",
        contactState: hasContact ? "uncontacted" : "contact_missing",
        initialSnapshot: jsonValue({ companyName, taxId: input.taxId || null, source: input.source || "Prospectare proprie", ownerId })
      }
    });
    await tx.crmNextAction.create({
      data: {
        companyId: company.id,
        prospectId: prospect.id,
        ownerId,
        createdByUserId: actor.id,
        type: actionType,
        description: input.nextActionDescription?.trim() || null,
        dueAt
      }
    });
    await tx.crmEvent.create({
      data: {
        companyId: company.id,
        prospectId: prospect.id,
        actorUserId: actor.id,
        type: "PROSPECT_CREATED",
        summary: "Prospect Cold creat.",
        nextValues: jsonValue({ status: "prospecting", ownerId, nextActionType: actionType, nextActionDueAt: dueAt.toISOString() }),
        idempotencyKey: input.idempotencyKey || null
      }
    });
    return getProspectAfterTransaction(tx, prospect.id);
  });
}

export async function createInboundOpportunity(input: {
  companyName: string;
  taxId: string;
  industry?: string | null;
  website?: string | null;
  source?: string | null;
  ownerId?: string | null;
  contactName: string;
  contactRole?: string | null;
  email?: string | null;
  phone?: string | null;
  opportunityName?: string | null;
  needSummary: string;
  geography?: string | null;
  formats?: string | null;
  desiredPeriodStart?: Date | null;
  desiredPeriodEnd?: Date | null;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
  allowPotentialDuplicate?: boolean;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  const prospect = await createColdProspect({
    ...input,
    nextActionType: "qualify_need",
    nextActionDueAt: input.nextActionDueAt,
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:prospect` : null
  }, actor);
  return qualifyProspectAndCreateOpportunity({
    prospectId: prospect.id,
    version: prospect.version,
    qualificationSummary: { needConfirmed: true, contextConfirmed: true, inbound: true },
    opportunityName: input.opportunityName || `${input.companyName.trim()} - OOH`,
    needSummary: input.needSummary,
    geography: input.geography,
    formats: input.formats,
    desiredPeriodStart: input.desiredPeriodStart,
    desiredPeriodEnd: input.desiredPeriodEnd,
    nextActionType: input.nextActionType || "request_full_brief",
    nextActionDescription: input.nextActionDescription,
    nextActionDueAt: input.nextActionDueAt || crmAddBusinessDays(new Date(), 2),
    idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:opportunity` : null
  }, actor);
}

export async function qualifyProspect(input: {
  prospectId: string;
  version: number;
  qualificationSummary: Record<string, unknown>;
  nextActionDueAt: Date;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const event = await tx.crmEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { prospectId: true } });
      if (event?.prospectId) return getProspectAfterTransaction(tx, event.prospectId);
    }
    const prospect = await tx.crmProspect.findFirst({ where: { id: input.prospectId, ...prospectScope(actor) }, include: { company: { include: { contacts: { take: 1 } } } } });
    if (!prospect) throw new CrmDomainError("Prospectul nu exista sau nu iti este alocat.", "CRM_NOT_FOUND", 404);
    crmAssertProspectTransition(prospect.status, "qualified");
    assertQualificationReady(prospect.company.normalizedTaxId, prospect.company.contacts.length, input.qualificationSummary);
    const result = await tx.crmProspect.updateMany({ where: { id: prospect.id, version: input.version }, data: { status: "qualified", qualificationSummary: jsonValue(input.qualificationSummary), qualifiedAt: new Date(), version: { increment: 1 } } });
    if (result.count !== 1) throw concurrencyError();
    await replaceNextAction(tx, { companyId: prospect.companyId, prospectId: prospect.id, ownerId: prospect.ownerId, stage: "qualified", nextActionType: "create_opportunity", nextActionDueAt: input.nextActionDueAt }, actor.id);
    await tx.crmEvent.create({ data: { companyId: prospect.companyId, prospectId: prospect.id, actorUserId: actor.id, type: "PROSPECT_QUALIFIED", summary: "Prospect calificat.", previousValues: jsonValue({ status: prospect.status }), nextValues: jsonValue({ status: "qualified", qualificationSummary: input.qualificationSummary }), idempotencyKey: input.idempotencyKey || null } });
    return getProspectAfterTransaction(tx, prospect.id);
  });
}

export async function qualifyProspectAndCreateOpportunity(input: {
  prospectId: string;
  version: number;
  qualificationSummary: Record<string, unknown>;
  opportunityName: string;
  needSummary: string;
  desiredPeriodStart?: Date | null;
  desiredPeriodEnd?: Date | null;
  geography?: string | null;
  formats?: string | null;
  budgetStatus?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  nextActionType: string;
  nextActionDescription?: string | null;
  nextActionDueAt: Date;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  crmValidateActionForStage("opportunity", input.nextActionType, input.nextActionDescription);
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const event = await tx.crmEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { opportunityId: true } });
      if (event?.opportunityId) return getOpportunityAfterTransaction(tx, event.opportunityId);
    }
    const prospect = await tx.crmProspect.findFirst({
      where: { id: input.prospectId, ...prospectScope(actor) },
      include: { company: { include: { contacts: { take: 1 } } } }
    });
    if (!prospect) throw new CrmDomainError("Prospectul nu exista sau nu iti este alocat.", "CRM_NOT_FOUND", 404);
    if (!['prospecting', 'qualified'].includes(prospect.status)) throw new CrmDomainError("Doar prospectele active pot deveni oportunitati.");
    assertQualificationReady(prospect.company.normalizedTaxId, prospect.company.contacts.length, input.qualificationSummary);
    if (input.desiredPeriodStart && input.desiredPeriodEnd && input.desiredPeriodStart > input.desiredPeriodEnd) {
      throw new CrmDomainError("Perioada dorita nu este valida.");
    }
    const existingOpportunity = await tx.crmOpportunity.findFirst({
      where: { sourceProspectId: prospect.id, stage: { in: [...activeOpportunityStages, "on_hold"] } },
      select: { id: true }
    });
    if (existingOpportunity) throw new CrmDomainError("Prospectul are deja o oportunitate activa.", "CRM_ACTIVE_OPPORTUNITY_EXISTS", 409, existingOpportunity);
    const updated = await tx.crmProspect.updateMany({
      where: { id: prospect.id, version: input.version },
      data: { status: "qualified", qualificationSummary: jsonValue(input.qualificationSummary), qualifiedAt: prospect.qualifiedAt || new Date(), version: { increment: 1 } }
    });
    if (updated.count !== 1) throw concurrencyError();
    await closeOpenActions(tx, { prospectId: prospect.id }, actor.id, "Prospect calificat si transformat in oportunitate.");
    const opportunity = await tx.crmOpportunity.create({
      data: {
        companyId: prospect.companyId,
        sourceProspectId: prospect.id,
        ownerId: prospect.ownerId,
        createdByUserId: actor.id,
        name: requiredText(input.opportunityName, "Denumirea oportunitatii este obligatorie."),
        needSummary: requiredText(input.needSummary, "Descrierea nevoii este obligatorie."),
        desiredPeriodStart: input.desiredPeriodStart || null,
        desiredPeriodEnd: input.desiredPeriodEnd || null,
        geography: input.geography?.trim() || null,
        formats: input.formats?.trim() || null,
        budgetStatus: input.budgetStatus?.trim() || null,
        budgetMin: decimalOrNull(input.budgetMin),
        budgetMax: decimalOrNull(input.budgetMax),
        currency: input.currency?.trim().toUpperCase() || null,
        initialSnapshot: jsonValue({ sourceProspectId: prospect.id, needSummary: input.needSummary, stage: "opportunity" })
      }
    });
    await tx.crmNextAction.create({
      data: {
        companyId: prospect.companyId,
        opportunityId: opportunity.id,
        ownerId: prospect.ownerId,
        createdByUserId: actor.id,
        type: input.nextActionType,
        description: input.nextActionDescription?.trim() || null,
        dueAt: input.nextActionDueAt
      }
    });
    await tx.crmEvent.createMany({
      data: [
        {
          companyId: prospect.companyId,
          prospectId: prospect.id,
          actorUserId: actor.id,
          type: "PROSPECT_QUALIFIED",
          summary: "Prospect calificat.",
          previousValues: jsonValue({ status: prospect.status }),
          nextValues: jsonValue({ status: "qualified", qualificationSummary: input.qualificationSummary })
        },
        {
          companyId: prospect.companyId,
          prospectId: prospect.id,
          opportunityId: opportunity.id,
          actorUserId: actor.id,
          type: "OPPORTUNITY_CREATED",
          summary: "Oportunitate creata din prospect calificat.",
          nextValues: jsonValue({ stage: "opportunity", name: opportunity.name }),
          idempotencyKey: input.idempotencyKey || null
        }
      ]
    });
    return getOpportunityAfterTransaction(tx, opportunity.id);
  });
}

export async function transitionProspect(input: {
  prospectId: string;
  version: number;
  toStatus: string;
  reason?: string | null;
  returnAt?: Date | null;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    const prospect = await tx.crmProspect.findFirst({ where: { id: input.prospectId, ...prospectScope(actor) } });
    if (!prospect) throw new CrmDomainError("Prospectul nu exista sau nu iti este alocat.", "CRM_NOT_FOUND", 404);
    crmAssertProspectTransition(prospect.status, input.toStatus);
    if (["return_later", "disqualified", "inactive"].includes(input.toStatus) && !input.reason?.trim()) {
      throw new CrmDomainError("Motivul este obligatoriu pentru aceasta schimbare.");
    }
    if (input.toStatus === "return_later" && !input.returnAt) throw new CrmDomainError("Data revenirii este obligatorie.");
    const active = activeProspectStatuses.includes(input.toStatus as never);
    if (active && (!input.nextActionType || !input.nextActionDueAt)) throw new CrmDomainError("Urmatoarea actiune si termenul sunt obligatorii.");
    if (active) crmValidateActionForStage(input.toStatus, input.nextActionType!, input.nextActionDescription);
    const result = await tx.crmProspect.updateMany({
      where: { id: prospect.id, version: input.version },
      data: {
        status: input.toStatus,
        qualifiedAt: input.toStatus === "qualified" ? prospect.qualifiedAt || new Date() : prospect.qualifiedAt,
        disqualifiedAt: input.toStatus === "disqualified" ? new Date() : null,
        returnAt: input.toStatus === "return_later" ? input.returnAt : null,
        closedReason: input.reason?.trim() || null,
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) throw concurrencyError();
    await closeOpenActions(tx, { prospectId: prospect.id }, actor.id, `Etapa schimbata in ${input.toStatus}.`);
    if (active && input.nextActionType && input.nextActionDueAt) {
      await tx.crmNextAction.create({ data: { companyId: prospect.companyId, prospectId: prospect.id, ownerId: prospect.ownerId, createdByUserId: actor.id, type: input.nextActionType, description: input.nextActionDescription?.trim() || null, dueAt: input.nextActionDueAt } });
    }
    await tx.crmEvent.create({
      data: {
        companyId: prospect.companyId,
        prospectId: prospect.id,
        actorUserId: actor.id,
        type: "PROSPECT_STATUS_CHANGED",
        summary: `${crmProspectStatusLabel(prospect.status)} -> ${crmProspectStatusLabel(input.toStatus)}`,
        result: input.reason?.trim() || null,
        previousValues: jsonValue({ status: prospect.status }),
        nextValues: jsonValue({ status: input.toStatus, returnAt: input.returnAt?.toISOString() || null })
      }
    });
    return getProspectAfterTransaction(tx, prospect.id);
  });
}

export async function transitionOpportunity(input: {
  opportunityId: string;
  version: number;
  toStage: string;
  reason?: string | null;
  lostReasonCode?: string | null;
  competitor?: string | null;
  quotedValue?: number | null;
  revisedValue?: number | null;
  agreedValue?: number | null;
  currency?: string | null;
  decisionDate?: Date | null;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.crmEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { opportunityId: true } });
      if (existing?.opportunityId) return getOpportunityAfterTransaction(tx, existing.opportunityId);
    }
    const opportunity = await tx.crmOpportunity.findFirst({ where: { id: input.opportunityId, ...opportunityScope(actor) } });
    if (!opportunity) throw new CrmDomainError("Oportunitatea nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);
    crmAssertOpportunityTransition(opportunity.stage, input.toStage);
    const closed = closedOpportunityStages.includes(input.toStage);
    if (input.toStage === "lost" && (!input.lostReasonCode?.trim() || !input.reason?.trim())) {
      throw new CrmDomainError("Motivul si categoria pierderii sunt obligatorii.");
    }
    const quotedValue = input.quotedValue == null ? opportunity.quotedValue : decimalOrNull(input.quotedValue);
    const revisedValue = input.revisedValue == null ? opportunity.revisedValue : decimalOrNull(input.revisedValue);
    const agreedValue = input.agreedValue == null ? opportunity.agreedValue : decimalOrNull(input.agreedValue);
    const currency = input.currency?.trim().toUpperCase() || opportunity.currency;
    const decisionDate = input.decisionDate === undefined ? opportunity.decisionDate : input.decisionDate;
    if (["quoted", "negotiation", "contracting", "won"].includes(input.toStage)) {
      const currentValue = crmCurrentOpportunityValue({ quotedValue, revisedValue, agreedValue });
      if (currentValue == null || currentValue <= 0 || !currency || !decisionDate) {
        throw new CrmDomainError("Valoarea integrala, moneda si data estimata a deciziei sunt obligatorii incepand cu etapa Ofertat.");
      }
    }
    if (input.toStage === "won" && crmCurrentOpportunityValue({ agreedValue, revisedValue, quotedValue }) == null) {
      throw new CrmDomainError("Completeaza valoarea finala agreata inainte de castigarea oportunitatii.");
    }
    if (!closed && (!input.nextActionType || !input.nextActionDueAt)) throw new CrmDomainError("Urmatoarea actiune si termenul sunt obligatorii.");
    if (!closed) crmValidateActionForStage(input.toStage, input.nextActionType!, input.nextActionDescription);
    const now = new Date();
    const result = await tx.crmOpportunity.updateMany({
      where: { id: opportunity.id, version: input.version },
      data: {
        previousStage: opportunity.stage,
        stage: input.toStage,
        quotedValue,
        revisedValue,
        agreedValue,
        currency,
        decisionDate,
        quotedAt: input.toStage === "quoted" ? opportunity.quotedAt || now : opportunity.quotedAt,
        negotiationAt: input.toStage === "negotiation" ? opportunity.negotiationAt || now : opportunity.negotiationAt,
        contractingAt: input.toStage === "contracting" ? opportunity.contractingAt || now : opportunity.contractingAt,
        wonAt: input.toStage === "won" ? now : opportunity.wonAt,
        lostAt: input.toStage === "lost" ? now : opportunity.lostAt,
        onHoldAt: input.toStage === "on_hold" ? now : null,
        lostReasonCode: input.toStage === "lost" ? input.lostReasonCode?.trim() || null : opportunity.lostReasonCode,
        lostReason: input.toStage === "lost" ? input.reason?.trim() || null : opportunity.lostReason,
        competitor: input.competitor?.trim() || opportunity.competitor,
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) throw concurrencyError();
    await closeOpenActions(tx, { opportunityId: opportunity.id }, actor.id, `Etapa schimbata in ${input.toStage}.`);
    if (!closed && input.nextActionType && input.nextActionDueAt) {
      await tx.crmNextAction.create({ data: { companyId: opportunity.companyId, opportunityId: opportunity.id, ownerId: opportunity.ownerId, createdByUserId: actor.id, type: input.nextActionType, description: input.nextActionDescription?.trim() || null, dueAt: input.nextActionDueAt } });
    }
    await tx.crmEvent.create({
      data: {
        companyId: opportunity.companyId,
        prospectId: opportunity.sourceProspectId,
        opportunityId: opportunity.id,
        actorUserId: actor.id,
        type: input.toStage === "won" ? "OPPORTUNITY_WON" : input.toStage === "lost" ? "OPPORTUNITY_LOST" : "OPPORTUNITY_STAGE_CHANGED",
        summary: `${crmOpportunityStageLabel(opportunity.stage)} -> ${crmOpportunityStageLabel(input.toStage)}`,
        result: input.reason?.trim() || null,
        previousValues: jsonValue({ stage: opportunity.stage, value: crmCurrentOpportunityValue(opportunity), currency: opportunity.currency }),
        nextValues: jsonValue({ stage: input.toStage, value: crmCurrentOpportunityValue({ quotedValue, revisedValue, agreedValue }), currency }),
        idempotencyKey: input.idempotencyKey || null
      }
    });
    return getOpportunityAfterTransaction(tx, opportunity.id);
  });
}

export async function addCrmUpdate(input: {
  kind: "prospect" | "opportunity";
  id: string;
  version: number;
  type: string;
  summary: string;
  result?: string | null;
  contactState?: string | null;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
  idempotencyKey?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const event = await tx.crmEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (event) return input.kind === "prospect" ? getProspectAfterTransaction(tx, input.id) : getOpportunityAfterTransaction(tx, input.id);
    }
    if (input.kind === "prospect") {
      const row = await tx.crmProspect.findFirst({ where: { id: input.id, ...prospectScope(actor) } });
      if (!row) throw new CrmDomainError("Prospectul nu exista sau nu iti este alocat.", "CRM_NOT_FOUND", 404);
      const update = await tx.crmProspect.updateMany({ where: { id: row.id, version: input.version }, data: { contactState: input.contactState?.trim() || row.contactState, version: { increment: 1 } } });
      if (update.count !== 1) throw concurrencyError();
      if (activeProspectStatuses.includes(row.status as never)) await replaceNextAction(tx, { companyId: row.companyId, prospectId: row.id, ownerId: row.ownerId, stage: row.status, ...input }, actor.id);
      await tx.crmEvent.create({ data: { companyId: row.companyId, prospectId: row.id, actorUserId: actor.id, type: input.type, summary: requiredText(input.summary, "Rezumatul este obligatoriu."), result: input.result?.trim() || null, idempotencyKey: input.idempotencyKey || null } });
      return getProspectAfterTransaction(tx, row.id);
    }
    const row = await tx.crmOpportunity.findFirst({ where: { id: input.id, ...opportunityScope(actor) } });
    if (!row) throw new CrmDomainError("Oportunitatea nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);
    const update = await tx.crmOpportunity.updateMany({ where: { id: row.id, version: input.version }, data: { version: { increment: 1 } } });
    if (update.count !== 1) throw concurrencyError();
    if (activeOpportunityStages.includes(row.stage as never)) await replaceNextAction(tx, { companyId: row.companyId, opportunityId: row.id, ownerId: row.ownerId, stage: row.stage, ...input }, actor.id);
    await tx.crmEvent.create({ data: { companyId: row.companyId, prospectId: row.sourceProspectId, opportunityId: row.id, actorUserId: actor.id, type: input.type, summary: requiredText(input.summary, "Rezumatul este obligatoriu."), result: input.result?.trim() || null, idempotencyKey: input.idempotencyKey || null } });
    return getOpportunityAfterTransaction(tx, row.id);
  });
}

export async function updateCrmCompany(input: {
  companyId: string;
  version: number;
  name?: string;
  taxId?: string | null;
  industry?: string | null;
  website?: string | null;
  ownerId?: string | null;
  reason?: string | null;
}, actor: AuthSession) {
  assertCanManage(actor);
  const company = await prisma.crmCompany.findUnique({ where: { id: input.companyId } });
  if (!company || (!hasGlobalCrmAccess(actor) && company.ownerId !== actor.id)) throw new CrmDomainError("Firma nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);
  const ownerId = input.ownerId === undefined ? company.ownerId : await resolveOwner(actor, input.ownerId);
  if (ownerId !== company.ownerId && !input.reason?.trim()) throw new CrmDomainError("Motivul transferului este obligatoriu.");
  const taxId = input.taxId === undefined ? company.taxId : input.taxId?.trim() || null;
  const normalizedTaxId = normalizeTaxId(taxId || "") || null;
  if (normalizedTaxId) {
    const duplicate = await prisma.crmCompany.findFirst({ where: { normalizedTaxId, id: { not: company.id } }, select: { id: true, name: true } });
    if (duplicate) throw new CrmDomainError(`CUI-ul apartine deja firmei ${duplicate.name}.`, "CRM_DUPLICATE_TAX_ID", 409, duplicate);
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.crmCompany.updateMany({
      where: { id: company.id, version: input.version },
      data: {
        name: input.name?.trim() || company.name,
        normalizedName: input.name ? crmNormalizeCompanyName(input.name) : company.normalizedName,
        taxId,
        normalizedTaxId,
        industry: input.industry === undefined ? company.industry : input.industry?.trim() || null,
        website: input.website === undefined ? company.website : input.website?.trim() || null,
        normalizedWebsiteDomain: input.website === undefined ? company.normalizedWebsiteDomain : crmNormalizeWebsiteDomain(input.website),
        ownerId,
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) throw concurrencyError();
    if (ownerId !== company.ownerId) {
      await Promise.all([
        tx.crmProspect.updateMany({ where: { companyId: company.id, status: { in: activeProspectStatuses } }, data: { ownerId, version: { increment: 1 } } }),
        tx.crmOpportunity.updateMany({ where: { companyId: company.id, stage: { in: activeOpportunityStages } }, data: { ownerId, version: { increment: 1 } } }),
        tx.crmNextAction.updateMany({ where: { companyId: company.id, status: "open" }, data: { ownerId, version: { increment: 1 } } })
      ]);
    }
    await tx.crmEvent.create({ data: { companyId: company.id, actorUserId: actor.id, type: ownerId !== company.ownerId ? "COMPANY_OWNER_CHANGED" : "COMPANY_UPDATED", summary: ownerId !== company.ownerId ? "Responsabilul firmei a fost schimbat." : "Datele firmei au fost actualizate.", result: input.reason?.trim() || null, previousValues: jsonValue({ name: company.name, taxId: company.taxId, industry: company.industry, website: company.website, ownerId: company.ownerId }), nextValues: jsonValue({ name: input.name?.trim() || company.name, taxId, industry: input.industry, website: input.website, ownerId }) } });
    return tx.crmCompany.findUniqueOrThrow({ where: { id: company.id } });
  });
}

export async function addCrmCompanyContact(input: {
  companyId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredChannel?: string | null;
  isDecisionMaker?: boolean;
  isPrimary?: boolean;
}, actor: AuthSession) {
  assertCanManage(actor);
  const company = await prisma.crmCompany.findUnique({ where: { id: input.companyId }, select: { id: true, ownerId: true } });
  if (!company || (!hasGlobalCrmAccess(actor) && company.ownerId !== actor.id)) throw new CrmDomainError("Firma nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) await tx.crmCompanyContact.updateMany({ where: { companyId: company.id, isPrimary: true }, data: { isPrimary: false } });
    const contact = await tx.crmCompanyContact.create({ data: { companyId: company.id, name: requiredText(input.name, "Numele contactului este obligatoriu."), role: input.role?.trim() || null, email: input.email?.trim() || null, normalizedEmail: crmNormalizeEmail(input.email), phone: input.phone?.trim() || null, normalizedPhone: crmNormalizePhone(input.phone), preferredChannel: input.preferredChannel?.trim() || null, isDecisionMaker: Boolean(input.isDecisionMaker), isPrimary: Boolean(input.isPrimary), createdByUserId: actor.id } });
    await tx.crmEvent.create({ data: { companyId: company.id, actorUserId: actor.id, type: "CONTACT_CREATED", summary: `Contact adaugat: ${contact.name}.`, metadata: jsonValue({ contactId: contact.id }) } });
    return contact;
  });
}

export async function listCrmAssignees(actor: AuthSession) {
  assertCanView(actor);
  if (!hasGlobalCrmAccess(actor)) return [{ id: actor.id, name: actor.name, email: actor.email, role: actor.role }];
  return prisma.user.findMany({
    where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" }
  });
}

export function hasGlobalCrmAccess(actor: AuthSession) {
  return hasPermission(actor.role, "leads.view") || hasPermission(actor.role, "leads.manage");
}

function assertCanView(actor: AuthSession) {
  if (!hasPermission(actor.role, "leads.view") && !hasPermission(actor.role, "leads.view.own")) throw new CrmDomainError("Nu ai acces la CRM.", "CRM_FORBIDDEN", 403);
}

function assertCanManage(actor: AuthSession) {
  if (!hasPermission(actor.role, "leads.manage") && !hasPermission(actor.role, "leads.manage.own")) throw new CrmDomainError("Nu poti modifica CRM-ul.", "CRM_FORBIDDEN", 403);
}

function scopedOwner(actor: AuthSession, requested?: string | null) {
  return hasGlobalCrmAccess(actor) ? requested || undefined : actor.id;
}

function prospectScope(actor: AuthSession): Prisma.CrmProspectWhereInput {
  return hasGlobalCrmAccess(actor) ? {} : { ownerId: actor.id };
}

function opportunityScope(actor: AuthSession): Prisma.CrmOpportunityWhereInput {
  return hasGlobalCrmAccess(actor) ? {} : { ownerId: actor.id };
}

async function resolveOwner(actor: AuthSession, requested?: string | null) {
  if (!hasGlobalCrmAccess(actor)) return actor.id;
  const ownerId = requested || actor.id;
  const owner = await prisma.user.findFirst({ where: { id: ownerId, active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } }, select: { id: true } });
  if (!owner) throw new CrmDomainError("Responsabilul selectat nu este un utilizator comercial activ.");
  return owner.id;
}

async function countActiveRecordsWithoutAction(ownerId?: string) {
  const [prospects, opportunities] = await Promise.all([
    prisma.crmProspect.count({ where: { ...(ownerId ? { ownerId } : {}), OR: [{ status: "prospecting" }, { status: "qualified", opportunities: { none: { stage: { in: [...activeOpportunityStages, "on_hold"] } } } }], nextActions: { none: { status: "open" } } } }),
    prisma.crmOpportunity.count({ where: { ...(ownerId ? { ownerId } : {}), stage: { in: activeOpportunityStages }, nextActions: { none: { status: "open" } } } })
  ]);
  return prospects + opportunities;
}

async function listEvents(input: { companyId: string; prospectId?: string; opportunityId?: string; cursor?: string | null }) {
  const rows = await prisma.crmEvent.findMany({
    where: {
      companyId: input.companyId,
      ...(input.opportunityId ? { OR: [{ opportunityId: input.opportunityId }, { prospectId: { not: null }, opportunityId: null }] } : input.prospectId ? { prospectId: input.prospectId } : {})
    },
    select: { id: true, type: true, source: true, summary: true, result: true, previousValues: true, nextValues: true, metadata: true, occurredAt: true, actor: { select: { id: true, name: true } } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: 30
  });
  return { rows: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })), nextCursor: rows.length === 30 ? rows[rows.length - 1].id : null };
}

async function replaceNextAction(tx: Prisma.TransactionClient, input: {
  companyId: string;
  prospectId?: string;
  opportunityId?: string;
  ownerId?: string | null;
  stage: string;
  nextActionType?: string | null;
  nextActionDescription?: string | null;
  nextActionDueAt?: Date | null;
}, actorId: string) {
  if (!input.nextActionType || !input.nextActionDueAt) throw new CrmDomainError("Urmatoarea actiune si termenul sunt obligatorii pentru un element activ.");
  crmValidateActionForStage(input.stage, input.nextActionType, input.nextActionDescription);
  await closeOpenActions(tx, input.prospectId ? { prospectId: input.prospectId } : { opportunityId: input.opportunityId }, actorId, "Inlocuita printr-un update nou.");
  await tx.crmNextAction.create({ data: { companyId: input.companyId, prospectId: input.prospectId, opportunityId: input.opportunityId, ownerId: input.ownerId, createdByUserId: actorId, type: input.nextActionType, description: input.nextActionDescription?.trim() || null, dueAt: input.nextActionDueAt } });
}

async function closeOpenActions(tx: Prisma.TransactionClient, where: { prospectId?: string; opportunityId?: string }, actorId: string, result: string) {
  await tx.crmNextAction.updateMany({ where: { ...where, status: "open" }, data: { status: "completed", completedAt: new Date(), completedByUserId: actorId, result, version: { increment: 1 } } });
}

function getProspectAfterTransaction(tx: Prisma.TransactionClient, id: string) {
  return tx.crmProspect.findUniqueOrThrow({ where: { id }, select: prospectCardSelect }).then(serializeProspectCard);
}

function getOpportunityAfterTransaction(tx: Prisma.TransactionClient, id: string) {
  return tx.crmOpportunity.findUniqueOrThrow({ where: { id }, select: opportunityCardSelect }).then(serializeOpportunityCard);
}

function requiredText(value: string | null | undefined, message: string) {
  const normalized = value?.trim();
  if (!normalized) throw new CrmDomainError(message);
  return normalized;
}

function assertQualificationReady(normalizedTaxId: string | null, contactCount: number, summary: Record<string, unknown>) {
  if (!normalizedTaxId) throw new CrmDomainError("CUI-ul este obligatoriu inainte de calificare.", "CRM_TAX_ID_REQUIRED");
  if (!contactCount) throw new CrmDomainError("Este necesara cel putin o persoana de contact inainte de calificare.", "CRM_CONTACT_REQUIRED");
  if (!summary.needConfirmed || !summary.contextConfirmed) throw new CrmDomainError("Confirma nevoia si contextul OOH inainte de calificare.", "CRM_QUALIFICATION_REQUIRED");
}

function decimalOrNull(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new CrmDomainError("Valoarea comerciala nu este valida.");
  return new Prisma.Decimal(value);
}

function concurrencyError() {
  return new CrmDomainError("Inregistrarea a fost modificata intre timp. Reincarca datele si incearca din nou.", "CRM_VERSION_CONFLICT", 409);
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const ownerSelect = { id: true, name: true, email: true } as const;
const openActionSelect = { id: true, type: true, description: true, dueAt: true, priority: true, status: true } as const;

const prospectCardSelect = {
  id: true,
  companyId: true,
  ownerId: true,
  status: true,
  priority: true,
  contactState: true,
  source: true,
  version: true,
  qualifiedAt: true,
  returnAt: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { name: true, taxId: true, industry: true, contacts: { where: { isPrimary: true }, select: { id: true, name: true, email: true, phone: true }, take: 1 } } },
  owner: { select: ownerSelect },
  nextActions: { where: { status: "open" }, select: openActionSelect, orderBy: { dueAt: "asc" as const }, take: 1 }
} satisfies Prisma.CrmProspectSelect;

const opportunityCardSelect = {
  id: true,
  companyId: true,
  sourceProspectId: true,
  ownerId: true,
  name: true,
  needSummary: true,
  stage: true,
  currency: true,
  quotedValue: true,
  revisedValue: true,
  agreedValue: true,
  decisionDate: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { name: true, taxId: true, industry: true } },
  owner: { select: ownerSelect },
  nextActions: { where: { status: "open" }, select: openActionSelect, orderBy: { dueAt: "asc" as const }, take: 1 }
} satisfies Prisma.CrmOpportunitySelect;

const actionCardSelect = {
  id: true,
  companyId: true,
  prospectId: true,
  opportunityId: true,
  type: true,
  description: true,
  dueAt: true,
  priority: true,
  company: { select: { name: true, industry: true } },
  owner: { select: ownerSelect },
  prospect: { select: { status: true, version: true } },
  opportunity: { select: { name: true, stage: true, version: true, currency: true, quotedValue: true, revisedValue: true, agreedValue: true, decisionDate: true } }
} satisfies Prisma.CrmNextActionSelect;

const prospectDetailSelect = {
  ...prospectCardSelect,
  qualificationSummary: true,
  closedReason: true,
  initialSnapshot: true,
  company: { select: { id: true, name: true, taxId: true, industry: true, website: true, ownerId: true, version: true, contacts: { select: { id: true, name: true, role: true, email: true, phone: true, preferredChannel: true, isDecisionMaker: true, isPrimary: true, createdAt: true }, orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }] }, opportunities: { select: { id: true, name: true, stage: true, currency: true, quotedValue: true, revisedValue: true, agreedValue: true, decisionDate: true }, orderBy: { updatedAt: "desc" as const }, take: 20 } } }
} satisfies Prisma.CrmProspectSelect;

const opportunityDetailSelect = {
  ...opportunityCardSelect,
  desiredPeriodStart: true,
  desiredPeriodEnd: true,
  geography: true,
  formats: true,
  budgetStatus: true,
  budgetMin: true,
  budgetMax: true,
  quotedAt: true,
  negotiationAt: true,
  contractingAt: true,
  wonAt: true,
  lostAt: true,
  lostReasonCode: true,
  lostReason: true,
  competitor: true,
  initialSnapshot: true,
  sourceProspect: { select: { id: true, status: true, source: true, qualificationSummary: true } },
  company: { select: { id: true, name: true, taxId: true, industry: true, website: true, ownerId: true, version: true, contacts: { select: { id: true, name: true, role: true, email: true, phone: true, preferredChannel: true, isDecisionMaker: true, isPrimary: true, createdAt: true }, orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }] }, opportunities: { select: { id: true, name: true, stage: true, currency: true, quotedValue: true, revisedValue: true, agreedValue: true, decisionDate: true }, orderBy: { updatedAt: "desc" as const }, take: 20 } } }
} satisfies Prisma.CrmOpportunitySelect;

function serializeProspectCard(row: Prisma.CrmProspectGetPayload<{ select: typeof prospectCardSelect }>) {
  const action = row.nextActions[0] || null;
  return {
    kind: "prospect" as const,
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    taxId: row.company.taxId,
    industry: row.company.industry,
    owner: row.owner,
    ownerId: row.ownerId,
    status: row.status,
    statusLabel: crmProspectStatusLabel(row.status),
    priority: row.priority,
    contactState: row.contactState,
    source: row.source,
    primaryContact: row.company.contacts[0] || null,
    nextAction: action ? { ...action, label: crmNextActionLabel(action.type, action.description), dueAt: action.dueAt.toISOString() } : null,
    version: row.version,
    qualifiedAt: row.qualifiedAt?.toISOString() || null,
    returnAt: row.returnAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeOpportunityCard(row: Prisma.CrmOpportunityGetPayload<{ select: typeof opportunityCardSelect }>) {
  const action = row.nextActions[0] || null;
  const forecast = crmForecastForStage(row.stage);
  return {
    kind: "opportunity" as const,
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    taxId: row.company.taxId,
    industry: row.company.industry,
    owner: row.owner,
    ownerId: row.ownerId,
    name: row.name,
    needSummary: row.needSummary,
    stage: row.stage,
    stageLabel: crmOpportunityStageLabel(row.stage),
    value: crmCurrentOpportunityValue(row),
    currency: row.currency,
    forecast,
    forecastLabel: crmForecastLabel(forecast),
    decisionDate: row.decisionDate?.toISOString() || null,
    nextAction: action ? { ...action, label: crmNextActionLabel(action.type, action.description), dueAt: action.dueAt.toISOString() } : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeActionCard(row: Prisma.CrmNextActionGetPayload<{ select: typeof actionCardSelect }>) {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    industry: row.company.industry,
    kind: row.opportunityId ? "opportunity" as const : "prospect" as const,
    recordId: row.opportunityId || row.prospectId,
    recordName: row.opportunity?.name || crmProspectStatusLabel(row.prospect?.status || "prospecting"),
    stage: row.opportunity?.stage || row.prospect?.status,
    version: row.opportunity?.version ?? row.prospect?.version ?? 0,
    type: row.type,
    label: crmNextActionLabel(row.type, row.description),
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    priority: row.priority,
    owner: row.owner,
    opportunity: row.opportunity ? { value: crmCurrentOpportunityValue(row.opportunity), currency: row.opportunity.currency, decisionDate: row.opportunity.decisionDate?.toISOString() || null } : null
  };
}

function serializeProspectDetail(row: Prisma.CrmProspectGetPayload<{ select: typeof prospectDetailSelect }>) {
  return {
    ...serializeProspectCard(row),
    qualificationSummary: row.qualificationSummary,
    closedReason: row.closedReason,
    initialSnapshot: row.initialSnapshot,
    company: { ...row.company, opportunities: row.company.opportunities.map((opportunity) => ({ ...opportunity, quotedValue: decimalNumber(opportunity.quotedValue), revisedValue: decimalNumber(opportunity.revisedValue), agreedValue: decimalNumber(opportunity.agreedValue), decisionDate: opportunity.decisionDate?.toISOString() || null })) }
  };
}

function serializeOpportunityDetail(row: Prisma.CrmOpportunityGetPayload<{ select: typeof opportunityDetailSelect }>) {
  return {
    ...serializeOpportunityCard(row),
    desiredPeriodStart: row.desiredPeriodStart?.toISOString() || null,
    desiredPeriodEnd: row.desiredPeriodEnd?.toISOString() || null,
    geography: row.geography,
    formats: row.formats,
    budgetStatus: row.budgetStatus,
    budgetMin: decimalNumber(row.budgetMin),
    budgetMax: decimalNumber(row.budgetMax),
    quotedAt: row.quotedAt?.toISOString() || null,
    negotiationAt: row.negotiationAt?.toISOString() || null,
    contractingAt: row.contractingAt?.toISOString() || null,
    wonAt: row.wonAt?.toISOString() || null,
    lostAt: row.lostAt?.toISOString() || null,
    lostReasonCode: row.lostReasonCode,
    lostReason: row.lostReason,
    competitor: row.competitor,
    sourceProspect: row.sourceProspect,
    initialSnapshot: row.initialSnapshot,
    company: { ...row.company, opportunities: row.company.opportunities.map((opportunity) => ({ ...opportunity, quotedValue: decimalNumber(opportunity.quotedValue), revisedValue: decimalNumber(opportunity.revisedValue), agreedValue: decimalNumber(opportunity.agreedValue), decisionDate: opportunity.decisionDate?.toISOString() || null })) }
  };
}

function decimalNumber(value: Prisma.Decimal | null) {
  return value == null ? null : Number(value.toString());
}
