import assert from "node:assert/strict";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env.preview.local");
const database = assertSyntheticEnvironment();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  const [{ prisma }, { confirmReceivablesImport }, { receivableCanonicalKey }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/receivables-import-service"),
    import("../src/lib/receivables-domain")
  ]);
  const uploadIds: string[] = [];
  const clientIds: string[] = [];
  let actorId: string | null = null;

  try {
    const actor = await prisma.user.create({
      data: {
        email: `invoice-identity-${suffix}@preview.invalid`,
        name: "Invoice Identity Preview",
        passwordHash: "synthetic-not-a-login-secret",
        role: "FINANCE_OPERATOR"
      }
    });
    actorId = actor.id;

    const [firstClient, secondClient] = await Promise.all([
      prisma.clientAccount.create({
        data: {
          companyName: `Client A ${suffix}`,
          normalizedName: `client a ${suffix}`,
          taxId: `ROA${Date.now()}`,
          status: "active",
          createdByUserId: actor.id
        }
      }),
      prisma.clientAccount.create({
        data: {
          companyName: `Client B ${suffix}`,
          normalizedName: `client b ${suffix}`,
          taxId: `ROB${Date.now()}`,
          status: "active",
          createdByUserId: actor.id
        }
      })
    ]);
    clientIds.push(firstClient.id, secondClient.id);

    const [sourceUpload, newUpload] = await Promise.all([
      prisma.financialReportUpload.create({
        data: {
          uploadedByUserId: actor.id,
          reportDate: new Date("2026-07-22T00:00:00.000Z"),
          originalFileName: `invoice-identity-source-${suffix}.xlsx`,
          fileHash: `invoice-identity-source-${suffix}`,
          status: "confirmed"
        }
      }),
      prisma.financialReportUpload.create({
        data: {
          uploadedByUserId: actor.id,
          reportDate: new Date("2026-07-23T00:00:00.000Z"),
          originalFileName: `invoice-identity-new-${suffix}.xlsx`,
          fileHash: `invoice-identity-new-${suffix}`,
          status: "needs_review"
        }
      })
    ]);
    uploadIds.push(sourceUpload.id, newUpload.id);

    const normalizedInvoiceNumber = `emp373${suffix}`.toLowerCase();
    const canonicalKey = receivableCanonicalKey({
      companyCode: "EXCELLENCE_MEDIA",
      normalizedInvoiceNumber,
      currency: "RON"
    });
    await prisma.financialReceivable.create({
      data: {
        uploadId: sourceUpload.id,
        clientId: firstClient.id,
        companyName: "Excellence Media",
        companyCode: "EXCELLENCE_MEDIA",
        invoiceNumber: `EMP373-${suffix}`,
        normalizedInvoiceNumber,
        canonicalKey,
        clientName: firstClient.companyName,
        invoicedAmount: "1000.00",
        collectedAmount: "0.00",
        remainingAmount: "1000.00",
        currency: "RON",
        status: "open",
        includedInReport: true
      }
    });
    await prisma.financialReceivableImportRow.create({
      data: {
        uploadId: newUpload.id,
        clientId: secondClient.id,
        companyName: "Excellence Media",
        companyCode: "EXCELLENCE_MEDIA",
        sheetName: "LISTA INCASARI",
        rowNumber: 373,
        sourceRowKey: `invoice-identity-row-${suffix}`,
        sourceHash: `invoice-identity-hash-${suffix}`,
        rawInvoiceNumber: `EMP373-${suffix}`,
        normalizedInvoiceNumber,
        currency: "RON",
        invoiceAmount: "1000.00",
        reportCollectedAmount: "0.00",
        reportRemainingAmount: "1000.00",
        clientNameRaw: secondClient.companyName,
        normalizedClientName: secondClient.normalizedName,
        status: "resolved",
        confidenceLevel: "confirmed",
        confidenceScore: 100,
        resolutionAction: "confirm",
        resolvedByUserId: actor.id,
        resolvedAt: new Date()
      }
    });

    const actorSession = {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      tokenVersion: actor.tokenVersion,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    await assert.rejects(
      confirmReceivablesImport({ uploadId: newUpload.id, actor: actorSession }),
      /alt client/,
      "Aceeasi factura nu poate fi creata pentru al doilea client."
    );

    const [activeCount, unchangedUpload] = await Promise.all([
      prisma.financialReceivable.count({
        where: {
          companyCode: "EXCELLENCE_MEDIA",
          normalizedInvoiceNumber,
          currency: "RON",
          includedInReport: true
        }
      }),
      prisma.financialReportUpload.findUniqueOrThrow({
        where: { id: newUpload.id },
        select: { status: true }
      })
    ]);
    assert.equal(activeCount, 1);
    assert.equal(unchangedUpload.status, "needs_review");
    console.log(`Receivable invoice identity integration passed on DB ${database.fingerprint}.`);
  } finally {
    if (actorId) await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    if (uploadIds.length) {
      const receivables = await prisma.financialReceivable.findMany({
        where: { uploadId: { in: uploadIds } },
        select: { id: true }
      });
      const receivableIds = receivables.map((row) => row.id);
      if (receivableIds.length) {
        await prisma.financialClientCredit.deleteMany({ where: { receivableId: { in: receivableIds } } });
        await prisma.financialReceivablePayment.deleteMany({ where: { receivableId: { in: receivableIds } } });
      }
      await prisma.financialReceivableImportRow.deleteMany({ where: { uploadId: { in: uploadIds } } });
      await prisma.financialReceivable.deleteMany({ where: { uploadId: { in: uploadIds } } });
      await prisma.financialReportUpload.deleteMany({ where: { id: { in: uploadIds } } });
    }
    if (clientIds.length) await prisma.clientAccount.deleteMany({ where: { id: { in: clientIds } } });
    if (actorId) await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
