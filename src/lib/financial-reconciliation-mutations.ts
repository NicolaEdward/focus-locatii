import { Prisma } from "@prisma/client";
import { BANK_TRANSACTION_CLASSIFICATIONS } from "@/lib/bcr-george-import";
import type { AuthSession } from "@/lib/auth";
import { excludedBankClassification, type ReconciliationDirection } from "@/lib/financial-reconciliation";
import {
  activeReceivablePaymentTotal,
  bootstrapLegacyReceivablePayment,
  synchronizeReceivableLedger,
  cancelReceivablePayment
} from "@/lib/receivables-payment-service";
import {
  activePayablePaymentTotal,
  bootstrapLegacyPayablePayment,
  supersedePresumedPayablePayments,
  synchronizePayableLedger
} from "@/lib/payables-payment-service";
import { money } from "@/lib/receivables-domain";
import { prisma } from "@/lib/prisma";
import { ensureFinancialPartnerAlias } from "@/lib/financial-partners";
import { receivableNetAmount } from "@/lib/receivable-adjustments";
import { activeBankAllocationTotal, synchronizeBankTransaction } from "@/lib/financial-bank-ledger";
import { financialRequestFingerprint, assertSameFinancialIntent } from "@/lib/financial-request-intent";

export type BankAllocationInput = {
  bankTransactionId: string;
  allocations: Array<{ direction: ReconciliationDirection; documentId: string; amount: string }>;
  requestKey: string;
  notes?: string | null;
  rememberMerchantAlias?: boolean;
  actor: AuthSession;
};

