import type { Prisma } from "@prisma/client";

export const receivableOwnershipSelect = {
  clientId: true,
  accountOwnerUserId: true,
  client: {
    select: {
      accountOwnerUserId: true,
      accountOwner: { select: { id: true, name: true } }
    }
  }
} satisfies Prisma.FinancialReceivableSelect;

type ReceivableResponsibilitySource = {
  clientId?: string | null;
  client?: {
    accountOwnerUserId: string | null;
    accountOwner?: { id: string; name: string } | null;
  } | null;
};

export function receivableOwnershipWhere(ownerUserId: string): Prisma.FinancialReceivableWhereInput {
  return {
    client: { is: { accountOwnerUserId: ownerUserId } }
  };
}

export function receivableResponsibleUserId(
  receivable: ReceivableResponsibilitySource
) {
  if (!receivable.clientId || !receivable.client) return null;
  return receivable.client.accountOwnerUserId || null;
}

export function receivableResponsibleUser(
  receivable: ReceivableResponsibilitySource
) {
  const id = receivableResponsibleUserId(receivable);
  if (!id) return null;
  return {
    id,
    name: receivable.client?.accountOwner?.name || null
  };
}

export function receivableOwnerUserIds(receivable: ReceivableResponsibilitySource) {
  const ownerUserId = receivableResponsibleUserId(receivable);
  return ownerUserId ? [ownerUserId] : [];
}
