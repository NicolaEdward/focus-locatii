import type { AuthSession } from "@/lib/auth";
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
};

export type DocumentAccessDecision = {
  allowed: boolean;
  status: 403 | 404;
  error: string;
};

export async function resolveDocumentAccess(links: DocumentAccessLinks): Promise<ResolvedDocumentAccess> {
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
      ? prisma.clientAccount.findUnique({ where: { id: links.clientId }, select: { id: true, accountOwnerUserId: true } })
      : null,
    links.campaignId
      ? prisma.campaign.findUnique({
          where: { id: links.campaignId },
          select: {
            id: true,
            accountOwnerUserId: true,
            sellerUserId: true,
            client: { select: { accountOwnerUserId: true } }
          }
        })
      : null,
    links.reservationId
      ? prisma.reservation.findUnique({
          where: { id: links.reservationId },
          select: {
            id: true,
            ownerId: true,
            sellerUserId: true,
            client: { select: { accountOwnerUserId: true } },
            campaign: {
              select: {
                accountOwnerUserId: true,
                sellerUserId: true,
                client: { select: { accountOwnerUserId: true } }
              }
            }
          }
        })
      : null,
    links.billingItemId
      ? prisma.billingItem.findUnique({
          where: { id: links.billingItemId },
          select: {
            id: true,
            client: { select: { accountOwnerUserId: true } },
            reservation: {
              select: {
                ownerId: true,
                sellerUserId: true,
                client: { select: { accountOwnerUserId: true } }
              }
            }
          }
        })
      : null,
    links.financialReceivableId
      ? prisma.financialReceivable.findUnique({
          where: { id: links.financialReceivableId },
          select: {
            id: true,
            accountOwnerUserId: true,
            client: { select: { accountOwnerUserId: true } },
            campaign: {
              select: {
                accountOwnerUserId: true,
                sellerUserId: true,
                client: { select: { accountOwnerUserId: true } }
              }
            },
            billingItem: {
              select: {
                client: { select: { accountOwnerUserId: true } },
                reservation: {
                  select: {
                    ownerId: true,
                    sellerUserId: true,
                    client: { select: { accountOwnerUserId: true } }
                  }
                }
              }
            }
          }
        })
      : null,
    links.financialPayableId
      ? prisma.financialPayable.findUnique({ where: { id: links.financialPayableId }, select: { id: true } })
      : null,
    links.supplierId
      ? prisma.supplier.findUnique({ where: { id: links.supplierId }, select: { id: true } })
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
        financialReceivable.accountOwnerUserId,
        financialReceivable.client?.accountOwnerUserId,
        financialReceivable.campaign?.accountOwnerUserId,
        financialReceivable.campaign?.sellerUserId,
        financialReceivable.campaign?.client.accountOwnerUserId,
        financialReceivable.billingItem?.client?.accountOwnerUserId,
        financialReceivable.billingItem?.reservation?.ownerId,
        financialReceivable.billingItem?.reservation?.sellerUserId,
        financialReceivable.billingItem?.reservation?.client?.accountOwnerUserId
      ]);
    } else {
      missingLinks.push("financialReceivableId");
    }
  }
  if (links.financialPayableId && !financialPayable) missingLinks.push("financialPayableId");
  if (links.supplierId && !supplier) missingLinks.push("supplierId");

  return { ownerChecks, hasFinancialLink, missingLinks };
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