export async function allocateBankTransaction(input: BankAllocationInput) {
  if (!input.allocations.length) throw new Error("Adauga cel putin o alocare.");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey)) throw new Error("Cheia operației bancare nu este validă.");
  const fingerprint = financialRequestFingerprint({
    transactionId: input.bankTransactionId, actorId: input.actor.id,
    allocations: input.allocations.map((row) => ({ ...row, amount: money(row.amount).toFixed(2) })),
    notes: input.notes || null, rememberMerchantAlias: Boolean(input.rememberMerchantAlias)
  });
  return prisma.$transaction(async (tx) => {
    const duplicate = await findDuplicateRequest(tx, input.requestKey, input.allocations[0].direction);
    if (duplicate) {
      const audit = await tx.auditLog.findFirst({
        where: { action: "financial.bank_transaction_allocated", entityId: input.bankTransactionId,
          metadata: { path: "$.requestKey", equals: input.requestKey } },
        select: { metadata: true }
      });
      const metadata = audit?.metadata as Record<string, unknown> | null;
      assertSameFinancialIntent(metadata?.requestFingerprint, fingerprint);
      return { duplicate: true, transactionId: input.bankTransactionId };
    }
    const transaction = await tx.financialBankTransaction.findUnique({
      where: { id: input.bankTransactionId },
      include: {
        receivablePayments: { where: { status: "active" }, select: { amount: true } },
        payablePayments: { where: { status: "active" }, select: { amount: true } }
      }
    });
    if (!transaction) throw new Error("Tranzactia bancara nu exista.");
    if (excludedBankClassification(transaction.classification)) {
      throw new Error("Transferurile interne, taxele si comisioanele nu pot fi alocate facturilor obisnuite.");
    }
    if (transaction.creditAmount.greaterThan(0) && transaction.debitAmount.greaterThan(0)) {
      throw new Error("Tranzactia are simultan debit si credit si necesita verificare.");
    }
    const direction: ReconciliationDirection = transaction.creditAmount.greaterThan(0) ? "receivable" : "payable";
    if (input.allocations.some((allocation) => allocation.direction !== direction)) {
      throw new Error(direction === "receivable" ? "O incasare poate fi alocata numai facturilor clientilor." : "O plata poate fi alocata numai documentelor furnizorilor.");
    }
    const transactionAmount = direction === "receivable" ? transaction.creditAmount : transaction.debitAmount;
    const alreadyAllocated = [...transaction.receivablePayments, ...transaction.payablePayments]
      .reduce((sum, payment) => sum.plus(payment.amount), money(0));
    const requested = input.allocations.reduce((sum, allocation) => sum.plus(money(allocation.amount)), money(0));
    if (input.allocations.some((allocation) => !money(allocation.amount).greaterThan(0))) throw new Error("Sumele alocate trebuie sa fie pozitive.");
    if (alreadyAllocated.plus(requested).greaterThan(transactionAmount)) {
      throw new Error(`Alocarile depasesc valoarea disponibila a tranzactiei cu ${alreadyAllocated.plus(requested).minus(transactionAmount).toFixed(2)} ${transaction.currency}.`);
    }

    const paymentIds: string[] = [];
    const allocatedPartnerIds = new Set<string>();
    for (let index = 0; index < input.allocations.length; index += 1) {
      const allocation = input.allocations[index];
      const requestKey = `${input.requestKey}:${index}:${allocation.direction}:${allocation.documentId}`;
      const amount = money(allocation.amount);
      if (allocation.direction === "receivable") {
        const receivable = await tx.financialReceivable.findUnique({ where: { id: allocation.documentId } });
        if (!receivable || !receivable.includedInReport) throw new Error("Factura client selectata nu exista sau este exclusa.");
        if (receivable.partnerId) allocatedPartnerIds.add(receivable.partnerId);
        assertSameScope(transaction, receivable, amount);
        await bootstrapLegacyReceivablePayment(tx, receivable, input.actor.id);
        const current = await activeReceivablePaymentTotal(tx, receivable.id);
        const available = Prisma.Decimal.max(receivableNetAmount(receivable.invoicedAmount, receivable.rawRowJson).minus(current), 0);
        if (amount.greaterThan(available)) throw new Error(`Alocarea depaseste soldul net al facturii ${receivable.invoiceNumber || receivable.id}. Alocă diferența separat numai printr-un flux de credit aprobat.`);
        const payment = await tx.financialReceivablePayment.create({
          data: {
            receivableId: receivable.id,
            bankTransactionId: transaction.id,
            requestKey,
            amount,
            currency: transaction.currency,
            receivedAt: transaction.valueDate || transaction.bookedAt,
            paymentMethod: "bank_transfer",
            paymentReference: transaction.documentReference || transaction.bankReference,
            notes: input.notes || null,
            source: "bank_reconciliation",
            verificationStatus: "verified",
            createdByUserId: input.actor.id
          }
        });
        paymentIds.push(payment.id);
        await synchronizeReceivableLedger(tx, receivable.id);
      } else {
        const payable = await tx.financialPayable.findUnique({
          where: { id: allocation.documentId },
          include: { payments: { where: { status: "active" } } }
        });
        if (!payable || !payable.includedInReport) throw new Error("Documentul furnizor selectat nu exista sau este exclus.");
        if (payable.partnerId) allocatedPartnerIds.add(payable.partnerId);
        assertSameScope(transaction, payable, amount);
        await bootstrapLegacyPayablePayment(tx, payable, input.actor.id);
        const activePayments = await tx.financialPayablePayment.findMany({ where: { payableId: payable.id, status: "active" } });
        const confirmed = activePayments
          .filter((payment) => payment.verificationStatus !== "presumed")
          .reduce((sum, payment) => sum.plus(payment.amount), money(0));
        const verifiedCapacity = Prisma.Decimal.max(money(payable.amountToPay).minus(confirmed), 0);
        if (amount.greaterThan(verifiedCapacity)) throw new Error(`Alocarea depaseste soldul verificabil al documentului ${payable.invoiceNumber || payable.id}.`);
        const payment = await tx.financialPayablePayment.create({
          data: {
            payableId: payable.id,
            bankTransactionId: transaction.id,
            requestKey,
            amount,
            currency: transaction.currency,
            paidAt: transaction.valueDate || transaction.bookedAt,
            paymentMethod: transaction.transactionType === "card" ? "card" : "bank_transfer",
            paymentReference: transaction.documentReference || transaction.bankReference,
            notes: input.notes || null,
            source: "bank_reconciliation",
            verificationStatus: "verified",
            createdByUserId: input.actor.id
          }
        });
        paymentIds.push(payment.id);
        await supersedePresumedPayablePayments({
          tx,
          payableId: payable.id,
          verifiedAmount: amount,
          replacementPaymentId: payment.id,
          actorId: input.actor.id,
          requestKey
        });
        await synchronizePayableLedger(tx, payable.id);
      }
    }
    if (input.rememberMerchantAlias && transaction.merchantName && allocatedPartnerIds.size === 1) {
      await ensureFinancialPartnerAlias(tx, {
        legalEntityId: transaction.legalEntityId,
        partnerId: [...allocatedPartnerIds][0],
        alias: transaction.merchantName,
        source: "bank_reconciliation_confirmed",
        actorId: input.actor.id
      });
    }
    await synchronizeBankTransaction(tx, transaction.id);
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "financial.bank_transaction_allocated",
        entityType: "financial_bank_transaction",
        entityId: transaction.id,
        metadata: {
          allocationCount: input.allocations.length,
          amount: requested.toFixed(2),
          currency: transaction.currency,
          direction,
          paymentIds,
          requestKey: input.requestKey,
          requestFingerprint: fingerprint,
          merchantAliasSaved: Boolean(input.rememberMerchantAlias && transaction.merchantName && allocatedPartnerIds.size === 1)
        }
      }
    });
    return { duplicate: false, transactionId: transaction.id, paymentIds };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
}

