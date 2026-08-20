import { Prisma } from "@prisma/client";
import { financialStatus } from "@/lib/financial-review";
import { money } from "@/lib/receivables-domain";

const ACTIVE = "active";
const TOLERANCE = new Prisma.Decimal("0.01");

export async function bootstrapLegacyPayablePayment(
  tx: Prisma.TransactionClient,
  payable: {
    id: string;
    amountPaid: Prisma.Decimal | null;
    paidAt: Date | null;
    invoiceDate: Date | null;
    createdAt: Date;
    currency: string | null;
    paymentMethod: string | null;
  },
  actorId: string
) {
  const count = await tx.financialPayablePayment.count({ where: { payableId: payable.id } });
  if (!count && payable.currency && money(payable.amountPaid).greaterThan(0)) {
    await tx.financialPayablePayment.create({
      data: {
        payableId: payable.id,
        amount: payable.amountPaid || money(0),
        currency: payable.currency,
        paidAt: payable.paidAt || payable.invoiceDate || payable.createdAt,
        paymentMethod: payable.paymentMethod,
        notes: "Sold initial pastrat din implementarea anterioara.",
        source: "legacy_opening_balance",
        verificationStatus: "manual",
        createdByUserId: actorId
      }
    });
  }
}

export async function activePayablePaymentTotal(tx: Prisma.TransactionClient, payableId: string) {
  const aggregate = await tx.financialPayablePayment.aggregate({
    where: { payableId, status: ACTIVE },
    _sum: { amount: true }
  });
  return money(aggregate._sum.amount);
}

export async function synchronizePayableLedger(tx: Prisma.TransactionClient, payableId: string) {
  const payable = await tx.financialPayable.findUnique({ where: { id: payableId } });
  if (!payable) throw new Error("Documentul furnizor nu mai exista.");
  const payments = await tx.financialPayablePayment.findMany({
    where: { payableId, status: ACTIVE },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }]
  });
  const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), money(0));
  const total = money(payable.amountToPay);
  const remaining = Prisma.Decimal.max(total.minus(paid), 0);
  const verification = payablePaymentVerification(payments.map((payment) => payment.verificationStatus));
  const latest = payments[0] || null;
  await tx.financialPayable.update({
    where: { id: payableId },
    data: {
      amountPaid: paid,
      remainingAmount: remaining,
      paidAt: remaining.lessThanOrEqualTo(TOLERANCE) ? latest?.paidAt || null : null,
      paymentMethod: latest?.paymentMethod || null,
      paymentVerification: verification,
      status: financialStatus({
        kind: "payable",
        remainingAmount: remaining,
        paidOrCollected: paid,
        dueDate: payable.dueDate
      }),
      needsReview: paid.greaterThan(total.plus(TOLERANCE))
    }
  });
  return { paid, remaining, verification };
}

export async function supersedePresumedPayablePayments(input: {
  tx: Prisma.TransactionClient;
  payableId: string;
  verifiedAmount: Prisma.Decimal;
  replacementPaymentId: string;
  actorId: string;
  requestKey: string;
}) {
  const presumed = await input.tx.financialPayablePayment.findMany({
    where: { payableId: input.payableId, status: ACTIVE, verificationStatus: "presumed" },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
  });
  let amountToReplace = input.verifiedAmount;
  let linkedReplacement = false;
  for (const payment of presumed) {
    if (amountToReplace.lessThanOrEqualTo(0)) break;
    const replacedAmount = Prisma.Decimal.min(payment.amount, amountToReplace);
    const remainder = payment.amount.minus(replacedAmount);
    await input.tx.financialPayablePayment.update({
      where: { id: payment.id },
      data: {
        status: "superseded",
        cancelledByUserId: input.actorId,
        cancelledAt: new Date(),
        cancellationReason: "Inlocuita de o tranzactie bancara verificata."
      }
    });
    if (!linkedReplacement) {
      await input.tx.financialPayablePayment.update({
        where: { id: input.replacementPaymentId },
        data: { replacesPaymentId: payment.id }
      });
      linkedReplacement = true;
    }
    if (remainder.greaterThan(0)) {
      await input.tx.financialPayablePayment.create({
        data: {
          payableId: payment.payableId,
          supplierPaymentRuleId: payment.supplierPaymentRuleId,
          requestKey: `${input.requestKey}:presumed-remainder:${payment.id}`,
          amount: remainder,
          currency: payment.currency,
          paidAt: payment.paidAt,
          paymentMethod: payment.paymentMethod,
          paymentReference: payment.paymentReference,
          notes: "Rest prezumat pastrat dupa reconcilierea bancara partiala.",
          source: payment.source,
          verificationStatus: "presumed",
          createdByUserId: input.actorId
        }
      });
    }
    amountToReplace = amountToReplace.minus(replacedAmount);
  }
  return input.verifiedAmount.minus(amountToReplace);
}

