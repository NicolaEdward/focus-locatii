import { z } from "zod";
import { Prisma } from "@prisma/client";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { bucharestDateKey } from "@/lib/campaigns/campaign-effective-status";
import { prisma } from "@/lib/prisma";
import { ClientMutationError, withAuthorizedClientMutation } from "@/lib/clients";
import type { AuthSession } from "@/lib/auth";
import { paymentTermDays, paymentTermOptions, billingRules, billingFrequencies } from "@/lib/billing";
import {
  CAMPAIGN_STATUSES,
  assertCampaignStatusForCreate,
  assertCampaignStatusTransition,
  parseCampaignStatus
} from "@/lib/campaign-state";
import { companyEntityOrDefault, companyEntityOrThrow } from "@/lib/company-entities";
import { effectiveBlockingReservationWhere } from "@/lib/reservation-lifecycle";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";
import { canDefaultSalesOwnerToActor } from "@/lib/sales-roles";
import { assertCampaignParties, campaignPartyFingerprint, campaignPartyIds, resolveCampaignParties } from "@/lib/campaign-parties";

const optionalText = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return text || null;
}, z.string().nullable().optional());

const optionalInt = z.preprocess((value) => {
  if (value == null || value === "") return null;
  return Number(value);
}, z.number().int().min(0).max(3650).nullable().optional());

export const campaignInputSchema = z.object({
  clientId: z.string().trim().min(1),
  campaignName: z.string().trim().min(2).max(191),
  campaignCode: optionalText,
  currency: z.enum(["RON", "EUR"]).optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  campaignType: z.enum(["direct_client", "agency"]).optional(),
  agencyClientId: optionalText,
  endClientId: optionalText,
  sellerUserId: optionalText,
  accountOwnerUserId: optionalText,
  companyEntity: optionalText,
  paymentTermType: z.preprocess((value) => value === "" ? null : value, z.enum(paymentTermOptions).nullable().optional()),
  paymentTermDays: optionalInt,
  customPaymentTermNote: optionalText,
  billingRule: z.preprocess((value) => value === "" ? null : value, z.enum(billingRules).nullable().optional()),
  billingFrequency: z.preprocess((value) => value === "" ? null : value, z.enum(billingFrequencies).nullable().optional()),
  billingNotes: optionalText,
  notes: optionalText
});

export async function createCampaign(input: unknown, actor: AuthSession) {
  const parsed = normalizeCampaignForCreate(campaignInputSchema.parse(input), actor);
  assertCampaignStatusForCreate(parsed.status);
  const parties = resolveCampaignParties(parsed);
  return withAuthorizedClientMutation(actor, campaignPartyIds(parties), async (tx, currentActor) => {
    assertCampaignActor(currentActor);
    await assertCampaignParties(tx, parties, currentActor);
    const client = await tx.clientAccount.findUnique({ where: { id: parsed.clientId } });
    if (!client || ["archived", "merged"].includes(client.status)) throw new Error("Campania trebuie legata de un client activ.");
    if (currentActor.role === "SALES_AGENT" && client.accountOwnerUserId !== currentActor.id)
      throw new Error("Poti crea campanii doar pentru clientii tai. Un manager trebuie sa aloce mai intai clientul fara responsabil.");
    const seller = await resolveRequiredSalesOwner(currentActor, parsed.sellerUserId, tx);
    const owner = parsed.accountOwnerUserId ? await resolveRequiredSalesOwner(currentActor, parsed.accountOwnerUserId, tx) : seller;
    const campaign = await tx.campaign.create({ data: { ...parsed, createdByUserId: currentActor.id, accountOwnerUserId: owner.id, sellerUserId: seller.id } });
    await recordTransactionalAudit(tx, { actor: currentActor, action: "campaign.create.committed", entityType: "campaign", entityId: campaign.id, metadata: { clientId: campaign.clientId, currency: campaign.currency } });
    return campaign;
  });
}

