import type { Prisma, ClientAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";

export class ClientMutationError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}

export async function lockClientAccounts(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT id FROM portfolio_client_accounts WHERE id = ${id} FOR UPDATE`;
  }
}

/** Revalidate the authenticated principal and locked portfolio in the write transaction. */
export async function withAuthorizedClientMutation<T>(
  actor: AuthSession | null | undefined,
  clientIds: string[],
  command: (tx: Prisma.TransactionClient, actor: AuthSession) => Promise<T>
) {
  if (!actor) throw new ClientMutationError("Autentificare necesara.", 401);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!current?.active || current.role !== actor.role || current.tokenVersion !== actor.tokenVersion) {
      throw new ClientMutationError("Datele contului s-au schimbat. Reia autentificarea.", 401);
    }
    if (!hasAnyPermission(actor.role, ["clients.manage", "clients.manage.own"])) {
      throw new ClientMutationError("Nu ai permisiunea necesara.");
    }
    if (actor.sessionId) {
      await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
      if (!await tx.authSessionRecord.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) {
        throw new ClientMutationError("Sesiunea a fost revocata. Reia autentificarea.", 401);
      }
    }
    await lockClientAccounts(tx, clientIds);
    return command(tx, actor);
  }, { isolationLevel: "ReadCommitted" });
}

export function assertClientEditable(client: { accountOwnerUserId: string | null; status: string }, actor: AuthSession) {
  if (client.status === "merged") throw new ClientMutationError("Clientul a fost combinat. Actualizeaza lista clientilor.", 409);
  if (actor.role === "SALES_AGENT" && client.accountOwnerUserId !== actor.id) {
    throw new ClientMutationError("Poti edita doar clientii tai.");
  }
}

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

export function invoiceNumberComparisonKey(value?: string | null) {
  const normalized = normalizeInvoiceNumber(value);
  const match = normalized.match(/^([a-z]+)0*(\d+)$/);
  if (!match) return normalized;
  const numericPart = match[2].replace(/^0+(?=\d)/, "");
  return `${match[1]}${numericPart}`;
}

export function invoiceNumbersEquivalent(left?: string | null, right?: string | null) {
  const leftKey = invoiceNumberComparisonKey(left);
  const rightKey = invoiceNumberComparisonKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function invoiceNumberLookupVariants(value?: string | null) {
  return Array.from(new Set([
    normalizeInvoiceNumber(value),
    invoiceNumberComparisonKey(value)
  ].filter(Boolean)));
}

export function invoiceNumberLookupPrefix(value?: string | null) {
  return invoiceNumberComparisonKey(value).match(/^([a-z]+)/)?.[1] || null;
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

export async function findExistingClientAccountByNormalizedName(companyName: string, db: typeof prisma | Prisma.TransactionClient = prisma) {
  const normalizedName = normalizeClientName(companyName);
  const existing = await db.clientAccount.findFirst({
    where: {
      normalizedName,
      status: { notIn: ["merged", "archived"] }
    },
    orderBy: [{ updatedAt: "desc" }]
  });
  if (existing) return existing;

  const merged = await db.clientAccount.findFirst({
    where: { normalizedName, status: "merged", mergedIntoClientId: { not: null } },
    select: { mergedIntoClientId: true }
  });
  if (!merged?.mergedIntoClientId) return null;
  return db.clientAccount.findUnique({ where: { id: merged.mergedIntoClientId } });
}

export async function findOrCreateClientAccount(input: {
  clientId?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  accountOwnerUserId?: string | null;
}, actor?: AuthSession | null, transaction?: Prisma.TransactionClient): Promise<ClientAccount | null> {
  if (!transaction) return withAuthorizedClientMutation(actor, input.clientId ? [input.clientId] : [], (tx, currentActor) => findOrCreateClientAccount(input, currentActor, tx));
  if (!actor) throw new ClientMutationError("Autentificare necesara.", 401);
  const tx = transaction;
  if (input.clientId) {
    const existing = await tx.clientAccount.findUnique({ where: { id: input.clientId } });
    if (existing) {
      await lockClientAccounts(tx, [existing.id]);
      const current = await tx.clientAccount.findUniqueOrThrow({ where: { id: existing.id } });
      assertClientEditable(current, actor);
      if (hasClientOwnershipConflict(current, actor)) throw new ClientMutationError("Clientul exista deja la alt owner.", 409);
      return current;
    }
  }
  const companyName = (input.companyName || input.contactName || "").trim();
  if (!companyName) return null;
  const normalizedName = normalizeClientName(companyName);
  const existing = await findExistingClientAccountByNormalizedName(companyName, tx);
  if (existing) {
    await lockClientAccounts(tx, [existing.id]);
    const current = await tx.clientAccount.findUniqueOrThrow({ where: { id: existing.id } });
    assertClientEditable(current, actor);
    if (hasClientOwnershipConflict(current, actor)) throw new ClientMutationError("Clientul exista deja la alt owner.", 409);
    return current;
  }

  const owner = await resolveRequiredSalesOwner(actor, input.accountOwnerUserId, tx);
  const client = await tx.clientAccount.create({
    data: {
      companyName,
      normalizedName,
      generalEmail: input.email || null,
      generalPhone: input.phone || null,
      accountOwnerUserId: owner.id,
      createdByUserId: actor?.id || null,
      status: "active"
    }
  });

  if (input.contactName && input.contactName !== companyName) {
    await tx.clientContact.create({
      data: {
        clientId: client.id,
        name: input.contactName,
        email: input.email || null,
        phone: input.phone || null,
        isPrimary: true
      }
    });
  }
  await recordTransactionalAudit(tx, { actor, action: "client.create", entityType: "client_account", entityId: client.id, metadata: { companyName, accountOwnerUserId: client.accountOwnerUserId } });
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
  reason?: string | null;
}, actor?: AuthSession | null) {
  assertClientMergeAllowed(actor);
  if (input.primaryClientId === input.duplicateClientId) {
    throw new Error("Alege doi clienti diferiti.");
  }

  return withAuthorizedClientMutation(actor, [input.primaryClientId, input.duplicateClientId], async (tx, currentActor) => {
    assertClientMergeAllowed(currentActor);
    const [primary, duplicate] = await Promise.all([
      tx.clientAccount.findUnique({ where: { id: input.primaryClientId } }),
      tx.clientAccount.findUnique({ where: { id: input.duplicateClientId } })
    ]);
    if (!primary || !duplicate) {
      throw new Error("Unul dintre clienti nu exista.");
    }

    if (primary.status === "merged" || duplicate.status === "merged") throw new ClientMutationError("Un client a fost deja combinat. Actualizeaza previzualizarea.", 409);

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
    const receivableWhere: Prisma.FinancialReceivableWhereInput = {
      OR: [
        { clientId: duplicate.id },
        ...(duplicateCampaignIds.length ? [{ campaignId: { in: duplicateCampaignIds } }] : [])
      ]
    };
    await tx.financialReceivable.updateMany({
      where: { AND: [receivableWhere, { canonicalKey: { not: null } }] },
      data: { canonicalKey: null }
    });
    const receivables = await tx.financialReceivable.updateMany({
      where: receivableWhere,
      data: { clientId: primary.id, accountOwnerUserId: primary.accountOwnerUserId }
    });
    const financialImportRows = await tx.financialReceivableImportRow.updateMany({
      where: { clientId: duplicate.id },
      data: { clientId: primary.id }
    });
    const financialAliases = await tx.financialClientAlias.updateMany({
      where: { clientId: duplicate.id },
      data: { clientId: primary.id }
    });
    const financialCredits = await tx.financialClientCredit.updateMany({
      where: { clientId: duplicate.id },
      data: { clientId: primary.id }
    });
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

    const result = {
      primary,
      duplicate,
      counts: {
        campaigns: campaigns.count,
        agencyCampaigns: agencyCampaigns.count,
        endClientCampaigns: endClientCampaigns.count,
        reservations: reservations.count,
        billingItems: billingItems.count,
        receivables: receivables.count,
        financialImportRows: financialImportRows.count,
        financialAliases: financialAliases.count,
        financialCredits: financialCredits.count,
        contacts: contacts.count,
        documents: documents.count
      }
    };
    await recordTransactionalAudit(tx, { actor: currentActor, action: "client.merge", entityType: "client_account", entityId: primary.id, metadata: { primaryClientId: primary.id, duplicateClientId: duplicate.id, duplicateName: duplicate.companyName, reason: input.reason || null, counts: result.counts } });
    return result;
  });
}

export function assertClientMergeAllowed(actor?: AuthSession | null) {
  if (!actor || !["COO", "SUPER_ADMIN"].includes(actor.role)) {
    throw new Error("Doar COO sau SUPER_ADMIN pot combina clienti.");
  }
}
