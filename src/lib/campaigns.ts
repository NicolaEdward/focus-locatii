import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";
import { paymentTermDays } from "@/lib/billing";
import { companyEntityOrDefault, companyEntityOrThrow } from "@/lib/company-entities";
import { effectiveBlockingReservationWhere } from "@/lib/reservation-lifecycle";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";

const optionalText = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return text || null;
}, z.string().nullable().optional());

const optionalDate = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}, z.date().nullable().optional());

const optionalMoney = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}, z.number().nonnegative().nullable().optional());

const optionalInt = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}, z.number().int().nullable().optional());

export const campaignInputSchema = z.object({
  clientId: z.string().trim().min(1),
  campaignName: z.string().trim().min(2).max(191),
  campaignCode: optionalText,
  status: z.string().trim().max(80).optional(),
  campaignType: z.enum(["direct_client", "agency"]).optional(),
  agencyClientId: optionalText,
  endClientId: optionalText,
  sellerUserId: optionalText,
  accountOwnerUserId: optionalText,
  companyEntity: optionalText,
  startDate: optionalDate,
  endDate: optionalDate,
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  totalContractValue: optionalMoney,
  paymentTermType: optionalText,
  paymentTermDays: optionalInt,
  customPaymentTermNote: optionalText,
  billingRule: optionalText,
  billingFrequency: optionalText,
  billingNotes: optionalText,
  notes: optionalText
});

export async function createCampaign(input: unknown, actor: AuthSession) {
  const parsed = normalizeCampaignForCreate(campaignInputSchema.parse(input), actor);
  const client = await prisma.clientAccount.findUnique({ where: { id: parsed.clientId } });
  if (!client || ["archived", "merged"].includes(client.status)) {
    throw new Error("Campania trebuie legata de un client activ.");
  }
  if (actor.role === "SALES_AGENT" && client.accountOwnerUserId && client.accountOwnerUserId !== actor.id) {
    throw new Error("Poti crea campanii doar pentru clientii tai.");
  }
  const seller = await resolveRequiredSalesOwner(actor, parsed.sellerUserId);
  const owner = parsed.accountOwnerUserId
    ? await resolveRequiredSalesOwner(actor, parsed.accountOwnerUserId)
    : seller;
  return prisma.campaign.create({
    data: {
      ...parsed,
      createdByUserId: actor.id,
      accountOwnerUserId: owner.id,
      sellerUserId: seller.id
    }
  });
}

export async function updateCampaign(id: string, input: unknown, actor: AuthSession) {
  const parsed = normalizeCampaignForUpdate(campaignInputSchema.partial().parse(input));
  const existing = await prisma.campaign.findUnique({ where: { id }, include: { client: true } });
  if (!existing) throw new Error("Campania nu exista.");
  assertCanMutateCampaign(existing, actor);
  if (parsed.clientId && parsed.clientId !== existing.clientId) {
    const activeRentals = await prisma.reservation.count({ where: { campaignId: id, ...effectiveBlockingReservationWhere() } });
    if (activeRentals > 0) {
      throw new Error("Nu poti schimba clientul unei campanii cu inchirieri sau hold-uri active. Muta/anuleaza intai inregistrarile legate.");
    }
  }
  if (actor.role === "SALES_AGENT" && parsed.sellerUserId && parsed.sellerUserId !== actor.id) {
    throw new Error("Agentul poate pastra campania doar pe numele lui.");
  }
  if (actor.role === "SALES_AGENT" && parsed.accountOwnerUserId && parsed.accountOwnerUserId !== actor.id) {
    throw new Error("Agentul poate seta ca owner doar propriul cont.");
  }
  if (parsed.sellerUserId !== undefined && parsed.sellerUserId !== existing.sellerUserId) {
    await resolveRequiredSalesOwner(actor, parsed.sellerUserId);
  }
  if (parsed.accountOwnerUserId !== undefined && parsed.accountOwnerUserId !== existing.accountOwnerUserId) {
    await resolveRequiredSalesOwner(actor, parsed.accountOwnerUserId);
  }
  if (parsed.clientId && parsed.clientId !== existing.clientId) {
    const client = await prisma.clientAccount.findUnique({ where: { id: parsed.clientId } });
    if (!client || ["archived", "merged"].includes(client.status)) {
      throw new Error("Noul client al campaniei nu este activ.");
    }
  }
  return prisma.campaign.update({
    where: { id },
    data: parsed
  });
}

export async function archiveCampaign(id: string, actor: AuthSession) {
  const existing = await prisma.campaign.findUnique({ where: { id }, include: { client: true } });
  if (!existing) throw new Error("Campania nu exista.");
  assertCanMutateCampaign(existing, actor);
  const activeRentals = await prisma.reservation.count({ where: { campaignId: id, ...effectiveBlockingReservationWhere() } });
  if (activeRentals > 0) {
    throw new Error("Campania are inchirieri/hold-uri active. Anuleaza-le sau muta-le inainte de arhivare.");
  }
  return prisma.campaign.update({
    where: { id },
    data: { status: "archived", archivedAt: new Date() }
  });
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
  const paymentDays = paymentTermDays(input.paymentTermType || "30_days", input.paymentTermDays ?? null);
  return {
    ...input,
    status: input.status || "draft",
    campaignType: input.campaignType || "direct_client",
    companyEntity: companyEntityOrDefault(input.companyEntity),
    currency: input.currency || "EUR",
    paymentTermType: input.paymentTermType || "30_days",
    paymentTermDays: paymentDays,
    billingRule: input.billingRule || "manual_per_contract",
    billingFrequency: input.billingFrequency || "monthly",
    sellerUserId: input.sellerUserId || (["SALES_AGENT", "SALES_DIRECTOR"].includes(actor.role) ? actor.id : null),
    accountOwnerUserId: input.accountOwnerUserId || input.sellerUserId || (["SALES_AGENT", "SALES_DIRECTOR"].includes(actor.role) ? actor.id : null)
  };
}

function normalizeCampaignForUpdate(input: Partial<z.infer<typeof campaignInputSchema>>) {
  const next = { ...input };
  if (input.companyEntity !== undefined) next.companyEntity = companyEntityOrThrow(input.companyEntity);
  if (input.paymentTermType !== undefined || input.paymentTermDays !== undefined) {
    next.paymentTermDays = paymentTermDays(input.paymentTermType || "30_days", input.paymentTermDays ?? null);
  }
  return next;
}
