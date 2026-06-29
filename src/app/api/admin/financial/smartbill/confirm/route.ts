import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeClientName } from "@/lib/clients";
import { recalculateFinancialSnapshots } from "@/lib/financial-review";
import { prisma } from "@/lib/prisma";
import {
  buildSmartBillPreview,
  findSmartBillDuplicate,
  findSmartBillAdjustmentMatch,
  importableAction,
  isSmartBillSourceDuplicate,
  matchSmartBillEntity,
  normalizeCompanyName,
  normalizeFiscalCode,
  resolveSmartBillCompanyContext,
  calculateSmartBillReceivableAdjustment,
  smartBillCustomerAdjustmentReceivableData,
  smartBillCustomerReceivableData,
  smartBillSupplierPayableData,
  verifySmartBillImportToken,
  type SmartBillCompanyContext,
  type SmartBillCustomerInvoiceRow,
  type SmartBillExistingFinancialRow,
  type SmartBillMatchEntity,
  type SmartBillParsedRow,
  type SmartBillReportType,
  type SmartBillSupplierDocumentRow
} from "@/lib/smartbill-import";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const schema = z.object({
  importToken: z.string().min(20),
  companyName: z.string().trim().min(1, "Firma SmartBill este obligatorie."),
  reportType: z.enum(["customer_invoices", "supplier_documents"])
});