export async function updateCampaign(id: string, input: unknown, actor: AuthSession) {
  const parsed = normalizeCampaignForUpdate(campaignInputSchema.partial().parse(input));
  // Collect every party before locking the campaign, preserving the common
  // actor -> sorted clients -> campaign lock order. Recheck the snapshot under
  // the lock so a concurrent reassociation cannot introduce an unlocked party.
  const snapshot = await prisma.campaign.findUnique({ where: { id }, select: { clientId: true, campaignType: true, agencyClientId: true, endClientId: true } });
  const nextParties = resolveCampaignParties(parsed, snapshot || undefined);
  const partyIds = [...campaignPartyIds(nextParties), ...(snapshot ? campaignPartyIds(snapshot) : [])];
  return withAuthorizedClientMutation(actor, partyIds, async (tx, currentActor) => {
    assertCampaignActor(currentActor);
    await tx.$queryRaw`SELECT id FROM portfolio_campaigns WHERE id = ${id} FOR UPDATE`;
    const existing = await tx.campaign.findUnique({ where: { id }, include: { client: true } });
    if (!existing) throw new Error("Campania nu exista.");
    assertCanMutateCampaign(existing, currentActor);
    if (!snapshot || campaignPartyFingerprint(snapshot) !== campaignPartyFingerprint(existing)) {
      throw new ClientMutationError("Părțile campaniei au fost modificate simultan. Reîncarcă dosarul înainte să salvezi.", 409);
    }
    const relationshipChanged = campaignPartyFingerprint(nextParties) !== campaignPartyFingerprint(existing);
    if (relationshipChanged) await assertCampaignParties(tx, nextParties, currentActor);
    if (parsed.status !== undefined) {
      if (parsed.status === "archived") throw new Error("Foloseste actiunea dedicata de arhivare pentru a verifica inchirierile active.");
      parsed.status = assertCampaignStatusTransition(existing.status, parsed.status);
      if (parsed.status !== existing.status && ["cancelled", "completed"].includes(parsed.status)) {
        const today = new Date(bucharestDateKey() + "T00:00:00.000Z");
        const blockers = await tx.reservation.count({ where: { campaignId: id, ...effectiveBlockingReservationWhere(), periodEnd: { gte: today } } });
        if (blockers) throw new ClientMutationError("Campania are închirieri sau hold-uri curente ori viitoare. Rezolvă explicit anularea sau mutarea lor înainte de a anula ori finaliza campania; istoricul nu se șterge.", 409);
      }
    }
    if (parsed.clientId && parsed.clientId !== existing.clientId) {
      if (await tx.reservation.count({ where: { campaignId: id, ...effectiveBlockingReservationWhere() } }))
        throw new Error("Nu poti schimba clientul unei campanii cu inchirieri sau hold-uri active. Muta/anuleaza intai inregistrarile legate.");
      const client = await tx.clientAccount.findUnique({ where: { id: parsed.clientId } });
      if (!client || ["archived", "merged"].includes(client.status)) throw new Error("Noul client al campaniei nu este activ.");
      if (currentActor.role === "SALES_AGENT" && client.accountOwnerUserId !== currentActor.id) throw new Error("Noul client trebuie sa apartina portofoliului tau.");
    }
    if (parsed.sellerUserId !== undefined && parsed.sellerUserId !== existing.sellerUserId) await resolveRequiredSalesOwner(currentActor, parsed.sellerUserId, tx);
    if (parsed.accountOwnerUserId !== undefined && parsed.accountOwnerUserId !== existing.accountOwnerUserId) await resolveRequiredSalesOwner(currentActor, parsed.accountOwnerUserId, tx);
    if (parsed.currency !== undefined && parsed.currency !== existing.currency) {
      const reservations = await tx.reservation.findMany({ where: { campaignId: id, status: "BOOKED" }, select: { currency: true, priceSegments: { select: { currency: true } } } });
      if (reservations.some((row) => row.currency !== parsed.currency || row.priceSegments.some((segment) => segment.currency !== parsed.currency)))
        throw new Error("Moneda trebuie sa corespunda inchirierilor confirmate si istoricului de pret. Pentru conversie este necesar un act aditional verificat.");
    }
    const campaign = await tx.campaign.update({ where: { id }, data: parsed });
    await recordTransactionalAudit(tx, { actor: currentActor, action: "campaign.update.committed", entityType: "campaign", entityId: id, metadata: { changedFields: Object.keys(parsed), currency: campaign.currency, ...(relationshipChanged ? { parties: { before: resolveCampaignParties(existing), after: nextParties } } : {}) } });
    return campaign;
  });
}

