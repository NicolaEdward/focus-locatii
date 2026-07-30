import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import { crmCurrentOpportunityValue } from "@/lib/crm-domain";
import { CrmDomainError, hasGlobalCrmAccess } from "@/lib/crm-domain-service";
import type { CrmHandoffProposal, CrmHandoffTargetType } from "@/lib/crm-handoff-contract";
import { prisma } from "@/lib/prisma";
import { hasAnyPermission } from "@/lib/rbac";
import { taxIdSearchValues, taxIdsMatch } from "@/lib/tax-id";

export async function getCrmHandoffProposal(opportunityId: string, actor: AuthSession): Promise<CrmHandoffProposal> {
  assertCanView(actor);
  const opportunity = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, ...(hasGlobalCrmAccess(actor) ? {} : { ownerId: actor.id }) },
    select: {
      id: true,
      version: true,
      stage: true,
      name: true,
      desiredPeriodStart: true,
      desiredPeriodEnd: true,
      currency: true,
      quotedValue: true,
      revisedValue: true,
      agreedValue: true,
      owner: { select: { id: true, name: true } },
      company: {
        select: {
          name: true,
          taxId: true,
          industry: true,
          website: true,
          contacts: {
            select: { name: true, email: true, phone: true },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1
          }
        }
      }
    }
  });
  if (!opportunity) throw new CrmDomainError("Oportunitatea nu exista sau nu iti este alocata.", "CRM_NOT_FOUND", 404);

  const normalizedName = normalizeClientName(opportunity.company.name);
  const taxIds = taxIdSearchValues(opportunity.company.taxId);
  const existingClient = await prisma.clientAccount.findFirst({
    where: {
      mergedIntoClientId: null,
      status: { notIn: ["merged", "archived"] },
      OR: [
        { normalizedName },
        ...(taxIds.length ? [{ taxId: { in: taxIds } }] : [])
      ]
    },
    select: { id: true, companyName: true, accountOwnerUserId: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
  });
  const existingCampaign = existingClient
    ? await prisma.campaign.findFirst({
        where: { clientId: existingClient.id, campaignName: opportunity.name, archivedAt: null },
        select: { id: true, campaignName: true, clientId: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
      })
    : null;
  const contact = opportunity.company.contacts[0] || null;
  const warnings = [
    ...(opportunity.stage !== "won" ? ["Handoff-ul devine disponibil numai dupa castigarea oportunitatii."] : []),
    ...(!opportunity.company.taxId ? ["Firma CRM nu are CUI; verifica manual deduplicarea clientului."] : []),
    ...(!contact ? ["Firma CRM nu are persoana de contact."] : []),
    ...(!hasGlobalCrmAccess(actor) && existingClient?.accountOwnerUserId !== actor.id
      ? ["Clientul existent nu iti este alocat. Un manager trebuie sa confirme predarea fara a crea un duplicat."]
      : [])
  ];

  return {
    opportunityId: opportunity.id,
    version: opportunity.version,
    ready: opportunity.stage === "won",
    stage: opportunity.stage,
    company: {
      name: opportunity.company.name,
      taxId: opportunity.company.taxId,
      industry: opportunity.company.industry,
      website: opportunity.company.website,
      primaryContact: contact
    },
    campaign: {
      name: opportunity.name,
      startDate: isoDate(opportunity.desiredPeriodStart),
      endDate: isoDate(opportunity.desiredPeriodEnd),
      currency: opportunity.currency,
      totalContractValue: crmCurrentOpportunityValue(opportunity)
    },
    owner: opportunity.owner,
    existingClient,
    existingCampaign,
    warnings
  };
}

export async function recordCrmHandoff(input: {
  opportunityId: string;
  version: number;
  targetType: CrmHandoffTargetType;
  targetId: string;
  idempotencyKey: string;
}, actor: AuthSession) {
  assertCanManage(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.crmEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, opportunityId: true, metadata: true }
    });
    if (existing) {
      if (existing.opportunityId !== input.opportunityId) throw new CrmDomainError("Cheia idempotenta a fost folosita pentru alta oportunitate.", "CRM_IDEMPOTENCY_CONFLICT", 409);
      const metadata = jsonRecord(existing.metadata);
      if (metadata.targetType !== input.targetType || metadata.targetId !== input.targetId) {
        throw new CrmDomainError("Cheia idempotenta a fost folosita pentru alta tinta.", "CRM_IDEMPOTENCY_CONFLICT", 409);
      }
      return { eventId: existing.id, repeated: true };
    }
    const opportunity = await tx.crmOpportunity.findFirst({
      where: {
        id: input.opportunityId,
        version: input.version,
        stage: "won",
        ...(hasGlobalCrmManageAccess(actor) ? {} : { ownerId: actor.id })
      },
      select: { id: true, companyId: true, sourceProspectId: true, ownerId: true, company: { select: { name: true, taxId: true } } }
    });
    if (!opportunity) throw new CrmDomainError("Oportunitatea nu mai este castigata, a fost modificata sau nu iti este alocata.", "CRM_VERSION_CONFLICT", 409);

    const target = await resolveTarget(tx, input.targetType, input.targetId, actor, opportunity);
    const event = await tx.crmEvent.create({
      data: {
        companyId: opportunity.companyId,
        prospectId: opportunity.sourceProspectId,
        opportunityId: opportunity.id,
        actorUserId: actor.id,
        type: input.targetType === "client_account" ? "CLIENT_ACCOUNT_HANDOFF_CONFIRMED" : "CAMPAIGN_HANDOFF_CONFIRMED",
        source: "CRM_HANDOFF",
        summary: input.targetType === "client_account" ? "Clientul rezultat a fost confirmat explicit." : "Campania rezultata a fost confirmata explicit.",
        metadata: jsonValue({ targetType: input.targetType, targetId: input.targetId, clientId: target.clientId }),
        idempotencyKey: input.idempotencyKey
      }
    });
    return { eventId: event.id, repeated: false };
  });
}

