import type { AuthSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DocumentAccessAction = "view" | "manage";

export type DocumentAccessLinks = {
  clientId?: string | null;
  campaignId?: string | null;
  reservationId?: string | null;
  billingItemId?: string | null;
  financialReceivableId?: string | null;
  financialPayableId?: string | null;
  supplierId?: string | null;
};

export type DocumentOwnerCheck = {
  entity: string;
  id: string;
  ownerUserIds: string[];
};

export type ResolvedDocumentAccess = {
  ownerChecks: DocumentOwnerCheck[];
  hasFinancialLink: boolean;
  missingLinks: string[];
  inconsistentLinks?: string[];
};

export type DocumentAccessDecision = {
  allowed: boolean;
  status: 403 | 404 | 422;
  error: string;
};

type DocumentDb = Pick<typeof prisma, "clientAccount" | "campaign" | "reservation" | "billingItem" | "financialReceivable" | "financialPayable" | "supplier">;

/** Call after locking the supplied document links. A campaign's actual client
 * is authoritative; a supplied contradiction is an error, never overwritten. */
export async function canonicalCampaignDocumentLinks(links: DocumentAccessLinks, db: Pick<DocumentDb, "campaign"> = prisma): Promise<DocumentAccessLinks> {
  if (!links.campaignId) return { ...links };
  const campaign = await db.campaign.findUnique({ where: { id: links.campaignId }, select: { clientId: true } });
  if (!campaign) throw Object.assign(new Error("Entitatea legata de document nu exista."), { status: 404 });
  if (links.clientId && links.clientId !== campaign.clientId) {
    throw Object.assign(new Error("Legăturile documentului nu aparțin aceluiași dosar comercial."), { status: 422 });
  }
  return { ...links, clientId: campaign.clientId };
}

const documentTables = {
  clientId: "portfolio_client_accounts", campaignId: "portfolio_campaigns",
  reservationId: "portfolio_reservations", billingItemId: "portfolio_billing_items",
  financialReceivableId: "portfolio_financial_receivables",
  financialPayableId: "portfolio_financial_payables", supplierId: "portfolio_suppliers"
} as const;

async function documentAncestorIds(tx: Prisma.TransactionClient, links: DocumentAccessLinks) {
  const ids = Object.fromEntries(Object.keys(documentTables).map((key) => [key, new Set<string>()])) as Record<keyof DocumentAccessLinks, Set<string>>;
  for (const key of Object.keys(ids) as Array<keyof DocumentAccessLinks>) if (links[key]) ids[key].add(links[key] as string);
  for (const row of await tx.financialReceivable.findMany({ where: { id: { in: [...ids.financialReceivableId] } }, select: { clientId: true, campaignId: true, billingItemId: true } })) {
    if (row.clientId) ids.clientId.add(row.clientId);
    if (row.campaignId) ids.campaignId.add(row.campaignId);
    if (row.billingItemId) ids.billingItemId.add(row.billingItemId);
  }
  for (const row of await tx.financialPayable.findMany({ where: { id: { in: [...ids.financialPayableId] } }, select: { supplierId: true } })) if (row.supplierId) ids.supplierId.add(row.supplierId);
  for (const row of await tx.billingItem.findMany({ where: { id: { in: [...ids.billingItemId] } }, select: { clientId: true, reservationId: true } })) {
    if (row.clientId) ids.clientId.add(row.clientId);
    if (row.reservationId) ids.reservationId.add(row.reservationId);
  }
  for (const row of await tx.reservation.findMany({ where: { id: { in: [...ids.reservationId] } }, select: { clientId: true, campaignId: true } })) {
    if (row.clientId) ids.clientId.add(row.clientId);
    if (row.campaignId) ids.campaignId.add(row.campaignId);
  }
  for (const row of await tx.campaign.findMany({ where: { id: { in: [...ids.campaignId] } }, select: { clientId: true } })) ids.clientId.add(row.clientId);
  return Object.fromEntries(Object.entries(ids).map(([key, values]) => [key, [...values].sort()])) as Record<keyof DocumentAccessLinks, string[]>;
}

// Includes implicit ancestors, so ownership changes on a client cannot race an
// upload linked only to its reservation. Call under READ COMMITTED; if links
// changed during lock acquisition, reject and retry with no business write.
export async function lockDocumentLinks(tx: Prisma.TransactionClient, links: DocumentAccessLinks) {
  const ids = await documentAncestorIds(tx, links);
  for (const key of Object.keys(documentTables) as Array<keyof DocumentAccessLinks>) {
    if (ids[key].length) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(documentTables[key])} WHERE id IN (${Prisma.join(ids[key])}) ORDER BY id FOR UPDATE`);
  }
  if (JSON.stringify(ids) !== JSON.stringify(await documentAncestorIds(tx, links))) {
    throw Object.assign(new Error("Dosarul s-a schimbat în timpul validării. Reîncearcă încărcarea documentului."), { status: 409 });
  }
}

export async function resolveDocumentAccess(links: DocumentAccessLinks, db: DocumentDb = prisma): Promise<ResolvedDocumentAccess> {
  const ownerChecks: DocumentOwnerCheck[] = [];
  const missingLinks: string[] = [];
  const hasFinancialLink = Boolean(links.billingItemId || links.financialReceivableId || links.financialPayableId);

  const [
    client,
    campaign,
    reservation,
    billingItem,
    financialReceivable,
    financialPayable,
    supplier
  ] = await Promise.all([
    links.clientId
      ? db.clientAccount.findUnique({ where: { id: links.clientId }, select: { id: true, accountOwnerUserId: true } })
      : null,
    links.campaignId
      ? db.campaign.findUnique({
          where: { id: links.campaignId },
          select: {
            id: true,
            clientId: true,
            accountOwnerUserId: true,
            sellerUserId: true,
            client: { select: { accountOwnerUserId: true } }
          }
        })
      : null,
    links.reservationId
      ? db.reservation.findUnique({
          where: { id: links.reservationId },
          select: {
            id: true,
            clientId: true,
            campaignId: true,
            ownerId: true,
            sellerUserId: true,
            client: { select: { accountOwnerUserId: true } },
            campaign: {
              select: {
                clientId: true,
                accountOwnerUserId: true,
                sellerUserId: true,
                client: { select: { accountOwnerUserId: true } }
              }
            }
          }
        })
      : null,
    links.billingItemId
      ? db.billingItem.findUnique({
          where: { id: links.billingItemId },
          select: {
            id: true,
            clientId: true,
            reservationId: true,
            client: { select: { accountOwnerUserId: true } },
            reservation: {
              select: {
                clientId: true,
                campaignId: true,
                ownerId: true,
                sellerUserId: true,
                client: { select: { accountOwnerUserId: true } }
              }
            }
          }
        })
      : null,
    links.financialReceivableId
      ? db.financialReceivable.findUnique({
          where: { id: links.financialReceivableId },
          select: {
            id: true,
            clientId: true,
            campaignId: true,
            billingItemId: true,
            campaign: { select: { clientId: true } },
            billingItem: { select: { reservationId: true, clientId: true } },
            client: { select: { accountOwnerUserId: true } }
          }
        })
      : null,
    links.financialPayableId
      ? db.financialPayable.findUnique({ where: { id: links.financialPayableId }, select: { id: true, supplierId: true } })
      : null,
    links.supplierId
      ? db.supplier.findUnique({ where: { id: links.supplierId }, select: { id: true } })
      : null
  ]);

  if (links.clientId) {
    if (client) pushOwnerCheck(ownerChecks, "client", client.id, [client.accountOwnerUserId]);
    else missingLinks.push("clientId");
  }
  if (links.campaignId) {
    if (campaign) {
      pushOwnerCheck(ownerChecks, "campaign", campaign.id, [
        campaign.accountOwnerUserId,
        campaign.sellerUserId,
        campaign.client.accountOwnerUserId
      ]);
    } else {
      missingLinks.push("campaignId");
    }
  }
  if (links.reservationId) {
    if (reservation) {
      pushOwnerCheck(ownerChecks, "reservation", reservation.id, [
        reservation.ownerId,
        reservation.sellerUserId,
        reservation.client?.accountOwnerUserId,
        reservation.campaign?.accountOwnerUserId,
        reservation.campaign?.sellerUserId,
        reservation.campaign?.client.accountOwnerUserId
      ]);
    } else {
      missingLinks.push("reservationId");
    }
  }
  if (links.billingItemId) {
    if (billingItem) {
      pushOwnerCheck(ownerChecks, "billingItem", billingItem.id, [
        billingItem.client?.accountOwnerUserId,
        billingItem.reservation?.ownerId,
        billingItem.reservation?.sellerUserId,
        billingItem.reservation?.client?.accountOwnerUserId
      ]);
    } else {
      missingLinks.push("billingItemId");
    }
  }
  if (links.financialReceivableId) {
    if (financialReceivable) {
      pushOwnerCheck(ownerChecks, "financialReceivable", financialReceivable.id, [
        financialReceivable.client?.accountOwnerUserId
      ]);
    } else {
      missingLinks.push("financialReceivableId");
    }
  }
  if (links.financialPayableId && !financialPayable) missingLinks.push("financialPayableId");
  if (links.supplierId && !supplier) missingLinks.push("supplierId");

  const inconsistentLinks: string[] = [];
  const distinct = (values: Array<string | null | undefined>) => new Set(values.filter((value): value is string => Boolean(value))).size;
  if (distinct([links.clientId, campaign?.clientId, reservation?.clientId, reservation?.campaign?.clientId,
    billingItem?.clientId, billingItem?.reservation?.clientId, financialReceivable?.clientId,
    financialReceivable?.campaign?.clientId, financialReceivable?.billingItem?.clientId]) > 1) inconsistentLinks.push("clientId");
  if (distinct([links.campaignId, reservation?.campaignId, billingItem?.reservation?.campaignId,
    financialReceivable?.campaignId]) > 1) inconsistentLinks.push("campaignId");
  if (distinct([links.reservationId, billingItem?.reservationId, financialReceivable?.billingItem?.reservationId]) > 1) inconsistentLinks.push("reservationId");
  if (links.billingItemId && financialReceivable && financialReceivable.billingItemId !== links.billingItemId) inconsistentLinks.push("billingItemId");
  if (links.supplierId && financialPayable && financialPayable.supplierId !== links.supplierId) inconsistentLinks.push("supplierId");
  if (links.financialPayableId && (links.financialReceivableId || links.billingItemId || links.clientId || links.campaignId || links.reservationId)) inconsistentLinks.push("financialPayableId");
  // When a parent is explicitly supplied, an unlinked legacy child is not proof
  // that it belongs to that parent. Reject instead of inventing the relationship.
  if (links.clientId && campaign && campaign.clientId !== links.clientId) inconsistentLinks.push("campaign.clientId");
  if (links.clientId && reservation && (reservation.clientId || reservation.campaign?.clientId) !== links.clientId) inconsistentLinks.push("reservation.clientId");
  if (links.campaignId && reservation && reservation.campaignId !== links.campaignId) inconsistentLinks.push("reservation.campaignId");
  if (links.clientId && billingItem && (billingItem.clientId || billingItem.reservation?.clientId) !== links.clientId) inconsistentLinks.push("billingItem.clientId");
  if (links.reservationId && billingItem && billingItem.reservationId !== links.reservationId) inconsistentLinks.push("billingItem.reservationId");
  if (links.clientId && financialReceivable && (financialReceivable.clientId || financialReceivable.campaign?.clientId || financialReceivable.billingItem?.clientId) !== links.clientId) inconsistentLinks.push("financialReceivable.clientId");
  if (links.campaignId && financialReceivable && financialReceivable.campaignId !== links.campaignId) inconsistentLinks.push("financialReceivable.campaignId");

  return { ownerChecks, hasFinancialLink, missingLinks, inconsistentLinks };
}

export function evaluateDocumentAccess(
  session: AuthSession,
  resolved: ResolvedDocumentAccess,
  action: DocumentAccessAction
): DocumentAccessDecision | null {
  if (resolved.missingLinks.length) {
    return {
      allowed: false,
      status: 404,
      error: "Entitatea legata de document nu exista."
    };
  }
  if (resolved.inconsistentLinks?.length) {
    return { allowed: false, status: 422, error: "Legăturile documentului nu aparțin aceluiași dosar comercial." };
  }

  if (session.role === "D_CEO") {
    return action === "view"
      ? null
      : { allowed: false, status: 403, error: "Rolul D-CEO poate doar consulta documente." };
  }
  if (["SUPER_ADMIN", "COO", "SALES_DIRECTOR"].includes(session.role)) return null;

  if (session.role === "FINANCE_OPERATOR") {
    if (resolved.hasFinancialLink) return null;
    return {
      allowed: false,
      status: 403,
      error: "Operatorii financiari pot accesa doar documente financiare."
    };
  }

  if (session.role === "SALES_AGENT") {
    const denied = resolved.ownerChecks.some((check) => !check.ownerUserIds.includes(session.id));
    if (!resolved.ownerChecks.length || denied) {
      return {
        allowed: false,
        status: 403,
        error: action === "view"
          ? "Nu ai acces la acest document."
          : "Poti modifica documente doar pentru clientii, campaniile sau rezervarile tale."
      };
    }
  }

  return null;
}

export function linksFromDocument(document: DocumentAccessLinks) {
  return {
    clientId: document.clientId,
    campaignId: document.campaignId,
    reservationId: document.reservationId,
    billingItemId: document.billingItemId,
    financialReceivableId: document.financialReceivableId,
    financialPayableId: document.financialPayableId,
    supplierId: document.supplierId
  };
}

function pushOwnerCheck(
  ownerChecks: DocumentOwnerCheck[],
  entity: string,
  id: string,
  ownerUserIds: Array<string | null | undefined>
) {
  ownerChecks.push({
    entity,
    id,
    ownerUserIds: [...new Set(ownerUserIds.filter(Boolean) as string[])]
  });
}
