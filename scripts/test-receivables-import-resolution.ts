import assert from "node:assert/strict";
import { loadEnvFile, assertSyntheticEnvironment } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env.preview.local");
const database = assertSyntheticEnvironment();

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sourceRowKey = `synthetic-ledger-conflict-${suffix}`;
const sourceHash = `synthetic-source-${suffix}`;
const canonicalKey = `SYNTHETIC|EMP0388-${suffix}|RON|CLIENT-${suffix}`;

async function main() {
  const [
    { prisma },
    { confirmReceivablesImport },
    { searchReceivableOptions },
  ] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/receivables-import-service"),
    import("../src/lib/receivables-workspace-service"),
  ]);

  let actorId: string | null = null;
  let clientId: string | null = null;
  let uploadId: string | null = null;
  let receivableId: string | null = null;

  try {
    const actor = await prisma.user.create({
      data: {
        email: `finance-import-${suffix}@preview.invalid`,
        name: "Finance Import Preview",
        passwordHash: "synthetic-not-a-login-secret",
        role: "FINANCE_OPERATOR",
      },
    });
    actorId = actor.id;

    const client = await prisma.clientAccount.create({
      data: {
        companyName: `Client Canonic Preview ${suffix}`,
        normalizedName: `client canonic preview ${suffix}`,
        taxId: `RO${Date.now()}`,
        status: "active",
        createdByUserId: actor.id,
      },
    });
    clientId = client.id;

    const upload = await prisma.financialReportUpload.create({
      data: {
        uploadedByUserId: actor.id,
        reportDate: new Date("2026-07-23T00:00:00.000Z"),
        originalFileName: `synthetic-ledger-conflict-${suffix}.xlsx`,
        fileHash: `synthetic-file-${suffix}`,
        status: "needs_review",
      },
    });
    uploadId = upload.id;

    const receivable = await prisma.financialReceivable.create({
      data: {
        uploadId: upload.id,
        clientId: client.id,
        companyName: "EXCELLENCE MEDIA PRODUCTION S.R.L.",
        companyCode: "EMP",
        invoiceNumber: `EMP0388-${suffix}`,
        normalizedInvoiceNumber: `EMP0388-${suffix}`,
        canonicalKey,
        clientName: "Denumire canonica diferita",
        invoicedAmount: "1000.00",
        collectedAmount: "600.00",
        remainingAmount: "400.00",
        currency: "RON",
        status: "partially_collected",
        includedInReport: true,
        rawRowJson: { sourceHash, sourceRowKey },
        lastReportDate: new Date("2026-07-23T00:00:00.000Z"),
      },
    });
    receivableId = receivable.id;

    const payment = await prisma.financialReceivablePayment.create({
      data: {
        receivableId: receivable.id,
        amount: "600.00",
        currency: "RON",
        receivedAt: new Date("2026-07-22T00:00:00.000Z"),
        source: "manual",
        status: "active",
        createdByUserId: actor.id,
      },
    });

    const row = await prisma.financialReceivableImportRow.create({
      data: {
        uploadId: upload.id,
        receivableId: receivable.id,
        clientId: client.id,
        companyName: "EXCELLENCE MEDIA PRODUCTION S.R.L.",
        companyCode: "EMP",
        sheetName: "LISTA INCASARI",
        rowNumber: 388,
        sourceRowKey,
        sourceHash,
        rawInvoiceNumber: `EMP0388-${suffix}`,
        normalizedInvoiceNumber: `EMP0388-${suffix}`,
        currency: "RON",
        invoiceAmount: "1000.00",
        reportCollectedAmount: "500.00",
        reportRemainingAmount: "500.00",
        clientNameRaw: "Nume din Excel care nu se potriveste",
        normalizedClientName: "nume din excel care nu se potriveste",
        status: "resolved",
        confidenceLevel: "probable",
        confidenceScore: 80,
        matchReason: "Conflict controlat intre raport si registrul aplicatiei.",
        proposedAction: "keep_active_ledger",
        resolutionAction: "confirm",
        resolutionReason:
          "Rezolvare existenta, compatibila cu importurile deja salvate.",
        resolvedByUserId: actor.id,
        resolvedAt: new Date(),
      },
    });

    const clientOptions = await searchReceivableOptions({
      type: "clients",
      query: "text fara corespondent",
      selectedId: client.id,
      take: 20,
    });
    assert.equal(
      clientOptions[0]?.id,
      client.id,
      "Clientul deja propus trebuie pastrat in lista de optiuni.",
    );

    const actorSession = {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      tokenVersion: actor.tokenVersion,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const result = await confirmReceivablesImport({
      uploadId: upload.id,
      actor: actorSession,
    });
    assert.equal(result.alreadyConfirmed, false);
    assert.equal(result.unchanged, 1);

    const [confirmedUpload, confirmedRow, confirmedReceivable, activePayments] =
      await Promise.all([
        prisma.financialReportUpload.findUniqueOrThrow({
          where: { id: upload.id },
          select: { status: true },
        }),
        prisma.financialReceivableImportRow.findUniqueOrThrow({
          where: { id: row.id },
          select: { status: true, resolutionAction: true },
        }),
        prisma.financialReceivable.findUniqueOrThrow({
          where: { id: receivable.id },
          select: { collectedAmount: true, remainingAmount: true },
        }),
        prisma.financialReceivablePayment.findMany({
          where: { receivableId: receivable.id, status: "active" },
          select: { id: true, amount: true },
        }),
      ]);

    assert.equal(confirmedUpload.status, "confirmed");
    assert.equal(confirmedRow.status, "unchanged");
    assert.equal(confirmedRow.resolutionAction, "confirm");
    assert.equal(confirmedReceivable.collectedAmount?.toFixed(2), "600.00");
    assert.equal(confirmedReceivable.remainingAmount?.toFixed(2), "400.00");
    assert.equal(activePayments.length, 1);
    assert.equal(activePayments[0]?.id, payment.id);
    assert.equal(activePayments[0]?.amount.toFixed(2), "600.00");

    console.log(
      `Receivables import resolution integration passed on DB ${database.fingerprint}.`,
    );
  } finally {
    if (actorId) {
      await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    }
    if (receivableId) {
      await prisma.financialClientCredit.deleteMany({
        where: { receivableId },
      });
      await prisma.financialReceivablePayment.deleteMany({
        where: { receivableId },
      });
    }
    if (uploadId) {
      await prisma.financialReceivableImportRow.deleteMany({
        where: { uploadId },
      });
    }
    if (receivableId) {
      await prisma.financialReceivable.deleteMany({
        where: { id: receivableId },
      });
    }
    if (uploadId) {
      await prisma.financialReportUpload.deleteMany({
        where: { id: uploadId },
      });
    }
    if (clientId) {
      await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    }
    if (actorId) {
      await prisma.user.deleteMany({ where: { id: actorId } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
