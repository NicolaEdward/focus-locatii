import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env.local");

type Options = {
  file: string;
  company: string;
  invoice: string;
  linkedReceivableId: string;
  uploadId: string;
  reason: string;
  write: boolean;
};

async function main() {
  const options = readOptions(process.argv.slice(2));
  const [{ prisma }, smartBill, paymentService, financialReview] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/smartbill-import"),
    import("../src/lib/receivables-payment-service"),
    import("../src/lib/financial-review")
  ]);
  try {
    const companyContext = smartBill.resolveSmartBillCompanyContext(options.company);
    const parsed = await smartBill.parseSmartBillCustomerInvoices(fs.readFileSync(options.file), {
      fileName: path.basename(options.file)
    });
    const adjustmentRow = parsed.rows.find((row) =>
      row.kind === "customer_invoice" && row.normalizedInvoiceNumber === normalizeInvoice(options.invoice)
    );
    if (!adjustmentRow || adjustmentRow.kind !== "customer_invoice") {
      throw new Error(`Factura ${options.invoice} nu există în fișierul SmartBill.`);
    }
    if (adjustmentRow.totalAmount >= -0.01) throw new Error("Documentul selectat nu este o ajustare negativă.");

    const [upload, actor, existingAdjustment, existingRows] = await Promise.all([
      prisma.financialReportUpload.findUnique({
        where: { id: options.uploadId },
        select: { id: true, legalEntityId: true, uploadedByUserId: true, summaryJson: true }
      }),
      prisma.financialReportUpload.findUnique({
        where: { id: options.uploadId },
        select: { uploadedBy: { select: { id: true, role: true } } }
      }).then((value) => value?.uploadedBy || null),
      prisma.financialReceivable.findUnique({
        where: { sourceFingerprint: `${companyContext.companyCode}:${adjustmentRow.dedupeKey}` },
        select: { id: true, invoiceNumber: true }
      }),
      loadExistingRows(prisma, companyContext.companyCode)
    ]);
    if (!upload || !upload.legalEntityId) throw new Error("Importul SmartBill sau entitatea juridică nu mai există.");
    if (!actor || !["COO", "SUPER_ADMIN", "FINANCE_OPERATOR"].includes(actor.role)) {
      throw new Error("Importul nu are un actor autorizat pentru remediere financiară.");
    }
    if (existingAdjustment) {
      console.log(JSON.stringify({ mode: "idempotent", adjustmentId: existingAdjustment.id, invoiceNumber: existingAdjustment.invoiceNumber }, null, 2));
      return;
    }

    const match = smartBill.findSmartBillAdjustmentMatch(adjustmentRow, existingRows, companyContext);
    if (match?.kind !== "auto" || match.linkedRow?.id !== options.linkedReceivableId) {
      throw new Error("Storno-ul nu mai are o singură potrivire deterministă cu factura indicată.");
    }
    const application = smartBill.calculateSmartBillReceivableAdjustment({ row: adjustmentRow, receivable: match.linkedRow });
    const report = {
      mode: options.write ? "write" : "dry-run",
      adjustmentInvoice: adjustmentRow.invoiceNumber,
      adjustmentAmount: adjustmentRow.totalAmount,
      linkedReceivableId: match.linkedRow.id,
      linkedInvoiceNumber: match.linkedRow.invoiceNumber,
      previousRemainingAmount: Number(match.linkedRow.remainingAmount || 0),
      remainingAmountAfterAdjustment: application.remainingAmount,
      creditDelta: application.creditDelta,
      reason: options.reason
    };
    if (!options.write) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const [currentRows, currentUpload, currentAdjustment] = await Promise.all([
        loadExistingRows(tx, companyContext.companyCode),
        tx.financialReportUpload.findUnique({ where: { id: upload.id }, select: { summaryJson: true } }),
        tx.financialReceivable.findUnique({
          where: { sourceFingerprint: `${companyContext.companyCode}:${adjustmentRow.dedupeKey}` },
          select: { id: true }
        })
      ]);
      if (currentAdjustment) return { adjustmentId: currentAdjustment.id, idempotent: true };
      const currentMatch = smartBill.findSmartBillAdjustmentMatch(adjustmentRow, currentRows, companyContext);
      if (currentMatch?.kind !== "auto" || currentMatch.linkedRow?.id !== options.linkedReceivableId) {
        throw new Error("Potrivirea storno s-a schimbat în timpul remedierii.");
      }
      const currentApplication = smartBill.calculateSmartBillReceivableAdjustment({ row: adjustmentRow, receivable: currentMatch.linkedRow });
      const adjustmentData = smartBill.smartBillCustomerAdjustmentReceivableData({
        row: adjustmentRow,
        uploadId: upload.id,
        companyContext,
        linkedReceivable: currentMatch.linkedRow,
        reviewedByUserId: actor.id
      });
      const adjustment = await tx.financialReceivable.create({
        data: {
          ...adjustmentData,
          legalEntityId: upload.legalEntityId,
          rawRowJson: adjustmentData.rawRowJson as Prisma.InputJsonValue
        }
      });
      await tx.financialReceivable.update({
        where: { id: currentMatch.linkedRow.id },
        data: {
          rawRowJson: appendAdjustmentMetadata(
            currentMatch.linkedRow.rawRowJson,
            adjustmentRow.dedupeKey,
            adjustmentRow.invoiceNumber,
            adjustment.id,
            currentApplication.adjustmentAmount,
            currentApplication.remainingAmount
          ) as Prisma.InputJsonValue,
          reviewedByUserId: actor.id,
          reviewedAt: new Date()
        }
      });
      if (currentApplication.creditDelta > 0 && currentMatch.linkedRow.clientId && currentMatch.linkedRow.currency) {
        await tx.financialClientCredit.create({
          data: {
            clientId: currentMatch.linkedRow.clientId,
            receivableId: adjustment.id,
            companyName: currentMatch.linkedRow.companyName || companyContext.companyName,
            companyCode: companyContext.companyCode,
            currency: currentMatch.linkedRow.currency,
            amount: currentApplication.creditDelta,
            remainingAmount: currentApplication.creditDelta,
            reason: `Credit rezultat din storno aplicat facturii ${currentMatch.linkedRow.invoiceNumber}.`,
            createdByUserId: actor.id
          }
        });
      }
      await paymentService.synchronizeReceivableLedger(tx, currentMatch.linkedRow.id);
      await tx.financialReportUpload.update({
        where: { id: upload.id },
        data: {
          rowsCreated: { increment: 1 },
          rowsFailed: { decrement: 1 },
          warningCount: { decrement: 1 },
          summaryJson: updateUploadSummary(currentUpload?.summaryJson, adjustment.id, currentMatch.linkedRow.id) as Prisma.InputJsonValue
        }
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "receivable.smartbill_adjustment_remediated",
          entityType: "financial_receivable",
          entityId: currentMatch.linkedRow.id,
          metadata: {
            adjustmentReceivableId: adjustment.id,
            adjustmentInvoiceNumber: adjustmentRow.invoiceNumber,
            adjustmentAmount: currentApplication.adjustmentAmount,
            previousRemainingAmount: Number(currentMatch.linkedRow.remainingAmount || 0),
            remainingAmountAfterAdjustment: currentApplication.remainingAmount,
            sourceUploadId: upload.id,
            sourceFile: path.basename(options.file),
            reason: options.reason
          }
        }
      });
      return { adjustmentId: adjustment.id, idempotent: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });

    await financialReview.recalculateFinancialSnapshots(upload.id);
    const updated = await prisma.financialReceivable.findUniqueOrThrow({
      where: { id: options.linkedReceivableId },
      select: { status: true, invoicedAmount: true, collectedAmount: true, remainingAmount: true }
    });
    console.log(JSON.stringify({ ...report, ...result, updated }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function readOptions(args: string[]): Options {
  const values = new Map(args.filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const separator = arg.indexOf("=");
    return [arg.slice(2, separator), arg.slice(separator + 1)];
  }));
  const options = {
    file: path.resolve(values.get("file") || ""),
    company: values.get("company") || "",
    invoice: values.get("invoice") || "",
    linkedReceivableId: values.get("linked-receivable-id") || "",
    uploadId: values.get("upload-id") || "",
    reason: values.get("reason") || "",
    write: args.includes("--write")
  };
  if (!options.file || !fs.existsSync(options.file) || !options.company || !options.invoice || !options.linkedReceivableId || !options.uploadId || !options.reason) {
    throw new Error("Sunt obligatorii --file, --company, --invoice, --linked-receivable-id, --upload-id și --reason.");
  }
  return options;
}