export async function applyImmediatePaymentRule(
  tx: Prisma.TransactionClient,
  input: { payableId: string; actorId: string; now?: Date }
) {
  const payable = await tx.financialPayable.findUnique({
    where: { id: input.payableId },
    include: { payments: { where: { status: ACTIVE } } }
  });
  if (!payable || !payable.supplierId || !payable.legalEntityId || !payable.currency || payable.amountToPay == null) return null;
  if (payable.payments.some((payment) => payment.verificationStatus === "verified")) return null;
  const now = input.now || new Date();
  const rules = await tx.supplierPaymentRule.findMany({
    where: {
      legalEntityId: payable.legalEntityId,
      supplierId: payable.supplierId,
      active: true,
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }]
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
  });
  const rule = rules.find((candidate) => immediatePaymentRuleApplies(candidate, payable));
  if (!rule || !["always_presume_paid", "presume_paid_if_immediate"].includes(rule.ruleMode)) return null;
  const existing = payable.payments.find((payment) => payment.supplierPaymentRuleId === rule.id && payment.verificationStatus === "presumed");
  if (existing) return existing;
  const allocated = payable.payments.reduce((sum, payment) => sum.plus(payment.amount), money(0));
  const remaining = Prisma.Decimal.max(money(payable.amountToPay).minus(allocated), 0);
  if (!remaining.greaterThan(TOLERANCE)) return null;
  const payment = await tx.financialPayablePayment.create({
    data: {
      payableId: payable.id,
      supplierPaymentRuleId: rule.id,
      requestKey: `presumed:${rule.id}:${payable.id}`,
      amount: remaining,
      currency: payable.currency,
      paidAt: payable.invoiceDate || now,
      paymentMethod: rule.defaultPaymentMethod || "card_or_cash",
      notes: "Achitare prezumata conform regulii configurate pentru furnizor.",
      source: "immediate_payment_rule",
      verificationStatus: "presumed",
      createdByUserId: input.actorId
    }
  });
  await synchronizePayableLedger(tx, payable.id);
  return payment;
}

export function immediatePaymentRuleApplies(
  rule: {
    ruleMode: string;
    documentType: string | null;
    supplierCategory: string | null;
    requireSameDayDueDate: boolean;
    maxDueDays: number | null;
    amountLimit: Prisma.Decimal | null;
  },
  payable: {
    documentType: string;
    documentDescription: string | null;
    invoiceDate: Date | null;
    dueDate: Date | null;
    amountToPay: Prisma.Decimal | null;
  }
) {
  if (rule.ruleMode === "never_auto" || rule.ruleMode === "reconciliation_only" || rule.ruleMode === "suggest_paid") return false;
  if (rule.documentType && rule.documentType !== payable.documentType) return false;
  if (rule.supplierCategory && !String(payable.documentDescription || "").toLowerCase().includes(rule.supplierCategory.toLowerCase())) return false;
  if (rule.amountLimit && money(payable.amountToPay).greaterThan(rule.amountLimit)) return false;
  const issueDay = payable.invoiceDate ? utcDay(payable.invoiceDate) : null;
  const dueDay = payable.dueDate ? utcDay(payable.dueDate) : null;
  if (rule.requireSameDayDueDate && (!issueDay || !dueDay || issueDay.getTime() !== dueDay.getTime())) return false;
  if (rule.maxDueDays != null) {
    if (!issueDay || !dueDay) return rule.maxDueDays === 0 && !payable.dueDate;
    const days = Math.round((dueDay.getTime() - issueDay.getTime()) / 86_400_000);
    if (days < 0 || days > rule.maxDueDays) return false;
  }
  return true;
}

function payablePaymentVerification(statuses: string[]) {
  const values = new Set(statuses);
  if (!values.size) return "none";
  if (values.size === 1 && values.has("verified")) return "verified";
  if (values.size === 1 && values.has("presumed")) return "presumed";
  if (values.size === 1 && values.has("manual")) return "manual";
  return "mixed";
}

function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
