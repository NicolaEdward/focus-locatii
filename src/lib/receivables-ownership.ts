import type { Prisma } from "@prisma/client";

export const receivableOwnershipSelect = {
  accountOwnerUserId: true,
  client: { select: { accountOwnerUserId: true } },
  campaign: { select: { accountOwnerUserId: true, sellerUserId: true } }
} satisfies Prisma.FinancialReceivableSelect;

type ReceivableOwnership = Prisma.FinancialReceivableGetPayload<{
  select: typeof receivableOwnershipSelect;
}>;

export function receivableOwnershipWhere(ownerUserId: string): Prisma.FinancialReceivableWhereInput {
  return {
    OR: [
      { accountOwnerUserId: ownerUserId },
      { client: { is: { accountOwnerUserId: ownerUserId } } },
      {
        campaign: {
          is: {
            OR: [
              { sellerUserId: ownerUserId },
              { accountOwnerUserId: ownerUserId }
            ]
          }
        }
      }
    ]
  };
}

export function receivableOwnerUserIds(receivable: ReceivableOwnership) {
  return Array.from(new Set([
    receivable.accountOwnerUserId,
    receivable.client?.accountOwnerUserId,
    receivable.campaign?.sellerUserId,
    receivable.campaign?.accountOwnerUserId
  ].filter((value): value is string => Boolean(value))));
}