type SmartBillConfirmSummary = {
  uploadId: string;
  reportType: SmartBillReportType;
  companyName: string;
  companyCode: string;
  scanned: number;
  createdClients: number;
  createdSuppliers: number;
  createdReceivables: number;
  updatedReceivables: number;
  createdPayables: number;
  updatedPayables: number;
  skippedDuplicates: number;
  skippedNeedsReview: number;
  skippedInvalid: number;
  skippedIgnored: number;
  skippedUnsafe: number;
  createdClientIds: string[];
  createdSupplierIds: string[];
  createdReceivableIds: string[];
  updatedReceivableIds: string[];
  createdPayableIds: string[];
  updatedPayableIds: string[];
};

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
  if (response || !session) return response;

  try {
    const body = schema.parse(await request.json());
    const companyContext = resolveSmartBillCompanyContext(body.companyName);
    const payload = verifySmartBillImportToken(body.importToken);
    if (body.reportType !== payload.reportType) {
      return NextResponse.json({ error: "Tipul de raport nu corespunde preview-ului SmartBill." }, { status: 400, headers: noStoreHeaders });
    }
    if (companyContext.companyName !== payload.companyName || companyContext.companyCode !== payload.companyCode) {
      return NextResponse.json({ error: "Firma aleasa nu corespunde preview-ului SmartBill semnat." }, { status: 400, headers: noStoreHeaders });
    }
    validateSmartBillPayloadRows(payload.reportType, payload.rows);
    const context = await loadSmartBillConfirmContext(payload.reportType, companyContext);
    const parsed = {
      reportType: payload.reportType,
      fileHash: payload.fileHash,
      sheets: [],
      headerRow: 0,
      detectedColumns: [],
      rows: payload.rows,
      invalidRows: payload.rows.filter((row) => row.issues.length)
    };
    const preview = buildSmartBillPreview({ parsed, fileName: payload.fileName, companyContext, context, includeToken: false });
    const importableRows = preview.rows.filter((row) => importableAction(row.proposedAction)).length;
    if (!importableRows) {
      return NextResponse.json(
        { error: "Preview-ul SmartBill nu contine randuri sigure pentru import. Corecteaza randurile neclare si genereaza un preview nou." },
        { status: 409, headers: noStoreHeaders }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingActiveUpload = await tx.financialReportUpload.findFirst({
        where: { activeVersion: true, status: "confirmed" },
        select: { id: true }
      });
      const upload = await tx.financialReportUpload.create({
        data: {
            uploadedByUserId: session.id,
            reportDate: inferReportDate(payload.rows),
            originalFileName: payload.fileName,
            fileHash: `smartbill-${companyContext.companyCode}-${payload.fileHash}`,
            status: "confirmed",
          activeVersion: !existingActiveUpload,
          errorSummary: preview.summary.needsReviewCount || preview.summary.adjustmentNeedsReviewCount || preview.summary.invalidCount
            ? `${preview.summary.needsReviewCount + preview.summary.adjustmentNeedsReviewCount + preview.summary.invalidCount} randuri SmartBill au ramas pentru verificare.`
            : null
        }
      });

      const summary: SmartBillConfirmSummary = {
        uploadId: upload.id,
        reportType: payload.reportType,
        companyName: companyContext.companyName,
        companyCode: companyContext.companyCode,
        scanned: payload.rows.length,
        createdClients: 0,
        createdSuppliers: 0,
        createdReceivables: 0,
        updatedReceivables: 0,
        createdPayables: 0,
        updatedPayables: 0,
        skippedDuplicates: 0,
        skippedNeedsReview: 0,
        skippedInvalid: 0,
        skippedIgnored: 0,
        skippedUnsafe: 0,
        createdClientIds: [],
        createdSupplierIds: [],
        createdReceivableIds: [],
        updatedReceivableIds: [],
        createdPayableIds: [],
        updatedPayableIds: []
      };

      const clients: Map<string, SmartBillMatchEntity> = new Map((context.clients || []).map((client) => [client.id, client]));
      const suppliers: Map<string, SmartBillMatchEntity> = new Map((context.suppliers || []).map((supplier) => [supplier.id, supplier]));
      const clientByIdentity = new Map<string, SmartBillMatchEntity>();
      const supplierByIdentity = new Map<string, SmartBillMatchEntity>();
      [...clients.values()].forEach((client) => setIdentityCache(clientByIdentity, client));
      [...suppliers.values()].forEach((supplier) => setIdentityCache(supplierByIdentity, supplier));
      const seenDedupeKeys = new Set<string>();

      const orderedRows = [...payload.rows].sort((left, right) => {
        const leftPreview = preview.rows.find((item) => item.dedupeKey === left.dedupeKey && item.rowNumber === left.rowNumber);
        const rightPreview = preview.rows.find((item) => item.dedupeKey === right.dedupeKey && item.rowNumber === right.rowNumber);
        return Number(leftPreview?.proposedAction === "AUTO_LINK_ADJUSTMENT") - Number(rightPreview?.proposedAction === "AUTO_LINK_ADJUSTMENT");
      });

      for (const row of orderedRows) {
        const previewRow = preview.rows.find((item) => item.dedupeKey === row.dedupeKey && item.rowNumber === row.rowNumber);
        if (!previewRow || !importableAction(previewRow.proposedAction)) {
          countSkipped(summary, previewRow?.proposedAction || "INVALID");
          continue;
        }
        if (seenDedupeKeys.has(row.dedupeKey)) {
          summary.skippedDuplicates += 1;
          continue;
        }
        seenDedupeKeys.add(row.dedupeKey);

        if (row.kind === "customer_invoice") {
          const latestReceivables = (context.receivables || []) as SmartBillExistingFinancialRow[];
          const duplicate = findSmartBillDuplicate(row, latestReceivables, companyContext);
          if (duplicate && !isSmartBillSourceDuplicate(duplicate, row.dedupeKey)) {
            summary.skippedDuplicates += 1;
            continue;
          }
          if (previewRow.proposedAction === "AUTO_LINK_ADJUSTMENT") {
            if (duplicate) {
              summary.skippedDuplicates += 1;
              continue;
            }
            const applied = await applySmartBillCustomerAdjustment(tx, row, upload.id, companyContext, session.id);
            if (!applied) {
              summary.skippedUnsafe += 1;
              continue;
            }
            latestReceivables.unshift(applied.adjustmentRow);
            summary.createdReceivables += 1;
            summary.updatedReceivables += 1;
            summary.createdReceivableIds.push(applied.adjustmentId);
            summary.updatedReceivableIds.push(applied.linkedReceivableId);
            continue;
          }
          const client = await ensureClientForSmartBillRow(tx, row, clients, clientByIdentity, session.id);
          if (!client) {
            summary.skippedUnsafe += 1;
            continue;
          }
          if (!clients.has(client.id)) {
            clients.set(client.id, client);
            summary.createdClients += 1;
            summary.createdClientIds.push(client.id);
          }
          const data = smartBillCustomerReceivableData({
            row,
            uploadId: upload.id,
            companyContext,
            clientId: client.id,
            accountOwnerUserId: client.accountOwnerUserId,
            reviewedByUserId: session.id
          });
          if (duplicate && isSmartBillSourceDuplicate(duplicate, row.dedupeKey)) {
            const updated = await tx.financialReceivable.update({
              where: { id: duplicate.id },
              data: smartBillReceivableUpdateData(data)
            });
            summary.updatedReceivables += 1;
            summary.updatedReceivableIds.push(updated.id);
          } else {
            const created = await tx.financialReceivable.create({
              data: { ...data, rawRowJson: data.rawRowJson as Prisma.InputJsonValue }
            });
            latestReceivables.unshift({
              id: created.id,
              normalizedInvoiceNumber: created.normalizedInvoiceNumber,
              invoiceNumber: created.invoiceNumber,
              invoiceDate: created.invoiceDate,
              clientId: created.clientId,
              clientName: created.clientName,
              currency: created.currency,
              amount: created.invoicedAmount,
              rawRowJson: created.rawRowJson,
              includedInReport: created.includedInReport,
              status: created.status
            });
            summary.createdReceivables += 1;
            summary.createdReceivableIds.push(created.id);
          }
        } else {
          const latestPayables = (context.payables || []) as SmartBillExistingFinancialRow[];
          const duplicate = findSmartBillDuplicate(row, latestPayables, companyContext);
          if (duplicate && !isSmartBillSourceDuplicate(duplicate, row.dedupeKey)) {
            summary.skippedDuplicates += 1;
            continue;
          }
          const supplier = await ensureSupplierForSmartBillRow(tx, row, suppliers, supplierByIdentity, session.id);
          if (!supplier) {
            summary.skippedUnsafe += 1;
            continue;
          }
          if (!suppliers.has(supplier.id)) {
            suppliers.set(supplier.id, supplier);
            summary.createdSuppliers += 1;
            summary.createdSupplierIds.push(supplier.id);
          }
          const data = smartBillSupplierPayableData({
            row,
            uploadId: upload.id,
            companyContext,
            supplierId: supplier.id,
            reviewedByUserId: session.id
          });
          if (duplicate && isSmartBillSourceDuplicate(duplicate, row.dedupeKey)) {
            const updated = await tx.financialPayable.update({
              where: { id: duplicate.id },
              data: smartBillPayableUpdateData(data)
            });
            summary.updatedPayables += 1;
            summary.updatedPayableIds.push(updated.id);
          } else {
            const created = await tx.financialPayable.create({
              data: { ...data, rawRowJson: data.rawRowJson as Prisma.InputJsonValue }
            });
            latestPayables.unshift({
              id: created.id,
              normalizedInvoiceNumber: created.normalizedInvoiceNumber,
              invoiceNumber: created.invoiceNumber,
              invoiceDate: created.invoiceDate,
              supplierId: created.supplierId,
              supplierName: created.supplierName,
              currency: created.currency,
              amount: created.amountToPay,
              rawRowJson: created.rawRowJson,
              includedInReport: created.includedInReport,
              status: created.status
            });
            summary.createdPayables += 1;
            summary.createdPayableIds.push(created.id);
          }
        }
      }

      const changedRows = summary.createdReceivables + summary.updatedReceivables + summary.createdPayables + summary.updatedPayables;
      if (!changedRows) {
        throw new Error("Importul SmartBill nu a schimbat niciun rand financiar; raportul activ a ramas neschimbat.");
      }

      return summary;
    });

    await recalculateFinancialSnapshots(result.uploadId);
    await recordAudit({
      actor: session,
      action: "financial.smartbill_import_confirmed",
      entityType: "financial_report_upload",
      entityId: result.uploadId,
      metadata: result,
      request
    });

    return NextResponse.json({ ok: true, summary: result }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Importul SmartBill nu a putut fi confirmat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

async function loadSmartBillConfirmContext(reportType: SmartBillReportType, companyContext: SmartBillCompanyContext) {
  const companyWhere = {
    OR: [
      { companyCode: companyContext.companyCode },
      { companyName: companyContext.companyName }
    ]
  };
  if (reportType === "customer_invoices") {
    const [clients, receivables] = await Promise.all([
      prisma.clientAccount.findMany({
        where: { status: { notIn: ["merged", "archived"] } },
        select: { id: true, companyName: true, normalizedName: true, taxId: true, accountOwnerUserId: true }
      }),
      prisma.financialReceivable.findMany({
        where: { ...companyWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
        select: {
          id: true,
          companyName: true,
          companyCode: true,
          normalizedInvoiceNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          clientId: true,
          clientName: true,
          dueDate: true,
          currency: true,
          invoicedAmount: true,
          collectedAmount: true,
          remainingAmount: true,
          rawRowJson: true,
          includedInReport: true,
          status: true,
          client: { select: { taxId: true, normalizedName: true } }
        },
        take: 10000,
        orderBy: { createdAt: "desc" }
      })
    ]);
    return {
      clients: clients.map((client) => ({
        id: client.id,
        name: client.companyName,
        normalizedName: client.normalizedName,
        taxId: client.taxId,
        accountOwnerUserId: client.accountOwnerUserId
      })) satisfies SmartBillMatchEntity[],
      receivables: receivables.map((row) => ({
        ...row,
        amount: row.invoicedAmount,
        paidOrCollectedAmount: row.collectedAmount,
        entityTaxId: row.client?.taxId || null,
        entityNormalizedName: row.client?.normalizedName || null
      })) satisfies SmartBillExistingFinancialRow[]
    };
  }

  const [suppliers, payables] = await Promise.all([
    prisma.supplier.findMany({
      where: { status: { notIn: ["archived"] } },
      select: { id: true, supplierName: true, normalizedName: true, taxId: true }
    }),
    prisma.financialPayable.findMany({
      where: { ...companyWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      select: {
        id: true,
        companyName: true,
        companyCode: true,
        normalizedInvoiceNumber: true,
        invoiceNumber: true,
        invoiceDate: true,
        supplierId: true,
          supplierName: true,
          dueDate: true,
          currency: true,
          amountToPay: true,
          amountPaid: true,
          remainingAmount: true,
          rawRowJson: true,
          includedInReport: true,
          status: true,
          supplier: { select: { taxId: true, normalizedName: true } }
        },
      take: 10000,
      orderBy: { createdAt: "desc" }
    })
  ]);
  return {
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.supplierName,
      normalizedName: supplier.normalizedName,
      taxId: supplier.taxId
    })) satisfies SmartBillMatchEntity[],
    payables: payables.map((row) => ({
      ...row,
      amount: row.amountToPay,
      paidOrCollectedAmount: row.amountPaid,
      entityTaxId: row.supplier?.taxId || null,
      entityNormalizedName: row.supplier?.normalizedName || null
    })) satisfies SmartBillExistingFinancialRow[]
  };
}

async function ensureClientForSmartBillRow(
  tx: Prisma.TransactionClient,
  row: SmartBillCustomerInvoiceRow,
  clients: Map<string, SmartBillMatchEntity>,
  identityCache: Map<string, SmartBillMatchEntity>,
  actorId: string
) {
  const match = matchSmartBillEntity(row, [...clients.values()]);
  if (match.kind === "matched") return match.entity;
  if (match.kind === "ambiguous") return null;
  const identity = identityKey(row.normalizedFiscalCode, row.clientName);
  const cached = identityCache.get(identity);
  if (cached) return cached;
  const created = await tx.clientAccount.create({
    data: {
      companyName: row.clientName,
      normalizedName: normalizeClientName(row.clientName),
      taxId: row.normalizedFiscalCode || null,
      billingAddress: row.address || null,
      status: "active",
      createdByUserId: actorId
    },
    select: { id: true, companyName: true, normalizedName: true, taxId: true, accountOwnerUserId: true }
  });
  const entity = {
    id: created.id,
    name: created.companyName,
    normalizedName: created.normalizedName,
    taxId: created.taxId,
    accountOwnerUserId: created.accountOwnerUserId
  } satisfies SmartBillMatchEntity;
  setIdentityCache(identityCache, entity);
  return entity;
}

async function applySmartBillCustomerAdjustment(
  tx: Prisma.TransactionClient,
  row: SmartBillCustomerInvoiceRow,
  uploadId: string,
  companyContext: SmartBillCompanyContext,
  actorId: string
) {
  const companyWhere = {
    OR: [
      { companyCode: companyContext.companyCode },
      { companyName: companyContext.companyName }
    ]
  };
  const receivables = await tx.financialReceivable.findMany({
    where: { ...companyWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
    select: {
      id: true,
      companyName: true,
      companyCode: true,
      normalizedInvoiceNumber: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      clientId: true,
      clientName: true,
      currency: true,
      invoicedAmount: true,
      collectedAmount: true,
      remainingAmount: true,
      rawRowJson: true,
      includedInReport: true,
      status: true,
      client: { select: { taxId: true, normalizedName: true } }
    },
    take: 10000,
    orderBy: { createdAt: "desc" }
  });
  const existingRows = receivables.map((receivable) => ({
    ...receivable,
    amount: receivable.invoicedAmount,
    paidOrCollectedAmount: receivable.collectedAmount,
    entityTaxId: receivable.client?.taxId || null,
    entityNormalizedName: receivable.client?.normalizedName || null
  })) satisfies SmartBillExistingFinancialRow[];
  const match = findSmartBillAdjustmentMatch(row, existingRows, companyContext);
  if (!match || match.kind !== "auto" || !match.linkedRow) return null;
  const linked = receivables.find((receivable) => receivable.id === match.linkedRow?.id);
  const linkedRow = existingRows.find((receivable) => receivable.id === match.linkedRow?.id);
  if (!linked || !linkedRow) return null;
  let application: ReturnType<typeof calculateSmartBillReceivableAdjustment>;
  try {
    application = calculateSmartBillReceivableAdjustment({ row, receivable: linkedRow });
  } catch {
    return null;
  }
  const adjustmentData = smartBillCustomerAdjustmentReceivableData({
    row,
    uploadId,
    companyContext,
    linkedReceivable: linkedRow,
    reviewedByUserId: actorId
  });
  const adjustment = await tx.financialReceivable.create({
    data: { ...adjustmentData, rawRowJson: adjustmentData.rawRowJson as Prisma.InputJsonValue }
  });
  const updatedRaw = appendSmartBillAdjustmentMetadata(linked.rawRowJson, row, adjustment.id, application.adjustmentAmount, application.remainingAmount);
  const updated = await tx.financialReceivable.update({
    where: { id: linked.id },
    data: {
      remainingAmount: application.remainingAmount,
      status: application.status,
      rawRowJson: updatedRaw as Prisma.InputJsonValue,
      reviewedByUserId: actorId,
      reviewedAt: new Date()
    }
  });
  return {
    adjustmentId: adjustment.id,
    linkedReceivableId: updated.id,
    adjustmentRow: {
      id: adjustment.id,
      companyName: adjustment.companyName,
      companyCode: adjustment.companyCode,
      normalizedInvoiceNumber: adjustment.normalizedInvoiceNumber,
      invoiceNumber: adjustment.invoiceNumber,
      invoiceDate: adjustment.invoiceDate,
      dueDate: adjustment.dueDate,
      clientId: adjustment.clientId,
      clientName: adjustment.clientName,
      currency: adjustment.currency,
      amount: adjustment.invoicedAmount,
      remainingAmount: adjustment.remainingAmount,
      paidOrCollectedAmount: adjustment.collectedAmount,
      rawRowJson: adjustment.rawRowJson,
      includedInReport: adjustment.includedInReport,
      status: adjustment.status
    } satisfies SmartBillExistingFinancialRow
  };
}

async function ensureSupplierForSmartBillRow(
  tx: Prisma.TransactionClient,
  row: SmartBillSupplierDocumentRow,
  suppliers: Map<string, SmartBillMatchEntity>,
  identityCache: Map<string, SmartBillMatchEntity>,
  actorId: string
) {
  const match = matchSmartBillEntity(row, [...suppliers.values()]);
  if (match.kind === "matched") return match.entity;
  if (match.kind === "ambiguous") return null;
  const identity = identityKey(row.normalizedFiscalCode, row.supplierName);
  const cached = identityCache.get(identity);
  if (cached) return cached;
  const created = await tx.supplier.create({
    data: {
      supplierName: row.supplierName,
      normalizedName: normalizeCompanyName(row.supplierName),
      taxId: row.normalizedFiscalCode || null,
      status: "active",
      createdByUserId: actorId
    },
    select: { id: true, supplierName: true, normalizedName: true, taxId: true }
  });
  const entity = {
    id: created.id,
    name: created.supplierName,
    normalizedName: created.normalizedName,
    taxId: created.taxId
  } satisfies SmartBillMatchEntity;
  setIdentityCache(identityCache, entity);
  return entity;
}

function setIdentityCache(cache: Map<string, SmartBillMatchEntity>, entity: SmartBillMatchEntity) {
  if (entity.taxId) cache.set(identityKey(normalizeFiscalCode(entity.taxId), entity.name), entity);
  cache.set(identityKey(null, entity.name), entity);
}

function identityKey(fiscalCode: string | null | undefined, name: string) {
  return fiscalCode ? `tax:${fiscalCode}` : `name:${normalizeCompanyName(name)}`;
}

function countSkipped(summary: SmartBillConfirmSummary, action: string) {
  if (action === "DUPLICATE") summary.skippedDuplicates += 1;
  else if (action === "NEEDS_REVIEW" || action === "ADJUSTMENT_NEEDS_REVIEW") summary.skippedNeedsReview += 1;
  else if (action === "IGNORED") summary.skippedIgnored += 1;
  else summary.skippedInvalid += 1;
}

function appendSmartBillAdjustmentMetadata(
  raw: unknown,
  row: SmartBillCustomerInvoiceRow,
  adjustmentReceivableId: string,
  adjustmentAmount: number,
  remainingAmount: number
) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const previous = Array.isArray(base.smartBillAdjustments) ? base.smartBillAdjustments : [];
  return {
    ...base,
    smartBillAdjustments: [
      ...previous,
      {
        smartBillDedupeKey: row.dedupeKey,
        adjustmentReceivableId,
        adjustmentInvoiceNumber: row.invoiceNumber,
        adjustmentAmount,
        remainingAmountAfterAdjustment: remainingAmount,
        appliedAt: new Date().toISOString()
      }
    ]
  };
}

function smartBillReceivableUpdateData(data: ReturnType<typeof smartBillCustomerReceivableData>) {
  return {
    companyName: data.companyName,
    companyCode: data.companyCode,
    dueDate: data.dueDate,
    invoicedAmount: data.invoicedAmount,
    collectedAmount: data.collectedAmount,
    remainingAmount: data.remainingAmount,
    collectedAt: data.collectedAt,
    currency: data.currency,
    status: data.status,
    rawRowJson: data.rawRowJson as Prisma.InputJsonValue,
    needsReview: data.needsReview,
    includedInReport: data.includedInReport,
    rowType: data.rowType,
    reviewNote: data.reviewNote,
    reviewedByUserId: data.reviewedByUserId,
    reviewedAt: data.reviewedAt
  };
}

function smartBillPayableUpdateData(data: ReturnType<typeof smartBillSupplierPayableData>) {
  return {
    companyName: data.companyName,
    companyCode: data.companyCode,
    dueDate: data.dueDate,
    amountToPay: data.amountToPay,
    amountPaid: data.amountPaid,
    remainingAmount: data.remainingAmount,
    paidAt: data.paidAt,
    currency: data.currency,
    status: data.status,
    rawRowJson: data.rawRowJson as Prisma.InputJsonValue,
    needsReview: data.needsReview,
    includedInReport: data.includedInReport,
    rowType: data.rowType,
    reviewNote: data.reviewNote,
    reviewedByUserId: data.reviewedByUserId,
    reviewedAt: data.reviewedAt
  };
}

function inferReportDate(rows: SmartBillParsedRow[]) {
  const dates = rows.map((row) => row.issueDate).filter(Boolean) as Date[];
  if (!dates.length) return new Date();
  return dates.sort((left, right) => right.getTime() - left.getTime())[0];
}

function validateSmartBillPayloadRows(reportType: SmartBillReportType, rows: SmartBillParsedRow[]) {
  const expectedKind = reportType === "customer_invoices" ? "customer_invoice" : "supplier_document";
  if (!rows.length) {
    throw new Error("Preview-ul SmartBill nu contine randuri.");
  }
  if (rows.some((row) => row.kind !== expectedKind)) {
    throw new Error("Preview-ul SmartBill contine randuri din alt tip de raport.");
  }
}