async function loadExistingRows(client: any, companyCode: string) {
  const rows = await client.financialReceivable.findMany({
    where: { companyCode, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
    include: { client: { select: { taxId: true, normalizedName: true } } }
  });
  return rows.map((row: any) => ({
    id: row.id,
    companyName: row.companyName,
    companyCode: row.companyCode,
    normalizedInvoiceNumber: row.normalizedInvoiceNumber,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    clientId: row.clientId,
    partnerId: row.partnerId,
    clientName: row.clientName,
    entityTaxId: row.client?.taxId || null,
    entityNormalizedName: row.client?.normalizedName || null,
    currency: row.currency,
    amount: row.invoicedAmount,
    remainingAmount: row.remainingAmount,
    paidOrCollectedAmount: row.collectedAmount,
    rawRowJson: row.rawRowJson,
    includedInReport: row.includedInReport,
    status: row.status
  }));
}

function appendAdjustmentMetadata(
  raw: unknown,
  dedupeKey: string,
  invoiceNumber: string,
  adjustmentReceivableId: string,
  adjustmentAmount: number,
  remainingAmount: number
) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw as Record<string, unknown> } : {};
  const previous = Array.isArray(base.smartBillAdjustments) ? base.smartBillAdjustments : [];
  if (previous.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).smartBillDedupeKey === dedupeKey)) {
    throw new Error("Storno-ul există deja în metadatele facturii.");
  }
  return {
    ...base,
    smartBillAdjustments: [...previous, {
      smartBillDedupeKey: dedupeKey,
      adjustmentReceivableId,
      adjustmentInvoiceNumber: invoiceNumber,
      adjustmentAmount,
      remainingAmountAfterAdjustment: remainingAmount,
      appliedAt: new Date().toISOString()
    }]
  };
}

function updateUploadSummary(raw: unknown, adjustmentId: string, linkedReceivableId: string) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw as Record<string, unknown> } : {};
  return {
    ...base,
    createdReceivables: Number(base.createdReceivables || 0) + 1,
    updatedReceivables: Number(base.updatedReceivables || 0) + 1,
    skippedNeedsReview: Math.max(0, Number(base.skippedNeedsReview || 0) - 1),
    createdReceivableIds: [...arrayOfStrings(base.createdReceivableIds), adjustmentId],
    updatedReceivableIds: [...new Set([...arrayOfStrings(base.updatedReceivableIds), linkedReceivableId])],
    remediation: {
      kind: "smartbill_adjustment",
      adjustmentId,
      linkedReceivableId,
      appliedAt: new Date().toISOString()
    }
  };
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeInvoice(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
