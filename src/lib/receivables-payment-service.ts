import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { assertReceivablePaymentTransition } from "@/lib/financial-state-machine";
import { money, receivableStatus } from "@/lib/receivables-domain";
import { prisma } from "@/lib/prisma";

export type ReceivablePaymentInput = {
  receivableId: string;
  amount: string;
  receivedAt: Date;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  notes?: string | null;
  confirmOverpayment?: boolean;
  requestKey?: string | null;
  actor: AuthSession;
};

export async function recordReceivablePayment(input: ReceivablePaymentInput) {
  return prisma.$transaction(async (tx) => {
    if (input.requestKey) {
      const existing = await tx.financialReceivablePayment.findUnique({ where: { requestKey: input.requestKey } });
      if (existing) return paymentMutationResult(tx, existing.receivableId, existing.id, true);
    }
    const receivable = await tx.financialReceivable.findUnique({ where: { id: input.receivableId } });
    if (!receivable || !receivable.includedInReport) throw new Error("Factura nu există sau este exclusă.");
    if (!receivable.currency || receivable.invoicedAmount == null) throw new Error("Factura nu are monedă sau valoare validă.");
    const amount = money(input.amount);
    if (!amount.greaterThan(0)) throw new Error("Suma încasată trebuie să fie mai mare decât zero.");
    await bootstrapLegacyPayment(tx, receivable, input.actor.id);
    const previousCollected = await activePaymentTotal(tx, receivable.id);
    const nextCollected = previousCollected.plus(amount);
    const invoiceAmount = money(receivable.invoicedAmount);
    if (nextCollected.greaterThan(invoiceAmount.plus("0.01")) && !input.confirmOverpayment) {
      throw new Error(`Suma depășește soldul cu ${nextCollected.minus(invoiceAmount).toFixed(2)} ${receivable.currency}. Confirmă explicit creditul clientului.`);
    }
    const payment = await tx.financialReceivablePayment.create({
      data: {
        receivableId: receivable.id,
        requestKey: input.requestKey || null,
        amount,
        currency: receivable.currency,
        receivedAt: input.receivedAt,
        paymentMethod: input.paymentMethod || null,
        paymentReference: input.paymentReference || null,
        notes: input.notes || null,
        source: "manual",
        createdByUserId: input.actor.id
      }
    });
    await createCreditDelta(tx, receivable, payment.id, previousCollected, nextCollected, input.actor.id);
    await synchronizeReceivable(tx, receivable.id);
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivable.payment_created",
        entityType: "financial_receivable_payment",
        entityId: payment.id,
        metadata: {
          receivableId: receivable.id,
          amount: amount.toFixed(2),
          currency: receivable.currency,
          previousCollected: previousCollected.toFixed(2),
          newCollected: nextCollected.toFixed(2),
          source: "manual"
        }
      }
    });
    return paymentMutationResult(tx, receivable.id, payment.id, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

export async function cancelReceivablePayment(input: {
  paymentId: string;
  reason: string;
  actor: AuthSession;
}) {
  if (!input.reason.trim()) throw new Error("Motivul anulării este obligatoriu.");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.financialReceivablePayment.findUnique({
      where: { id: input.paymentId },
      include: { receivable: true, credit: true }
    });
    if (!payment) throw new Error("Încasarea nu există.");
    if (payment.status === "cancelled") return paymentMutationResult(tx, payment.receivableId, payment.id, true);
    assertReceivablePaymentTransition(payment.status, "cancelled");
    await tx.financialReceivablePayment.update({
      where: { id: payment.id },
      data: {
        status: "cancelled",
        cancelledByUserId: input.actor.id,
        cancelledAt: new Date(),
        cancellationReason: input.reason.trim()
      }
    });
    if (payment.credit) {
      await tx.financialClientCredit.update({
        where: { id: payment.credit.id },
        data: { status: "cancelled", remainingAmount: money(0) }
      });
    }
    await synchronizeReceivable(tx, payment.receivableId);
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivable.payment_cancelled",
        entityType: "financial_receivable_payment",
        entityId: payment.id,
        metadata: { receivableId: payment.receivableId, amount: payment.amount.toFixed(2), reason: input.reason.trim() }
      }
    });
    return paymentMutationResult(tx, payment.receivableId, payment.id, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

export async function correctReceivablePayment(input: Omit<ReceivablePaymentInput, "receivableId"> & {
  paymentId: string;
  reason: string;
}) {
  if (!input.reason.trim()) throw new Error("Motivul corecției este obligatoriu.");
  return prisma.$transaction(async (tx) => {
    const original = await tx.financialReceivablePayment.findUnique({
      where: { id: input.paymentId },
      include: { receivable: true, credit: true }
    });
    if (!original) throw new Error("Încasarea nu există.");
    if (original.status !== "active") throw new Error("Doar o încasare activă poate fi corectată.");
    assertReceivablePaymentTransition(original.status, "cancelled");
    const amount = money(input.amount);
    if (!amount.greaterThan(0)) throw new Error("Suma corectată trebuie să fie mai mare decât zero.");
    const currentTotal = await activePaymentTotal(tx, original.receivableId);
    const totalWithoutOriginal = currentTotal.minus(original.amount);
    const nextTotal = totalWithoutOriginal.plus(amount);
    const invoiceAmount = money(original.receivable.invoicedAmount);
    if (nextTotal.greaterThan(invoiceAmount.plus("0.01")) && !input.confirmOverpayment) {
      throw new Error(`Corecția produce un credit de ${nextTotal.minus(invoiceAmount).toFixed(2)} ${original.currency}. Confirmă explicit.`);
    }
    await tx.financialReceivablePayment.update({
      where: { id: original.id },
      data: {
        status: "cancelled",
        cancelledByUserId: input.actor.id,
        cancelledAt: new Date(),
        cancellationReason: `Corectată: ${input.reason.trim()}`
      }
    });
    if (original.credit) await tx.financialClientCredit.update({ where: { id: original.credit.id }, data: { status: "cancelled", remainingAmount: money(0) } });
    const replacement = await tx.financialReceivablePayment.create({
      data: {
        receivableId: original.receivableId,
        requestKey: input.requestKey || null,
        amount,
        currency: original.currency,
        receivedAt: input.receivedAt,
        paymentMethod: input.paymentMethod || null,
        paymentReference: input.paymentReference || null,
        notes: input.notes || null,
        source: "manual_correction",
        correctsPaymentId: original.id,
        createdByUserId: input.actor.id
      }
    });
    await createCreditDelta(tx, original.receivable, replacement.id, totalWithoutOriginal, nextTotal, input.actor.id);
    await synchronizeReceivable(tx, original.receivableId);
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivable.payment_corrected",
        entityType: "financial_receivable_payment",
        entityId: replacement.id,
        metadata: {
          receivableId: original.receivableId,
          previousPaymentId: original.id,
          previousAmount: original.amount.toFixed(2),
          newAmount: amount.toFixed(2),
          reason: input.reason.trim()
        }
      }
    });
    return paymentMutationResult(tx, original.receivableId, replacement.id, false);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

async function bootstrapLegacyPayment(tx: Prisma.TransactionClient, receivable: {
  id: string;
  collectedAmount: Prisma.Decimal | null;
  collectedAt: Date | null;
  createdAt: Date;
  currency: string | null;
  paymentMethod: string | null;
}, actorId: string) {
  const count = await tx.financialReceivablePayment.count({ where: { receivableId: receivable.id } });
  if (!count && receivable.currency && money(receivable.collectedAmount).greaterThan(0)) {
    await tx.financialReceivablePayment.create({
      data: {
        receivableId: receivable.id,
        amount: receivable.collectedAmount || money(0),
        currency: receivable.currency,
        receivedAt: receivable.collectedAt || receivable.createdAt,
        paymentMethod: receivable.paymentMethod,
        notes: "Sold inițial păstrat din implementarea anterioară.",
        source: "legacy_opening_balance",
        createdByUserId: actorId
      }
    });
  }
}

async function createCreditDelta(tx: Prisma.TransactionClient, receivable: {
  id: string;
  clientId: string | null;
  companyName: string;
  companyCode: string | null;
  currency: string | null;
  invoicedAmount: Prisma.Decimal | null;
}, paymentId: string, previousCollected: Prisma.Decimal, nextCollected: Prisma.Decimal, actorId: string) {
  if (!receivable.clientId || !receivable.companyCode || !receivable.currency) return;
  const invoiceAmount = money(receivable.invoicedAmount);
  const previousCredit = Prisma.Decimal.max(previousCollected.minus(invoiceAmount), 0);
  const nextCredit = Prisma.Decimal.max(nextCollected.minus(invoiceAmount), 0);
  const creditDelta = nextCredit.minus(previousCredit);
  if (!creditDelta.greaterThan(0)) return;
  await tx.financialClientCredit.create({
    data: {
      clientId: receivable.clientId,
      receivableId: receivable.id,
      sourcePaymentId: paymentId,
      companyName: receivable.companyName,
      companyCode: receivable.companyCode,
      currency: receivable.currency,
      amount: creditDelta,
      remainingAmount: creditDelta,
      reason: "Supraplată confirmată la înregistrarea încasării.",
      createdByUserId: actorId
    }
  });
}

async function synchronizeReceivable(tx: Prisma.TransactionClient, receivableId: string) {
  const receivable = await tx.financialReceivable.findUnique({ where: { id: receivableId } });
  if (!receivable) throw new Error("Factura nu mai există.");
  const collected = await activePaymentTotal(tx, receivableId);
  const invoiceAmount = money(receivable.invoicedAmount);
  const remaining = Prisma.Decimal.max(invoiceAmount.minus(collected), 0);
  const latest = await tx.financialReceivablePayment.findFirst({
    where: { receivableId, status: "active" },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }]
  });
  await tx.financialReceivable.update({
    where: { id: receivableId },
    data: {
      collectedAmount: collected,
      remainingAmount: remaining,
      status: receivableStatus({ invoiceAmount, collectedAmount: collected, dueDate: receivable.dueDate }),
      collectedAt: remaining.equals(0) ? latest?.receivedAt || null : null,
      paymentMethod: latest?.paymentMethod || null,
      collectionNotes: latest?.notes || receivable.collectionNotes,
      needsReview: false
    }
  });
  if (receivable.billingItemId) {
    await tx.billingItem.update({
      where: { id: receivable.billingItemId },
      data: {
        collectedAmount: collected,
        remainingAmount: remaining,
        collectedAt: remaining.equals(0) ? latest?.receivedAt || null : null,
        paymentMethod: latest?.paymentMethod || null,
        collectionNotes: latest?.notes || null,
        status: remaining.equals(0) ? "collected" : collected.greaterThan(0) ? "partially_collected" : "issued"
      }
    });
  }
}

async function activePaymentTotal(tx: Prisma.TransactionClient, receivableId: string) {
  const aggregate = await tx.financialReceivablePayment.aggregate({
    where: { receivableId, status: "active" },
    _sum: { amount: true }
  });
  return money(aggregate._sum.amount);
}

async function paymentMutationResult(tx: Prisma.TransactionClient, receivableId: string, paymentId: string, duplicate: boolean) {
  const receivable = await tx.financialReceivable.findUnique({
    where: { id: receivableId },
    select: { id: true, collectedAmount: true, remainingAmount: true, status: true, currency: true }
  });
  const payment = await tx.financialReceivablePayment.findUnique({ where: { id: paymentId } });
  return {
    duplicate,
    receivable: receivable ? {
      ...receivable,
      collectedAmount: receivable.collectedAmount?.toFixed(2) || "0.00",
      remainingAmount: receivable.remainingAmount?.toFixed(2) || "0.00"
    } : null,
    payment: payment ? { ...payment, amount: payment.amount.toFixed(2), receivedAt: payment.receivedAt.toISOString(), createdAt: payment.createdAt.toISOString() } : null
  };
}