function assertCampaignActor(actor: AuthSession) {
  if (!["COO", "SUPER_ADMIN", "SALES_DIRECTOR", "SALES_AGENT"].includes(actor.role)) throw new Error("Nu ai permisiunea sa modifici campanii.");
}

export async function archiveCampaign(id: string, actor: AuthSession) {
  return prisma.$transaction(async (tx) => {
    // Serialize archival with BOOKED creation/update: both lock the campaign
    // before validating its live state. Historical sales remain intact.
    await tx.$queryRaw`SELECT id FROM portfolio_campaigns WHERE id = ${id} FOR UPDATE`;
    const existing = await tx.campaign.findUniqueOrThrow({ where: { id }, include: { client: true } });
    assertCanMutateCampaign(existing, actor);
    assertCampaignStatusTransition(existing.status, "archived");
    const today = new Date(bucharestDateKey() + "T00:00:00.000Z");
    const activeRentals = await tx.reservation.count({ where: {
      campaignId: id,
      ...effectiveBlockingReservationWhere(),
      periodEnd: { gte: today }
    } });
    if (activeRentals > 0) throw new Error("Campania are inchirieri/hold-uri curente sau viitoare. Anuleaza-le sau muta-le inainte de arhivare.");
    const campaign = await tx.campaign.update({ where: { id }, data: { status: "archived", archivedAt: new Date() } });
    await recordTransactionalAudit(tx, { actor, action: "campaign.archive.committed", entityType: "campaign", entityId: id });
    return campaign;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 });
}

function assertCanMutateCampaign(
  campaign: {
    sellerUserId: string | null;
    accountOwnerUserId: string | null;
    client: { accountOwnerUserId: string | null };
  },
  actor: AuthSession
) {
  if (["COO", "SUPER_ADMIN", "SALES_DIRECTOR"].includes(actor.role)) return;
  if (actor.role === "SALES_AGENT" && campaign.client.accountOwnerUserId !== actor.id && campaign.sellerUserId !== actor.id && campaign.accountOwnerUserId !== actor.id) {
    throw new Error("Poti edita doar campaniile tale.");
  }
  if (actor.role === "SALES_AGENT") return;
  throw new Error("Nu ai permisiunea sa modifici aceasta campanie.");
}

function normalizeCampaignForCreate(input: z.infer<typeof campaignInputSchema>, actor: AuthSession) {
  if (input.paymentTermType === "custom" && input.paymentTermDays == null) throw new Error("Completează numărul de zile pentru termenul de plată personalizat.");
  const paymentDays = input.paymentTermDays != null ? input.paymentTermDays : input.paymentTermType ? paymentTermDays(input.paymentTermType, null) : null;
  return {
    ...input,
    status: parseCampaignStatus(input.status || "draft"),
    campaignType: input.campaignType || "direct_client",
    companyEntity: companyEntityOrDefault(input.companyEntity),
    paymentTermType: input.paymentTermType || (input.paymentTermDays != null ? "custom" : null),
    paymentTermDays: paymentDays,
    billingRule: input.billingRule || null,
    billingFrequency: input.billingFrequency || null,
    sellerUserId: input.sellerUserId || (canDefaultSalesOwnerToActor(actor.role) ? actor.id : null),
    accountOwnerUserId: input.accountOwnerUserId || input.sellerUserId || (canDefaultSalesOwnerToActor(actor.role) ? actor.id : null)
  };
}

function normalizeCampaignForUpdate(input: Partial<z.infer<typeof campaignInputSchema>>) {
  const next = { ...input };
  if (input.companyEntity !== undefined) next.companyEntity = companyEntityOrThrow(input.companyEntity);
  if (input.paymentTermDays !== undefined && input.paymentTermType === undefined) next.paymentTermType = input.paymentTermDays == null ? null : "custom";
  if (input.paymentTermType && input.paymentTermType !== "custom" && input.paymentTermDays === undefined) next.paymentTermDays = paymentTermDays(input.paymentTermType, null);
  return next;
}
