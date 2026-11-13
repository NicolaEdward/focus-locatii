import { Prisma } from "@prisma/client";
import { z } from "zod";
import { commercialHash } from "@/lib/commercial-workbench-core";
import { companyEntityOrThrow } from "@/lib/company-entities";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
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
    ...(opportunity.stage !== "won" ? ["Poți pregăti oferta fără a câștiga oportunitatea. Confirmarea predării finale rămâne disponibilă după câștigare."] : []),
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
    canPrepareOffer: ["opportunity", "quoted", "negotiation", "contracting", "won"].includes(opportunity.stage),
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

const prepareDraftSchema = z.object({
  opportunityId: z.string().trim().min(1).max(191),
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(191),
  currency: z.enum(["RON", "EUR"]),
  companyEntity: z.string().trim().min(1).max(80),
}).strict();

/** Pre-sale association is not a win, an accepted contract or a reservation. */
export async function prepareCrmCommercialDraft(raw: unknown, actor: AuthSession) {
  assertCanManage(actor);
  if (!hasAnyPermission(actor.role, ["clients.manage", "clients.manage.own"])) throw new CrmDomainError("Nu poți pregăti dosarul comercial.", "CRM_FORBIDDEN", 403);
  const input = prepareDraftSchema.parse(raw);
  const companyEntity = companyEntityOrThrow(input.companyEntity);
  const intentHash = commercialHash({ ...input, companyEntity });
  const key = "crm.prepare:" + commercialHash({ actorId: actor.id, requestKey: input.idempotencyKey });
  return prisma.$transaction(async (tx) => {
    await assertLiveDraftActor(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_crm_opportunities WHERE id = ${input.opportunityId} FOR UPDATE`;
    const opportunity = await tx.crmOpportunity.findUnique({
      where: { id: input.opportunityId },
      include: { company: { include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } } } },
    });
    if (!opportunity || (!hasGlobalCrmManageAccess(actor) && opportunity.ownerId !== actor.id)) throw new CrmDomainError("Oportunitatea nu există sau nu îți este alocată.", "CRM_NOT_FOUND", 404);
    const prior = await tx.crmEvent.findUnique({ where: { idempotencyKey: key } });
    if (prior) {
      const metadata = jsonRecord(prior.metadata);
      if (prior.actorUserId !== actor.id || prior.opportunityId !== opportunity.id || metadata.intentHash !== intentHash) throw new CrmDomainError("Cheia a fost folosită pentru o altă pregătire comercială.", "CRM_IDEMPOTENCY_CONFLICT", 409);
      return currentDraftResult(tx, opportunity.id, opportunity.version, metadata, actor, opportunity.ownerId, true);
    }
    if (opportunity.version !== input.version) throw new CrmDomainError("Oportunitatea s-a schimbat. Reîncarcă dosarul înainte de ofertare.", "CRM_VERSION_CONFLICT", 409);
    if (!["opportunity", "quoted", "negotiation", "contracting", "won"].includes(opportunity.stage)) throw new CrmDomainError("Reia explicit oportunitatea înainte de a pregăti o ofertă.", "CRM_STAGE_CONFLICT", 409);
    const seller = await resolveRequiredSalesOwner(actor, opportunity.ownerId, tx);
    const previousDraft = await tx.crmEvent.findFirst({ where: { opportunityId: opportunity.id, type: "COMMERCIAL_DRAFT_PREPARED" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] });
    if (previousDraft) {
      const metadata = jsonRecord(previousDraft.metadata);
      if (metadata.currency !== input.currency || metadata.companyEntity !== companyEntity) throw new CrmDomainError("Dosarul comercial există deja cu alți termeni. Modifică explicit campania existentă.", "CRM_DRAFT_TERMS_CONFLICT", 409);
      const result = await currentDraftResult(tx, opportunity.id, opportunity.version, metadata, actor, seller.id, true);
      // Preserve this second intention too so its later retry cannot be repurposed.
      await createDraftEvent(tx, opportunity, actor, { ...metadata, intentHash }, key);
      return result;
    }
    await tx.$queryRaw`SELECT id FROM portfolio_crm_companies WHERE id = ${opportunity.companyId} FOR UPDATE`;
    const normalizedName = normalizeClientName(opportunity.company.name);
    if (!normalizedName) throw new CrmDomainError("Numele firmei nu poate identifica un client.");
    const taxIds = taxIdSearchValues(opportunity.company.taxId);
    // Serializable protects the indexed identity gap even when no client exists.
    // Other client creation paths cannot insert the same identity during this read.
    const candidates = await tx.clientAccount.findMany({
      where: { mergedIntoClientId: null, status: { notIn: ["merged", "archived"] }, OR: [{ normalizedName }, ...(taxIds.length ? [{ taxId: { in: taxIds } }] : [])] },
      orderBy: { id: "asc" },
    });
    if (candidates.length > 1) throw new CrmDomainError("Există mai mulți clienți posibili. Un manager trebuie să rezolve identitatea înainte de ofertare.", "CRM_DUPLICATE_CLIENT", 409);
    let client = candidates[0];
    if (client) {
      if (client.accountOwnerUserId !== seller.id) throw new CrmDomainError("Clientul există la alt responsabil sau nu este alocat. Cere alocarea explicită, fără a crea un duplicat.", "CRM_CLIENT_OWNER_CONFLICT", 409);
      if (client.taxId && opportunity.company.taxId && !taxIdsMatch(client.taxId, opportunity.company.taxId)) throw new CrmDomainError("Numele corespunde unui client cu alt CUI. Verifică identitatea înainte de ofertare.", "CRM_HANDOFF_TARGET_MISMATCH", 409);
    } else {
      const contact = opportunity.company.contacts[0];
      client = await tx.clientAccount.create({ data: {
        companyName: opportunity.company.name,
        normalizedName,
        taxId: opportunity.company.taxId,
        website: opportunity.company.website,
        generalEmail: contact?.email || null,
        generalPhone: contact?.phone || null,
        accountOwnerUserId: seller.id,
        createdByUserId: actor.id,
        status: "prospect",
      } });
      if (contact) await tx.clientContact.create({ data: { clientId: client.id, name: contact.name, email: contact.email, phone: contact.phone, isPrimary: true } });
      await recordTransactionalAudit(tx, { actor, action: "client.create.from_crm_draft", entityType: "client_account", entityId: client.id, metadata: { opportunityId: opportunity.id } });
    }
    const matches = await tx.campaign.findMany({ where: { clientId: client.id, campaignName: opportunity.name, archivedAt: null, status: { notIn: ["cancelled", "archived"] } }, orderBy: { id: "asc" } });
    if (matches.length > 1) throw new CrmDomainError("Există mai multe campanii cu același nume. Alege și clarifică dosarul existent.", "CRM_DUPLICATE_CAMPAIGN", 409);
    let campaign = matches[0];
    if (campaign && (campaign.sellerUserId !== seller.id || campaign.currency !== input.currency || campaign.companyEntity !== companyEntity)) throw new CrmDomainError("Campania existentă are alt responsabil, monedă sau firmă contractantă. Verifică dosarul existent.", "CRM_DRAFT_TERMS_CONFLICT", 409);
    if (!campaign) {
      campaign = await tx.campaign.create({ data: {
        clientId: client.id, campaignName: opportunity.name, status: "draft", currency: input.currency,
        companyEntity, sellerUserId: seller.id, accountOwnerUserId: seller.id, createdByUserId: actor.id,
        startDate: opportunity.desiredPeriodStart, endDate: opportunity.desiredPeriodEnd,
        totalContractValue: null, paymentTermType: "30_days", paymentTermDays: 30, billingRule: "manual_per_contract", billingFrequency: "monthly",
      } });
      await recordTransactionalAudit(tx, { actor, action: "campaign.create.from_crm_draft", entityType: "campaign", entityId: campaign.id, metadata: { opportunityId: opportunity.id, contractualValue: null } });
    }
    const metadata = { clientId: client.id, campaignId: campaign.id, currency: input.currency, companyEntity, intentHash, crmStageUnchanged: opportunity.stage };
    await createDraftEvent(tx, opportunity, actor, metadata, key);
    return currentDraftResult(tx, opportunity.id, opportunity.version, metadata, actor, seller.id, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
}

async function createDraftEvent(tx: Prisma.TransactionClient, opportunity: { id: string; companyId: string; sourceProspectId: string | null }, actor: AuthSession, metadata: Record<string, unknown>, key: string) {
  const event = await tx.crmEvent.create({ data: { companyId: opportunity.companyId, prospectId: opportunity.sourceProspectId, opportunityId: opportunity.id, actorUserId: actor.id, type: "COMMERCIAL_DRAFT_PREPARED", source: "CRM_COMMERCIAL_DRAFT", summary: "Dosarul pentru ofertare a fost pregătit fără confirmarea vânzării.", metadata: jsonValue(metadata), idempotencyKey: key } });
  await recordTransactionalAudit(tx, { actor, action: "crm.commercial_draft.committed", entityType: "crm_opportunity", entityId: opportunity.id, metadata: { eventId: event.id, clientId: metadata.clientId, campaignId: metadata.campaignId } });
}

async function currentDraftResult(tx: Prisma.TransactionClient, opportunityId: string, version: number, metadata: Record<string, unknown>, actor: AuthSession, ownerId: string | null, repeated: boolean) {
  const clientId = typeof metadata.clientId === "string" ? metadata.clientId : "";
  const campaignId = typeof metadata.campaignId === "string" ? metadata.campaignId : "";
  const campaign = await tx.campaign.findFirst({ where: { id: campaignId, clientId, sellerUserId: ownerId, archivedAt: null, status: { notIn: ["archived", "cancelled"] }, client: { accountOwnerUserId: ownerId, status: { notIn: ["archived", "merged"] } } }, select: { id: true } });
  if (!campaign || (!hasGlobalCrmManageAccess(actor) && ownerId !== actor.id)) throw new CrmDomainError("Portofoliul dosarului s-a schimbat. Reîncarcă și verifică alocarea.", "CRM_DRAFT_PORTFOLIO_CHANGED", 409);
  const params = new URLSearchParams({ clientId, campaignId, opportunityId });
  return { clientId, campaignId, opportunityId, version, repeated, href: "/admin/commercial-quotes?" + params };
}

async function assertLiveDraftActor(tx: Prisma.TransactionClient, actor: AuthSession) {
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
  if (!current?.active || current.role !== actor.role || current.tokenVersion !== actor.tokenVersion || actor.exp * 1000 <= Date.now()) throw new CrmDomainError("Sesiunea sau drepturile s-au schimbat.", "CRM_ACTOR_STALE", 403);
  if (actor.sessionId) {
    await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
    if (!await tx.authSessionRecord.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw new CrmDomainError("Sesiunea a fost revocată.", "CRM_ACTOR_STALE", 403);
  }
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
