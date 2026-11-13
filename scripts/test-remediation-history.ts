import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import {
  auditRemediationHistory,
  withReadOnlyInventorySnapshot,
} from "./audit-remediation-history";

async function main() {
  loadEnvFile();
  assertSyntheticEnvironment();
  const url = process.env.DATABASE_URL || "";
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  const prefix = `aggregate-inventory-${Date.now()}`;
  const userIds = [`${prefix}-user1`, `${prefix}-user2`];
  const clientId = `${prefix}-client`,
    categoryId = `${prefix}-category`,
    locationId = `${prefix}-location`,
    uploadId = `${prefix}-upload`,
    invoiceId = `${prefix}-invoice`,
    bankId = `${prefix}-bank`;
  const now = new Date("2026-11-13T12:00:00Z");
  const before = await auditRemediationHistory(url, { now, pageSize: 1 });
  const counts = (report: typeof before) =>
    report.aggregates.find(
      (row) => row.entity === "FOCUS_MEDIA" && row.currency === "RON",
    )?.counts || {};
  let entity = await prisma.financialLegalEntity.findUnique({
    where: { code: "FOCUS_MEDIA" },
  });
  const ownsEntity = !entity;
  if (!entity)
    entity = await prisma.financialLegalEntity.create({
      data: {
        id: `${prefix}-entity`,
        code: "FOCUS_MEDIA",
        legalName: "Synthetic inventory entity",
        normalizedName: prefix,
      },
    });
  const entityId = entity.id;
  async function fixtureFingerprint() {
    const rows = await Promise.all([
      prisma.reservation.findMany({
        where: { locationId },
        orderBy: { id: "asc" },
      }),
      prisma.financialReceivable.findMany({
        where: { clientId },
        orderBy: { id: "asc" },
      }),
      prisma.financialReceivablePayment.findMany({
        where: { bankTransactionId: bankId },
        orderBy: { id: "asc" },
      }),
      prisma.financialBankTransaction.findMany({ where: { id: bankId } }),
    ]);
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  try {
    await prisma.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        email: `${prefix}-${index}@synthetic.test`,
        name: "Private fixture seller name",
        role: "SALES_AGENT",
        passwordHash: "unusable-synthetic",
      })),
    });
    await prisma.clientAccount.create({
      data: {
        id: clientId,
        companyName: "Private fixture client name",
        normalizedName: prefix,
      },
    });
    await prisma.category.create({
      data: { id: categoryId, name: prefix, slug: prefix },
    });
    await prisma.location.create({
      data: { id: locationId, code: prefix, categoryId },
    });
    await prisma.reservation.createMany({
      data: [0, 1].map((index) => ({
        id: `${prefix}-reservation${index}`,
        locationId,
        clientId,
        clientName: "Private fixture client name",
        status: "BOOKED",
        ownerId: userIds[index],
        sellerUserId: userIds[index],
        contractGroupId: prefix,
        contractCompany: "Focus Media",
        currency: "RON",
        periodStart: new Date(index ? "2026-01-15Z" : "2026-01-01Z"),
        periodEnd: new Date(index ? "2026-01-31Z" : "2026-01-15Z"),
      })),
    });
    await prisma.reservation.create({
      data: {
        id: `${prefix}-expired-hold`,
        locationId,
        clientId,
        clientName: "Private fixture client name",
        status: "HOLD",
        contractCompany: "Focus Media",
        currency: "RON",
        periodStart: new Date("2026-01-01Z"),
        periodEnd: new Date("2026-01-31Z"),
        holdExpiresAt: new Date("2026-01-02Z"),
      },
    });
    await prisma.financialReportUpload.create({
      data: {
        id: uploadId,
        originalFileName: `${prefix}.xlsx`,
        fileHash: prefix,
        status: "confirmed",
        legalEntityId: entityId,
      },
    });
    await prisma.financialBankAccount.create({
      data: {
        id: `${prefix}-account`,
        legalEntityId: entityId,
        ibanOriginal: "SYNTHETIC",
        ibanNormalized: prefix,
        currency: "RON",
      },
    });
    await prisma.financialBankStatement.create({
      data: {
        id: `${prefix}-statement`,
        uploadId,
        legalEntityId: entityId,
        bankAccountId: `${prefix}-account`,
        statementFingerprint: prefix,
        periodStart: new Date("2026-01-01Z"),
        periodEnd: now,
        currency: "RON",
      },
    });
    await prisma.financialBankTransaction.create({
      data: {
        id: bankId,
        statementId: `${prefix}-statement`,
        legalEntityId: entityId,
        bankAccountId: `${prefix}-account`,
        fingerprint: prefix,
        bookedAt: now,
        currency: "RON",
        creditAmount: "100",
        debitAmount: "0",
        description: "Private fixture bank narrative",
        classification: "customer_receipt",
        reconciliationStatus: "matched",
      },
    });
    const common = {
      uploadId,
      clientId,
      legalEntityId: entityId,
      companyCode: "FOCUS_MEDIA",
      companyName: "Private fixture company name",
      currency: "RON",
      includedInReport: true,
      needsReview: false,
      status: "in_term",
    };
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: invoiceId,
        invoiceNumber: "Private fixture invoice number",
        invoicedAmount: "1000",
        collectedAmount: "100",
        remainingAmount: "999",
        rawRowJson: {
          privateUntrustedNote: "Do not expose this content",
          smartBillAdjustments: [
            {
              adjustmentReceivableId: `${prefix}-credit`,
              adjustmentAmount: 200,
            },
          ],
        },
      },
    });
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: `${prefix}-legacy`,
        invoicedAmount: "100",
        collectedAmount: "50",
        remainingAmount: "50",
      },
    });
    await prisma.financialReceivablePayment.create({
      data: {
        id: `${prefix}-payment`,
        receivableId: invoiceId,
        bankTransactionId: bankId,
        amount: "50",
        currency: "RON",
        receivedAt: now,
        source: "bank",
        status: "active",
      },
    });
    const fingerprint = await fixtureFingerprint();
    const report = await auditRemediationHistory(url, { now, pageSize: 1 });
    const baseline = counts(before),
      actual = counts(report);
    for (const metric of [
      "mixedOwnerGroups",
      "mixedSellerGroups",
      "mixedOwnerAndSellerGroups",
      "effectiveInclusiveOverlapPairs",
      "bookedBookedOverlapPairs",
      "storedRemainingVsCanonicalMismatch",
      "storedCollectedVsActiveLedgerMismatch",
      "collectedBalanceWithoutLedgerRows",
      "bankAllocationStatusMismatch",
    ])
      assert.equal(actual[metric] || 0, (baseline[metric] || 0) + 1, metric);
    assert.equal(
      await fixtureFingerprint(),
      fingerprint,
      "inventory must not repair or mutate fixture data",
    );
    assert.deepEqual(
      report,
      await auditRemediationHistory(url, { now, pageSize: 2 }),
      "page boundaries must not change aggregate counts",
    );
    const serialized = JSON.stringify(report);
    for (const privateValue of [
      prefix,
      clientId,
      invoiceId,
      "Private fixture",
      "Do not expose this content",
      "SYNTHETIC",
    ])
      assert.ok(
        !serialized.includes(privateValue),
        "output must contain no identifiers, names, narratives or raw rows",
      );
    for (const row of report.aggregates) {
      assert.deepEqual(Object.keys(row).sort(), [
        "counts",
        "currency",
        "entity",
      ]);
      assert.ok(
        Object.values(row.counts).every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ),
      );
    }
    await assert.rejects(
      () =>
        withReadOnlyInventorySnapshot(url, (db) =>
          db.query(
            "UPDATE portfolio_financial_receivables SET remainingAmount=0 WHERE id=?",
            [invoiceId],
          ),
        ),
      (error: any) => error.code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION",
      "MySQL must enforce read-only mode even if a caller attempts DML",
    );
    assert.equal(await fixtureFingerprint(), fingerprint);
    await withReadOnlyInventorySnapshot(url, async (db) => {
      const [first] = await db.query<any[]>(
        "SELECT collectedAmount FROM portfolio_financial_receivables WHERE id=?",
        [invoiceId],
      );
      await prisma.financialReceivable.update({
        where: { id: invoiceId },
        data: { collectedAmount: "200" },
      });
      const [second] = await db.query<any[]>(
        "SELECT collectedAmount FROM portfolio_financial_receivables WHERE id=?",
        [invoiceId],
      );
      assert.equal(
        String(first[0].collectedAmount),
        String(second[0].collectedAmount),
        "read-only RepeatableRead snapshot stays consistent across external writes",
      );
    });
    console.log(
      JSON.stringify({
        ok: true,
        knownAnomaliesDetected: true,
        inclusiveBoundaryOverlapDetected: true,
        expiredHoldExcluded: true,
        deterministicPaging: true,
        serverEnforcedReadOnly: true,
        consistentSnapshot: true,
        aggregatePrivacy: true,
      }),
    );
  } finally {
    await prisma.financialReceivablePayment.deleteMany({
      where: { bankTransactionId: bankId },
    });
    await prisma.financialReceivable.deleteMany({ where: { clientId } });
    await prisma.financialBankTransaction.deleteMany({ where: { id: bankId } });
    await prisma.financialBankStatement.deleteMany({
      where: { id: `${prefix}-statement` },
    });
    await prisma.financialBankAccount.deleteMany({
      where: { id: `${prefix}-account` },
    });
    await prisma.financialReportUpload.deleteMany({ where: { id: uploadId } });
    await prisma.reservation.deleteMany({ where: { locationId } });
    await prisma.location.deleteMany({ where: { id: locationId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (ownsEntity)
      await prisma.financialLegalEntity.delete({ where: { id: entityId } });
  }
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Synthetic inventory test failed",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