export async function classifyBankTransaction(input: {
  transactionId: string;
  classification: string;
  reason: string;
  actor: AuthSession;
}) {
  if (!input.reason.trim()) throw new Error("Motivul clasificarii este obligatoriu.");
  if (!BANK_TRANSACTION_CLASSIFICATIONS.includes(input.classification as typeof BANK_TRANSACTION_CLASSIFICATIONS[number])) throw new Error("Clasificarea bancara nu este valida.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.financialBankTransaction.findUnique({ where: { id: input.transactionId } });
    if (!existing) throw new Error("Tranzactia bancara nu exista.");
    const hasAllocations = await activeBankAllocationTotal(tx, existing.id);
    if (excludedBankClassification(input.classification) && hasAllocations.greaterThan(0)) {
      throw new Error("Anuleaza alocarile active inainte de a marca tranzactia drept transfer, taxa sau comision.");
    }
    await tx.financialBankTransaction.update({
      where: { id: existing.id },
      data: {
        classification: input.classification,
        reconciliationStatus: excludedBankClassification(input.classification) ? "ignored" : hasAllocations.greaterThan(0) ? "partial" : "unmatched"
      }
    });
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "financial.bank_transaction_classified",
        entityType: "financial_bank_transaction",
        entityId: existing.id,
        metadata: { before: existing.classification, after: input.classification, reason: input.reason.trim() }
      }
    });
    await synchronizeBankTransaction(tx, existing.id);
    return tx.financialBankTransaction.findUniqueOrThrow({ where: { id: existing.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

export async function reverseBankAllocation(input: {
  paymentId: string;
  direction: ReconciliationDirection;
  reason: string;
  actor: AuthSession;
}) {
  if (!input.reason.trim()) throw new Error("Motivul anularii este obligatoriu.");
  if (input.direction === "receivable") {
    return cancelReceivablePayment({ paymentId: input.paymentId, reason: input.reason, actor: input.actor });
  }
  return prisma.$transaction(async (tx) => {

      const payment = await tx.financialPayablePayment.findUnique({ where: { id: input.paymentId } });
      if (!payment) throw new Error("Alocarea nu exista.");
      if (payment.status === "cancelled") return { duplicate: true };
      await tx.financialPayablePayment.update({ where: { id: payment.id }, data: { status: "cancelled", cancelledByUserId: input.actor.id, cancelledAt: new Date(), cancellationReason: input.reason.trim() } });
      await synchronizePayableLedger(tx, payment.payableId);
      if (payment.bankTransactionId) await synchronizeBankTransaction(tx, payment.bankTransactionId);
    await tx.auditLog.create({ data: { userId: input.actor.id, action: "financial.bank_allocation_reversed", entityType: "financial_payment_allocation", entityId: input.paymentId, metadata: { direction: input.direction, reason: input.reason.trim() } } });
    return { duplicate: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

async function findDuplicateRequest(tx: Prisma.TransactionClient, requestKey: string, direction: ReconciliationDirection) {
  void direction;
  const prefix = `${requestKey}:0:`;
  const [receivable, payable] = await Promise.all([
    tx.financialReceivablePayment.findFirst({ where: { requestKey: { startsWith: prefix } }, select: { id: true } }),
    tx.financialPayablePayment.findFirst({ where: { requestKey: { startsWith: prefix } }, select: { id: true } })
  ]);
  return receivable || payable;
}

function assertSameScope(
  transaction: { legalEntityId: string; currency: string },
  document: { legalEntityId: string | null; currency: string | null },
  amount: Prisma.Decimal
) {
  if (!document.legalEntityId || document.legalEntityId !== transaction.legalEntityId) throw new Error("Tranzactia si documentul apartin unor entitati juridice diferite.");
  if (!document.currency || document.currency !== transaction.currency) throw new Error("Moneda tranzactiei si moneda documentului nu coincid. Conversia automata nu este permisa.");
  if (!amount.greaterThan(0)) throw new Error("Suma alocata trebuie sa fie pozitiva.");
}
