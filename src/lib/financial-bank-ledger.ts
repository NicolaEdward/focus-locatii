import { Prisma } from "@prisma/client";
import { money } from "@/lib/receivables-domain";

import { excludedBankClassification } from "@/lib/financial-reconciliation";

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
  const amount = transaction.creditAmount.greaterThan(0)
    ? transaction.creditAmount
    : transaction.debitAmount;
  const status = excludedBankClassification(transaction.classification)
    ? "ignored"
    : allocated.lessThanOrEqualTo(0)
      ? "unmatched"
      : allocated.greaterThanOrEqualTo(amount)
        ? "matched"
        : "partial";
  await tx.financialBankTransaction.update({
    where: { id: transactionId },
    data: { reconciliationStatus: status },
  });
}
