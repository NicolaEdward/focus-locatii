import { Prisma } from "@prisma/client";
import { money } from "@/lib/receivables-domain";

import { excludedBankClassification } from "@/lib/financial-reconciliation";

export function bankAllocationStatus(input: {
  classification: string;
  creditAmount: Prisma.Decimal.Value | null;
  debitAmount: Prisma.Decimal.Value | null;
  allocatedAmount: Prisma.Decimal.Value | null;
}) {
  const allocated = money(input.allocatedAmount);
  const credit = money(input.creditAmount);
  const amount = credit.greaterThan(0) ? credit : money(input.debitAmount);
  return excludedBankClassification(input.classification)
    ? "ignored"
    : allocated.lessThanOrEqualTo(0)
      ? "unmatched"
      : allocated.greaterThanOrEqualTo(amount)
        ? "matched"
        : "partial";
}

export async function activeBankAllocationTotal(
  tx: Prisma.TransactionClient,
  transactionId: string,
) {
  const [receivable, payable] = await Promise.all([
    tx.financialReceivablePayment.aggregate({
      where: { bankTransactionId: transactionId, status: "active" },
      _sum: { amount: true },
    }),
    tx.financialPayablePayment.aggregate({
      where: { bankTransactionId: transactionId, status: "active" },
      _sum: { amount: true },
    }),
  ]);
  return money(receivable._sum.amount).plus(money(payable._sum.amount));
}

// Shared by reconciliation and generic payment cancellation. Keep the bank state
// in the same transaction as the ledger mutation; never repair it asynchronously.
export async function synchronizeBankTransaction(
  tx: Prisma.TransactionClient,
  transactionId: string,
) {
  const transaction = await tx.financialBankTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!transaction) throw new Error("Tranzacția bancară nu mai există.");
  const allocated = await activeBankAllocationTotal(tx, transactionId);
  const status = bankAllocationStatus({
    ...transaction,
    allocatedAmount: allocated,
  });
  await tx.financialBankTransaction.update({
    where: { id: transactionId },
    data: { reconciliationStatus: status },
  });
}
