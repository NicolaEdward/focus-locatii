import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";

export function normalizeClientName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?r\.?l\.?|s\.?a\.?|ltd|llc|eood|srl|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeInvoiceNumber(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(factura|fact|nr|numar|number|invoice|inv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export type ClientOwnershipCheckInput = {
  id: string;
  accountOwnerUserId: string | null;
};

export function hasClientOwnershipConflict(
  client: ClientOwnershipCheckInput | null | undefined,
  actor?: AuthSession | null
) {
  if (!client || !actor || !["SALES_AGENT", "SALES_DIRECTOR"].includes(actor.role)) return false;
  return Boolean(client.accountOwnerUserId && client.accountOwnerUserId !== actor.id);
}

export async function findExistingClientAccountByNormalizedName(companyName: string) {
  const normalizedName = normalizeClientName(companyName);
  const existing = await prisma.clientAccount.findFirst({
    where: {
      normalizedName,
      status: { notIn: ["merged", "archived"] }
    },
    orderBy: [{ updatedAt: "desc" }]
  });
  if (existing) return existing;

  const merged = await prisma.clientAccount.findFirst({
    where: { normalizedName, status: "merged", mergedIntoClientId: { not: null } },
    select: { mergedIntoClientId: true }
  });
  if (!merged?.mergedIntoClientId) return null;
  return prisma.clientAccount.findUnique({ where: { id: merged.mergedIntoClientId } });
}

export async function findOrCreateClientAccount(input: {
  clientId?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  accountOwnerUserId?: string | null;
}, actor?: AuthSession | null) {
  if (input.clientId) {
    const existing = await prisma.clientAccount.findUnique({ where: { id: input.clientId } });
    if (existing) return existing;
  }
  const companyName = (input.companyName || input.contactName || "").trim();
  if (!companyName) return null;
  const normalizedName = normalizeClientName(companyName);
  const existing = await findExistingClientAccountByNormalizedName(companyName);
  if (existing) return existing;

  const client = await prisma.clientAccount.create({
    data: {
      companyName,
      normalizedName,
      generalEmail: input.email || null,
      generalPhone: input.phone || null,
      accountOwnerUserId: input.accountOwnerUserId || actor?.id || null,
      createdByUserId: actor?.id || null,
      status: "active"
    }
  });

  if (input.contactName && input.contactName !== companyName) {
    await prisma.clientContact.create({
      data: {
        clientId: client.id,
        name: input.contactName,
        email: input.email || null,
        phone: input.phone || null,
        isPrimary: true
      }
    });
  }
  return client;
}

export async function validAccountOwners() {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR", "COO", "SUPER_ADMIN"] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }]
  });
}

export async function mergeClientAccounts(input: {
  primaryClientId: string;
  duplicateClientId: string;
}, actor?: AuthSession | null) {
  assertClientMergeAllowed(actor);
  if (input.primaryClientId === input.duplicateClientId) {
    throw new Error("Alege doi clienti diferiti.");
  }

  return prisma.$transaction(async (tx) => {
    const [primary, duplicate] = await Promise.all([
      tx.clientAccount.findUnique({ where: { id: input.primaryClientId } }),
      tx.clientAccount.findUnique({ where: { id: input.duplicateClientId } })
    ]);
    if (!primary || !duplicate) {
      throw new Error("Unul dintre clienti nu exista.");
    }

    const duplicateCampaigns = await tx.campaign.findMany({
      where: { clientId: duplicate.id },
      select: { id: true }
    });
    const duplicateCampaignIds = duplicateCampaigns.map((campaign) => campaign.id);
    const reservationWhere: Prisma.ReservationWhereInput = {
      OR: [
        { clientId: duplicate.id },
        ...(duplicateCampaignIds.length ? [{ campaignId: { in: duplicateCampaignIds } }] : [])
      ]
    };
    const reservationsToRelink = await tx.reservation.findMany({
      where: reservationWhere,
      select: { id: true }
    });
    const reservationIds = reservationsToRelink.map((reservation) => reservation.id);

    const campaigns = await tx.campaign.updateMany({
      where: { clientId: duplicate.id },
      data: { clientId: primary.id }
    });
    const agencyCampaigns = await tx.campaign.updateMany({
      where: { agencyClientId: duplicate.id },
      data: { agencyClientId: primary.id }
    });
    const endClientCampaigns = await tx.campaign.updateMany({
      where: { endClientId: duplicate.id },
      data: { endClientId: primary.id }
    });
    const reservations = reservationIds.length
      ? await tx.reservation.updateMany({
          where: { id: { in: reservationIds } },
          data: {
            clientId: primary.id,
            clientName: primary.companyName,
            clientCompany: primary.companyName,
            clientEmail: primary.generalEmail,
            clientPhone: primary.generalPhone
          }
        })
      : { count: 0 };
    const billingItems = await tx.billingItem.updateMany({
      where: {
        OR: [
          { clientId: duplicate.id },
          ...(reservationIds.length ? [{ reservationId: { in: reservationIds } }] : [])
        ]
      },
      data: { clientId: primary.id }
    });
    const receivables = await tx.financialReceivable.updateMany({
      where: {
        OR: [
          { clientId: duplicate.id },
          ...(duplicateCampaignIds.length ? [{ campaignId: { in: duplicateCampaignIds } }] : [])
        ]
      },
      data: { clientId: primary.id, accountOwnerUserId: primary.accountOwnerUserId }
    });
    const crmLeads = await tx.crmLead.updateMany({ where: { clientId: duplicate.id }, data: { clientId: primary.id } });
    const contacts = await tx.clientContact.updateMany({ where: { clientId: duplicate.id }, data: { clientId: primary.id } });
    const documents = await tx.clientDocument.updateMany({
      where: {
        OR: [
          { clientId: duplicate.id },
          ...(duplicateCampaignIds.length ? [{ campaignId: { in: duplicateCampaignIds } }] : []),
          ...(reservationIds.length ? [{ reservationId: { in: reservationIds } }] : [])
        ]
      },
      data: { clientId: primary.id }
    });
    await tx.clientAccount.update({
      where: { id: duplicate.id },
      data: {
        status: "merged",
        mergedIntoClientId: primary.id,
        mergedAt: new Date(),
        aliases: [duplicate.companyName, duplicate.normalizedName].filter(Boolean)
      }
    });

    return {
      primary,
      duplicate,
      counts: {
        campaigns: campaigns.count,
        agencyCampaigns: agencyCampaigns.count,
        endClientCampaigns: endClientCampaigns.count,
        reservations: reservations.count,
        billingItems: billingItems.count,
        receivables: receivables.count,
        crmLeads: crmLeads.count,
        contacts: contacts.count,
        documents: documents.count
      }
    };
  });
}

export function assertClientMergeAllowed(actor?: AuthSession | null) {
  if (!actor || !["COO", "SUPER_ADMIN"].includes(actor.role)) {
    throw new Error("Doar COO sau SUPER_ADMIN pot combina clienti.");
  }
}
