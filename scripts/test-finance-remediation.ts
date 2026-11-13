import assert from "node:assert/strict";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { allocateBankTransaction } from "../src/lib/financial-reconciliation-mutations";
import {
  cancelReceivablePayment,
  recordReceivablePayment,
  correctReceivablePayment,
} from "../src/lib/receivables-payment-service";
import { receivableNetAmount } from "../src/lib/receivable-adjustments";

async function main() {
  loadEnvFile();
  assertSyntheticEnvironment();
  const u = new URL(process.env.DATABASE_URL || "");
  assert.ok(["127.0.0.1", "localhost"].includes(u.hostname));
  assert.ok(u.pathname.includes("preview"));
  const prefix = `finance-regression-${Date.now()}`;
  const ids = Object.fromEntries(
    [
      "entity",
      "client",
      "upload",
      "account",
      "statement",
      "bank",
      "invoice",
      "adjustment",
      "retryInvoice",
    ].map((k) => [k, `${prefix}-${k}`]),
  );
  const invoiceIds = [ids.invoice, ids.adjustment, ids.retryInvoice];
  const actorUser = await prisma.user.create({
    data: {
      id: `${prefix}-actor`,
      email: `${prefix}@synthetic.test`,
      name: "Finance synthetic regression",
      passwordHash: "unusable-synthetic-fixture",
      role: "FINANCE_OPERATOR",
      active: true,
    },
    select: { id: true },
  });
  const actor = { id: actorUser.id, role: "FINANCE_OPERATOR" } as any;
  const results: any[] = [];
  try {
    await prisma.financialLegalEntity.create({
      data: {
        id: ids.entity,
        code: prefix,
        legalName: "Synthetic Finance Audit",
        normalizedName: prefix,
      },
    });
    await prisma.clientAccount.create({
      data: {
        id: ids.client,
        companyName: "Synthetic Finance Audit",
        normalizedName: prefix,
        status: "active",
      },
    });
    await prisma.financialReportUpload.create({
      data: {
        id: ids.upload,
        originalFileName: `${prefix}.xlsx`,
        fileHash: prefix,
        status: "confirmed",
        activeVersion: false,
        legalEntityId: ids.entity,
      },
    });
    await prisma.financialBankAccount.create({
      data: {
        id: ids.account,
        legalEntityId: ids.entity,
        ibanOriginal: "SYNTHETIC-AUDIT",
        ibanNormalized: prefix,
        currency: "RON",
      },
    });
    await prisma.financialBankStatement.create({
      data: {
        id: ids.statement,
        uploadId: ids.upload,
        legalEntityId: ids.entity,
        bankAccountId: ids.account,
        statementFingerprint: prefix,
        periodStart: new Date("2026-01-01Z"),
        periodEnd: new Date("2026-12-31Z"),
        currency: "RON",
      },
    });
    await prisma.financialBankTransaction.create({
      data: {
        id: ids.bank,
        statementId: ids.statement,
        legalEntityId: ids.entity,
        bankAccountId: ids.account,
        fingerprint: prefix,
        bookedAt: new Date("2026-11-01Z"),
        currency: "RON",
        creditAmount: "900",
        debitAmount: "0",
        description: "Synthetic audit only",
        classification: "customer_receipt",
      },
    });
    const common = {
      uploadId: ids.upload,
      clientId: ids.client,
      legalEntityId: ids.entity,
      companyName: "Synthetic Finance Audit",
      companyCode: prefix,
      currency: "RON",
      dueDate: new Date("2027-01-01Z"),
      includedInReport: true,
      needsReview: false,
    };
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: ids.adjustment,
        invoiceNumber: `${prefix}-credit`,
        invoicedAmount: "-200",
        collectedAmount: "0",
        remainingAmount: "0",
        status: "excluded",
        includedInReport: false,
      },
    });
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: ids.invoice,
        invoiceNumber: `${prefix}-invoice`,
        invoicedAmount: "1000",
        collectedAmount: "0",
        remainingAmount: "800",
        status: "in_term",
        rawRowJson: {
          smartBillAdjustments: [
            { adjustmentReceivableId: ids.adjustment, adjustmentAmount: 200 },
          ],
        },
      },
    });
    const allocationInput = {
      bankTransactionId: ids.bank,
      allocations: [
        {
          direction: "receivable" as const,
          documentId: ids.invoice,
          amount: "900",
        },
      ],
      requestKey: `${prefix}-allocate`,
      actor,
    };
    await assert.rejects(
      () => allocateBankTransaction(allocationInput),
      /soldul net/,
    );
    assert.equal(
      await prisma.financialReceivablePayment.count({
        where: { receivableId: ids.invoice },
      }),
      0,
    );
    allocationInput.allocations[0].amount = "800";
    await allocateBankTransaction(allocationInput);
    const replay = await allocateBankTransaction(allocationInput);
    assert.equal(replay.duplicate, true);
    await assert.rejects(
      () =>
        allocateBankTransaction({
          ...allocationInput,
          allocations: [{ ...allocationInput.allocations[0], amount: "700" }],
        }),
      /alte date/,
    );
    const invoice = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: ids.invoice },
    });
    assert.equal(invoice.collectedAmount?.toFixed(2), "800.00");
    assert.equal(invoice.remainingAmount?.toFixed(2), "0.00");
    assert.equal(
      await prisma.financialClientCredit.count({
        where: { clientId: ids.client },
      }),
      0,
    );
    const payment = await prisma.financialReceivablePayment.findFirstOrThrow({
      where: { receivableId: ids.invoice, status: "active" },
    });
    await assert.rejects(
      () =>
        correctReceivablePayment({
          paymentId: payment.id,
          amount: "700",
          receivedAt: new Date("2026-11-01Z"),
          reason: "Regression correction",
          requestKey: `${prefix}-bank-correction`,
          actor,
        }),
      /Reconciliere bancară/,
    );
    await cancelReceivablePayment({
      paymentId: payment.id,
      reason: "Synthetic regression cancellation",
      actor,
    });
    const after = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: ids.invoice },
    });
    const afterBank = await prisma.financialBankTransaction.findUniqueOrThrow({
      where: { id: ids.bank },
    });
    assert.equal(after.remainingAmount?.toFixed(2), "800.00");
    assert.equal(afterBank.reconciliationStatus, "unmatched");
    assert.equal(
      await prisma.financialReceivablePayment.count({
        where: { bankTransactionId: ids.bank, status: "active" },
      }),
      0,
    );
    results.push({
      id: "FIN-001/002",
      netCapacityEnforced: true,
      bankCancellationSynchronized: true,
      replayPayloadBound: true,
    });
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: ids.retryInvoice,
        invoiceNumber: `prefix-retry`,
        invoicedAmount: "1000",
        collectedAmount: "0",
        remainingAmount: "1000",
        status: "in_term",
      },
    });
    const intent = {
      receivableId: ids.retryInvoice,
      amount: "400",
      receivedAt: new Date("2026-11-01Z"),
      requestKey: `${prefix}-payment`,
      actor,
    };
    await recordReceivablePayment(intent);
    assert.equal((await recordReceivablePayment(intent)).duplicate, true);
    await assert.rejects(
      () => recordReceivablePayment({ ...intent, amount: "300" }),
      /alte date/,
    );
    let retryInvoice = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: ids.retryInvoice },
    });
    assert.equal(
      await prisma.financialReceivablePayment.count({
        where: { receivableId: ids.retryInvoice, status: "active" },
      }),
      1,
    );
    assert.equal(retryInvoice.collectedAmount?.toFixed(2), "400.00");
    const original = await prisma.financialReceivablePayment.findUniqueOrThrow({
      where: { requestKey: intent.requestKey },
    });
    const correction = {
      ...intent,
      paymentId: original.id,
      amount: "350",
      reason: "Regression correction",
      requestKey: `${prefix}-correction`,
    };
    await correctReceivablePayment(correction);
    assert.equal((await correctReceivablePayment(correction)).duplicate, true);
    await assert.rejects(
      () => correctReceivablePayment({ ...correction, amount: "300" }),
      /alte date/,
    );
    retryInvoice = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: ids.retryInvoice },
    });
    assert.equal(retryInvoice.collectedAmount?.toFixed(2), "350.00");
    assert.equal(
      await prisma.financialReceivablePayment.count({
        where: { receivableId: ids.retryInvoice, status: "active" },
      }),
      1,
    );
    results.push({
      id: "FIN-003",
      manualRetrySingleEffect: true,
      correctionRetrySingleEffect: true,
    });
    const concurrent = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        recordReceivablePayment({
          ...intent,
          amount: "400",
          requestKey: `${prefix}-concurrent-${suffix}`,
        }),
      ),
    );
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    retryInvoice = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: ids.retryInvoice },
    });
    assert.equal(retryInvoice.collectedAmount?.toFixed(2), "750.00");
    results.push({
      id: "FIN-003-concurrent",
      concurrentDifferentIntentsRespectCapacity: true,
    });
    const overpayment = await recordReceivablePayment({
      ...intent,
      amount: "300",
      confirmOverpayment: true,
      requestKey: `${prefix}-explicit-credit`,
    });
    const credit = await prisma.financialClientCredit.findFirstOrThrow({
      where: { clientId: ids.client, sourcePaymentId: overpayment.payment!.id },
    });
    assert.equal(credit.amount.toFixed(2), "50.00");
    await prisma.financialClientCredit.update({
      where: { id: credit.id },
      data: { remainingAmount: "49" },
    });
    await assert.rejects(
      () =>
        cancelReceivablePayment({
          paymentId: overpayment.payment!.id,
          reason: "Synthetic consumed-credit reversal",
          actor,
        }),
      /deja utilizat/,
    );
    await prisma.financialClientCredit.update({
      where: { id: credit.id },
      data: { remainingAmount: "50" },
    });
    await cancelReceivablePayment({
      paymentId: overpayment.payment!.id,
      reason: "Synthetic unused-credit reversal",
      actor,
    });
    assert.equal(
      (
        await prisma.financialClientCredit.findUniqueOrThrow({
          where: { id: credit.id },
        })
      ).status,
      "cancelled",
    );
    results.push({
      id: "FIN-002-credit",
      consumedCreditCannotBeSilentlyCancelled: true,
    });
  } finally {
    const payments = await prisma.financialReceivablePayment.findMany({
      where: { receivableId: { in: invoiceIds } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [ids.bank, ...payments.map((p) => p.id)] } },
    });
    await prisma.financialClientCredit.deleteMany({
      where: { clientId: ids.client },
    });
    await prisma.financialReceivablePayment.deleteMany({
      where: { receivableId: { in: invoiceIds } },
    });
    await prisma.financialReceivable.deleteMany({
      where: { id: { in: invoiceIds } },
    });
    await prisma.financialBankTransaction.deleteMany({
      where: { id: ids.bank },
    });
    await prisma.financialBankStatement.deleteMany({
      where: { id: ids.statement },
    });
    await prisma.financialBankAccount.deleteMany({
      where: { id: ids.account },
    });
    await prisma.financialReportUpload.deleteMany({
      where: { id: ids.upload },
    });
    await prisma.clientAccount.deleteMany({ where: { id: ids.client } });
    await prisma.financialLegalEntity.deleteMany({ where: { id: ids.entity } });
    await prisma.user.delete({ where: { id: actorUser.id } });
    assert.equal(
      await prisma.financialReceivable.count({
        where: { id: { in: invoiceIds } },
      }),
      0,
    );
    assert.equal(
      await prisma.financialLegalEntity.count({ where: { id: ids.entity } }),
      0,
    );
  }
  console.log(
    JSON.stringify({ results, cleanup: "own fixtures removed" }, null, 2),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