async function resolveTarget(
  tx: Prisma.TransactionClient,
  targetType: CrmHandoffTargetType,
  targetId: string,
  actor: AuthSession,
  opportunity: { id: string; ownerId: string | null; company: { name: string; taxId: string | null } }
) {
  if (targetType === "client_account") {
    const client = await tx.clientAccount.findFirst({
      where: { id: targetId, mergedIntoClientId: null },
      select: { id: true, companyName: true, taxId: true, accountOwnerUserId: true }
    });
    if (!client) throw new CrmDomainError("Clientul selectat nu exista.", "CRM_HANDOFF_TARGET_MISSING", 404);
    assertTargetOwnership(actor, opportunity.ownerId, client.accountOwnerUserId);
    const sameCompany = normalizeClientName(client.companyName) === normalizeClientName(opportunity.company.name);
    const sameTaxId = taxIdsMatch(client.taxId, opportunity.company.taxId);
    if (!sameCompany && !sameTaxId) {
      throw new CrmDomainError("Clientul selectat nu corespunde firmei din oportunitate.", "CRM_HANDOFF_TARGET_MISMATCH", 409);
    }
    return { clientId: client.id };
  }
  const campaign = await tx.campaign.findFirst({
    where: { id: targetId, archivedAt: null },
    select: { id: true, clientId: true, sellerUserId: true, accountOwnerUserId: true }
  });
  if (!campaign) throw new CrmDomainError("Campania selectata nu exista.", "CRM_HANDOFF_TARGET_MISSING", 404);
  assertTargetOwnership(actor, opportunity.ownerId, campaign.sellerUserId || campaign.accountOwnerUserId);
  const clientHandoffs = await tx.crmEvent.findMany({
    where: { opportunityId: opportunity.id, type: "CLIENT_ACCOUNT_HANDOFF_CONFIRMED" },
    select: { metadata: true },
    take: 20
  });
  if (!clientHandoffs.some((event) => jsonRecord(event.metadata).targetId === campaign.clientId)) {
    throw new CrmDomainError("Confirma mai intai clientul rezultat din oportunitate.", "CRM_HANDOFF_CLIENT_REQUIRED", 409);
  }
  return { clientId: campaign.clientId };
}

function assertTargetOwnership(actor: AuthSession, opportunityOwnerId: string | null, targetOwnerId: string | null) {
  if (hasGlobalCrmManageAccess(actor)) return;
  if (opportunityOwnerId !== actor.id || targetOwnerId !== actor.id) {
    throw new CrmDomainError("Poti confirma doar clientii si campaniile proprii.", "CRM_FORBIDDEN", 403);
  }
}

function hasGlobalCrmManageAccess(actor: AuthSession) {
  return hasAnyPermission(actor.role, ["leads.manage"]);
}

function assertCanView(actor: AuthSession) {
  if (!hasAnyPermission(actor.role, ["leads.view", "leads.view.own"])) throw new CrmDomainError("Nu ai acces la CRM.", "CRM_FORBIDDEN", 403);
}

function assertCanManage(actor: AuthSession) {
  if (!hasAnyPermission(actor.role, ["leads.manage", "leads.manage.own"])) {
    throw new CrmDomainError("Nu poti confirma handoff-ul acestei oportunitati.", "CRM_FORBIDDEN", 403);
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isoDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) || null;
}
