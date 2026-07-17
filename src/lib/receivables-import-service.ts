import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import { prisma } from "@/lib/prisma";
import {
  matchClientCandidates,
  money,
  receivableCanonicalKey,
  receivableStatus,
  reconcileReceivableAmounts
} from "@/lib/receivables-domain";
import {
  parseReceivablesWorkbook,
  type ReceivablesCompanyCode,
  type ReceivablesImportRow
} from "@/lib/receivables-import-parser";

const ACTIVE_PAYMENT_STATUS = "active";

export async function stageReceivablesImport(input: {
  buffer: Buffer;
  fileName: string;
  selectedCompanyCode?: ReceivablesCompanyCode | null;
  reportDate?: Date | null;
  actor: AuthSession;
}) {
  const parsed = parseReceivablesWorkbook({
    buffer: input.buffer,
    fileName: input.fileName,
    selectedCompanyCode: input.selectedCompanyCode
  });
  if (!parsed.rows.length) throw new Error("Raportul nu conține rânduri valide în secțiunea «LISTA ÎNCASĂRI».");

  const duplicate = await prisma.financialReportUpload.findFirst({
    where: {
      fileHash: parsed.fileHash,
      status: { notIn: ["rejected", "failed"] },
      receivableImportRows: { some: {} }
    },
    orderBy: { uploadedAt: "desc" },
    select: { id: true, status: true, originalFileName: true, uploadedAt: true }
  });
  if (duplicate) return { duplicate: true as const, upload: duplicate, preview: await getReceivablesImportPreview(duplicate.id) };

  const [clients, aliases, existingReceivables] = await Promise.all([
    prisma.clientAccount.findMany({
      where: { status: { notIn: ["merged", "archived"] } },
      select: { id: true, companyName: true, normalizedName: true, aliases: true, accountOwnerUserId: true },
      orderBy: { companyName: "asc" }
    }),
    prisma.financialClientAlias.findMany({
      select: { companyCode: true, normalizedAlias: true, clientId: true }
    }),
    prisma.financialReceivable.findMany({
      where: {
        companyCode: { in: Array.from(new Set(parsed.rows.map((row) => row.companyCode))) },
        normalizedInvoiceNumber: { in: Array.from(new Set(parsed.rows.map((row) => row.normalizedInvoiceNumber).filter(Boolean))) }
      },
      select: {
        id: true,
        clientId: true,
        companyCode: true,
        normalizedInvoiceNumber: true,
        currency: true,
        invoicedAmount: true,
        collectedAmount: true,
        remainingAmount: true,
        lastReportDate: true,
        rawRowJson: true,
        canonicalKey: true,
        includedInReport: true,
        updatedAt: true,
        _count: { select: { payments: true } }
      }
    })
  ]);

  const duplicateInvoiceKeys = duplicateKeys(parsed.rows);
  const staged = parsed.rows.map((row) => classifyImportRow({ row, clients, aliases, existingReceivables, duplicateInvoiceKeys }));
  const reportDate = input.reportDate || parsed.reportDate;
  const status = staged.some((row) => row.status === "conflict" || row.status === "manual")
    ? "needs_review"
    : staged.some((row) => row.status === "needs_confirmation")
      ? "needs_confirmation"
      : "preview_ready";

  const upload = await prisma.$transaction(async (tx) => {
    const created = await tx.financialReportUpload.create({
      data: {
        uploadedByUserId: input.actor.id,
        reportDate,
        originalFileName: input.fileName,
        fileHash: parsed.fileHash,
        status,
        errorSummary: parsed.issues.some((issue) => issue.severity === "critical")
          ? `${parsed.issues.filter((issue) => issue.severity === "critical").length} neconcordanțe critice.`
          : null
      }
    });
    await tx.financialReceivableImportRow.createMany({
      data: staged.map(({ row, ...classification }) => ({
        uploadId: created.id,
        companyName: row.companyName,
        companyCode: row.companyCode,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        sourceRowKey: row.sourceRowKey,
        sourceHash: row.sourceHash,
        rawInvoiceNumber: row.rawInvoiceNumber || null,
        normalizedInvoiceNumber: row.normalizedInvoiceNumber || null,
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        currency: row.currency,
        invoiceAmount: decimalOrNull(row.invoiceAmount),
        reportCollectedAmount: decimalOrNull(row.reportCollectedAmount),
        reportRemainingAmount: decimalOrNull(row.reportRemainingAmount),
        locationText: row.locationText,
        campaignDetails: row.campaignDetails,
        clientNameRaw: row.clientNameRaw || null,
        normalizedClientName: row.normalizedClientName || null,
        rawRowJson: { ...row.rawRowJson, warnings: row.warnings } as Prisma.InputJsonValue,
        ...classification
      }))
    });
    if (parsed.issues.length) {
      await tx.financialImportIssue.createMany({
        data: parsed.issues.map((issue) => ({
          uploadId: created.id,
          companyCode: issue.companyCode,
          companyName: issue.companyCode ? companyName(issue.companyCode) : null,
          sheetName: issue.sheetName,
          rowNumber: issue.rowNumber,
          issueType: issue.type,
          issueMessage: issue.message,
          severity: issue.severity
        }))
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivables.import_staged",
        entityType: "financial_report_upload",
        entityId: created.id,
        metadata: { fileName: input.fileName, fileHash: parsed.fileHash, rowCount: parsed.rows.length, status }
      }
    });
    return created;
  });

  return { duplicate: false as const, upload, preview: await getReceivablesImportPreview(upload.id) };
}

export async function getReceivablesImportPreview(uploadId: string) {
  const upload = await prisma.financialReportUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      status: true,
      reportDate: true,
      originalFileName: true,
      uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
      receivableImportRows: {
        include: {
          client: { select: { id: true, companyName: true } },
          receivable: { select: { id: true, invoiceNumber: true, collectedAmount: true, remainingAmount: true } },
          campaign: { select: { id: true, campaignName: true } },
          location: { select: { id: true, code: true, address: true } }
        },
        orderBy: [{ companyCode: "asc" }, { rowNumber: "asc" }]
      },
      issues: { orderBy: [{ severity: "desc" }, { rowNumber: "asc" }] }
    }
  });
  if (!upload) return null;
  const rows = upload.receivableImportRows.map(serializeImportRow);
  return {
    upload: {
      id: upload.id,
      status: upload.status,
      reportDate: upload.reportDate?.toISOString() || null,
      originalFileName: upload.originalFileName,
      uploadedAt: upload.uploadedAt.toISOString(),
      uploadedBy: upload.uploadedBy
    },
    groups: groupRows(rows),
    totals: importTotals(rows),
    issues: upload.issues.map((issue) => ({
      id: issue.id,
      companyCode: issue.companyCode,
      rowNumber: issue.rowNumber,
      severity: issue.severity,
      type: issue.issueType,
      message: issue.issueMessage
    }))
  };
}

export async function resolveReceivablesImportRow(input: {
  uploadId: string;
  rowId: string;
  actor: AuthSession;
  action: "confirm" | "create" | "ignore" | "confirm_credit";
  clientId?: string | null;
  receivableId?: string | null;
  campaignId?: string | null;
  locationId?: string | null;
  companyCode?: ReceivablesCompanyCode | null;
  currency?: "RON" | "EUR" | null;
  reason?: string | null;
  saveAlias?: boolean;
}) {
  const row = await prisma.financialReceivableImportRow.findFirst({ where: { id: input.rowId, uploadId: input.uploadId } });
  if (!row) throw new Error("Rândul de import nu există.");
  if (["imported", "unchanged"].includes(row.status)) throw new Error("Rândul a fost deja reconciliat.");
  if (input.action === "ignore" && !input.reason?.trim()) throw new Error("Motivul ignorării este obligatoriu.");
  const clientId = input.clientId || row.clientId;
  if (input.action !== "ignore" && !clientId) throw new Error("Selectează clientul înainte de confirmare.");
  const currency = input.currency || row.currency;
  const currencyChanged = Boolean(input.currency && input.currency !== row.currency);
  if (currencyChanged && !input.reason?.trim()) throw new Error("Motivul corectării monedei este obligatoriu.");
  if (input.action !== "ignore" && (!row.normalizedInvoiceNumber || !currency || row.invoiceAmount == null)) {
    throw new Error("Numărul facturii, moneda și valoarea sunt obligatorii.");
  }
  const companyCode = input.companyCode || row.companyCode;
  const status = input.action === "ignore" ? "ignored" : "resolved";
  await prisma.$transaction(async (tx) => {
    await tx.financialReceivableImportRow.update({
      where: { id: row.id },
      data: {
        companyCode,
        currency,
        clientId: input.action === "ignore" ? row.clientId : clientId,
        receivableId: input.receivableId || row.receivableId,
        campaignId: input.campaignId ?? row.campaignId,
        locationId: input.locationId ?? row.locationId,
        status,
        confidenceLevel: input.action === "ignore" ? "ignored" : "confirmed",
        confidenceScore: input.action === "ignore" ? 0 : 100,
        resolutionAction: input.action,
        resolutionReason: input.reason?.trim() || null,
        resolvedByUserId: input.actor.id,
        resolvedAt: new Date()
      }
    });
    if (input.saveAlias && clientId && row.clientNameRaw && row.normalizedClientName) {
      await tx.financialClientAlias.upsert({
        where: { companyCode_normalizedAlias: { companyCode, normalizedAlias: row.normalizedClientName } },
        create: {
          companyCode,
          aliasName: row.clientNameRaw,
          normalizedAlias: row.normalizedClientName,
          clientId,
          createdByUserId: input.actor.id
        },
        update: { aliasName: row.clientNameRaw, clientId }
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivables.import_row_resolved",
        entityType: "financial_receivable_import_row",
        entityId: row.id,
        metadata: { action: input.action, clientId, reason: input.reason || null, saveAlias: Boolean(input.saveAlias), previousCurrency: row.currency, currency }
      }
    });
  });
  return getReceivablesImportPreview(input.uploadId);
}

export async function confirmReceivablesImport(input: { uploadId: string; actor: AuthSession }) {
  return prisma.$transaction(async (tx) => {
    const upload = await tx.financialReportUpload.findUnique({
      where: { id: input.uploadId },
      include: { receivableImportRows: { orderBy: { rowNumber: "asc" } } }
    });
    if (!upload) throw new Error("Importul nu există.");
    if (upload.status === "confirmed") return { alreadyConfirmed: true, created: 0, updated: 0, unchanged: 0, ignored: 0 };
    const blocked = upload.receivableImportRows.filter((row) => !["allocated_auto", "resolved", "ignored"].includes(row.status));
    if (blocked.length) throw new Error(`${blocked.length} rânduri necesită rezolvare înainte de import.`);

    const billingItems = await tx.billingItem.findMany({
      where: {
        normalizedInvoiceNumber: { in: Array.from(new Set(upload.receivableImportRows.map((row) => row.normalizedInvoiceNumber).filter((value): value is string => Boolean(value)))) },
        clientId: { in: Array.from(new Set(upload.receivableImportRows.map((row) => row.clientId).filter((value): value is string => Boolean(value)))) },
        currency: { in: Array.from(new Set(upload.receivableImportRows.map((row) => row.currency).filter((value): value is string => Boolean(value)))) }
      },
      select: {
        id: true,
        normalizedInvoiceNumber: true,
        currency: true,
        clientId: true,
        companyEntity: true,
        reservation: { select: { campaignId: true, locationId: true } }
      }
    });

    const result = { alreadyConfirmed: false, created: 0, updated: 0, unchanged: 0, ignored: 0 };
    for (const row of upload.receivableImportRows) {
      if (row.status === "ignored") {
        result.ignored += 1;
        continue;
      }
      if (!row.clientId || !row.normalizedInvoiceNumber || !row.currency || row.invoiceAmount == null) {
        throw new Error(`Rândul ${row.rowNumber} nu are alocarea financiară completă.`);
      }
      const canonicalKey = receivableCanonicalKey({
        companyCode: row.companyCode,
        normalizedInvoiceNumber: row.normalizedInvoiceNumber,
        currency: row.currency,
        clientId: row.clientId
      });
      const billingCandidates = billingItems.filter((item) =>
        item.normalizedInvoiceNumber === row.normalizedInvoiceNumber &&
        item.currency === row.currency &&
        item.clientId === row.clientId &&
        item.companyEntity === row.companyName
      );
      if (billingCandidates.length > 1) {
        throw new Error(`Factura ${row.rawInvoiceNumber || row.normalizedInvoiceNumber} corespunde mai multor poziții de facturare.`);
      }
      const billingItem = billingCandidates[0] || null;
      const linkedCampaignId = row.campaignId || billingItem?.reservation?.campaignId || null;
      const linkedLocationId = row.locationId || billingItem?.reservation?.locationId || null;
      let receivable = row.receivableId
        ? await tx.financialReceivable.findUnique({
            where: { id: row.receivableId },
            include: { payments: { where: { status: ACTIVE_PAYMENT_STATUS } } }
          })
        : await tx.financialReceivable.findFirst({
            where: {
              OR: [
                { canonicalKey },
                {
                  companyCode: row.companyCode,
                  normalizedInvoiceNumber: row.normalizedInvoiceNumber,
                  currency: row.currency,
                  clientId: row.clientId
                }
              ]
            },
            include: { payments: { where: { status: ACTIVE_PAYMENT_STATUS } } }
          });
      if (receivable?.clientId && receivable.clientId !== row.clientId) {
        throw new Error(`Factura ${row.rawInvoiceNumber || row.normalizedInvoiceNumber} este legată de alt client.`);
      }
      const previousSnapshot = receivable ? {
        clientId: receivable.clientId,
        campaignId: receivable.campaignId,
        invoiceNumber: receivable.invoiceNumber,
        dueDate: receivable.dueDate?.toISOString() || null,
        invoicedAmount: decimalString(receivable.invoicedAmount),
        collectedAmount: decimalString(receivable.collectedAmount),
        remainingAmount: decimalString(receivable.remainingAmount),
        currency: receivable.currency,
        status: receivable.status
      } : null;
      const isOlderReport = Boolean(receivable?.lastReportDate && upload.reportDate && upload.reportDate < receivable.lastReportDate);
      if (isOlderReport && row.sourceHash !== sourceHashFromRaw(receivable?.rawRowJson)) {
        throw new Error(`Raportul este mai vechi decât ultima reconciliere pentru factura ${row.rawInvoiceNumber || row.normalizedInvoiceNumber}.`);
      }

      const wasCreated = !receivable;
      if (!receivable) {
        receivable = await tx.financialReceivable.create({
          data: {
            uploadId: upload.id,
            clientId: row.clientId,
            campaignId: linkedCampaignId,
            billingItemId: billingItem?.id || null,
            companyName: row.companyName,
            companyCode: row.companyCode,
            invoiceNumber: row.rawInvoiceNumber,
            normalizedInvoiceNumber: row.normalizedInvoiceNumber,
            canonicalKey,
            invoiceDate: row.invoiceDate,
            location: row.locationText,
            campaignDetails: row.campaignDetails,
            clientName: row.clientNameRaw,
            dueDate: row.dueDate,
            invoicedAmount: row.invoiceAmount,
            collectedAmount: money(0),
            remainingAmount: row.invoiceAmount,
            currency: row.currency,
            status: receivableStatus({ invoiceAmount: row.invoiceAmount, collectedAmount: 0, dueDate: row.dueDate }),
            needsReview: false,
            includedInReport: true,
            rawRowJson: { sourceHash: row.sourceHash, sourceRowKey: row.sourceRowKey },
            lastReportDate: upload.reportDate,
            lastImportedAt: new Date()
          },
          include: { payments: { where: { status: ACTIVE_PAYMENT_STATUS } } }
        });
        result.created += 1;
      } else {
        if (!receivable.canonicalKey) {
          receivable = await tx.financialReceivable.update({
            where: { id: receivable.id },
            data: { canonicalKey },
            include: { payments: { where: { status: ACTIVE_PAYMENT_STATUS } } }
          });
        }
      }

      if (!receivable.payments.length && money(receivable.collectedAmount).greaterThan(0)) {
        await tx.financialReceivablePayment.create({
          data: {
            receivableId: receivable.id,
            amount: receivable.collectedAmount || money(0),
            currency: row.currency,
            receivedAt: receivable.collectedAt || receivable.createdAt,
            paymentMethod: receivable.paymentMethod,
            notes: "Sold inițial preluat din istoricul existent.",
            source: "legacy_opening_balance",
            createdByUserId: input.actor.id
          }
        });
      }
      const ledger = await activePaymentTotal(tx, receivable.id);
      const reconciliation = reconcileReceivableAmounts({
        invoiceAmount: row.invoiceAmount,
        ledgerCollectedAmount: ledger,
        reportCollectedAmount: row.reportCollectedAmount,
        allowOverpayment: row.resolutionAction === "confirm_credit"
      });
      if (reconciliation.state === "conflict" || reconciliation.state === "overpayment_confirmation") {
        throw new Error(`${row.rawInvoiceNumber || row.normalizedInvoiceNumber}: ${reconciliation.message}`);
      }
      let importPaymentId: string | null = null;
      if (reconciliation.importDelta.greaterThan(0)) {
        const payment = await tx.financialReceivablePayment.upsert({
          where: { sourceImportRowId: row.id },
          create: {
            receivableId: receivable.id,
            sourceImportRowId: row.id,
            amount: reconciliation.importDelta,
            currency: row.currency,
            receivedAt: upload.reportDate || new Date(),
            notes: `Diferență reconciliată din ${upload.originalFileName}.`,
            source: "report_import",
            createdByUserId: input.actor.id
          },
          update: {},
          select: { id: true }
        });
        importPaymentId = payment.id;
      }
      const collected = await activePaymentTotal(tx, receivable.id);
      const remaining = Prisma.Decimal.max(money(row.invoiceAmount).minus(collected), 0);
      const credit = Prisma.Decimal.max(collected.minus(money(row.invoiceAmount)), 0);
      if (credit.greaterThan(0) && importPaymentId) {
        await tx.financialClientCredit.upsert({
          where: { sourcePaymentId: importPaymentId },
          create: {
            clientId: row.clientId,
            receivableId: receivable.id,
            sourcePaymentId: importPaymentId,
            companyName: row.companyName,
            companyCode: row.companyCode,
            currency: row.currency,
            amount: credit,
            remainingAmount: credit,
            reason: `Supraplată identificată în ${upload.originalFileName}.`,
            createdByUserId: input.actor.id
          },
          update: { amount: credit, remainingAmount: credit }
        });
      }
      const changed = !wasCreated && (
        reconciliation.importDelta.greaterThan(0) ||
        sourceHashFromRaw(receivable.rawRowJson) !== row.sourceHash
      );
      await tx.financialReceivable.update({
        where: { id: receivable.id },
        data: {
          clientId: row.clientId,
          campaignId: linkedCampaignId || receivable.campaignId,
          billingItemId: receivable.billingItemId || billingItem?.id || null,
          companyName: row.companyName,
          companyCode: row.companyCode,
          invoiceNumber: row.rawInvoiceNumber || receivable.invoiceNumber,
          normalizedInvoiceNumber: row.normalizedInvoiceNumber,
          invoiceDate: row.invoiceDate || receivable.invoiceDate,
          location: row.locationText || receivable.location,
          campaignDetails: row.campaignDetails || receivable.campaignDetails,
          clientName: row.clientNameRaw || receivable.clientName,
          dueDate: row.dueDate || receivable.dueDate,
          invoicedAmount: row.invoiceAmount,
          collectedAmount: collected,
          remainingAmount: remaining,
          currency: row.currency,
          status: receivableStatus({ invoiceAmount: row.invoiceAmount, collectedAmount: collected, dueDate: row.dueDate }),
          needsReview: false,
          includedInReport: true,
          rawRowJson: { sourceHash: row.sourceHash, sourceRowKey: row.sourceRowKey },
          lastReportDate: upload.reportDate || receivable.lastReportDate,
          lastImportedAt: new Date()
        }
      });
      await tx.financialReceivableImportRow.update({
        where: { id: row.id },
        data: {
          receivableId: receivable.id,
          campaignId: linkedCampaignId,
          locationId: linkedLocationId,
          status: wasCreated || changed ? "imported" : "unchanged",
          resolvedByUserId: row.resolvedByUserId || input.actor.id,
          resolvedAt: row.resolvedAt || new Date()
        }
      });
      await tx.auditLog.create({
        data: {
          userId: input.actor.id,
          action: wasCreated ? "receivable.import_created" : changed ? "receivable.import_updated" : "receivable.import_unchanged",
          entityType: "financial_receivable",
          entityId: receivable.id,
          metadata: {
            uploadId: upload.id,
            importRowId: row.id,
            sourceHash: row.sourceHash,
            previous: previousSnapshot,
            next: {
              clientId: row.clientId,
              campaignId: linkedCampaignId,
              invoiceNumber: row.rawInvoiceNumber,
              dueDate: row.dueDate?.toISOString() || null,
              invoicedAmount: money(row.invoiceAmount).toFixed(2),
              collectedAmount: collected.toFixed(2),
              remainingAmount: remaining.toFixed(2),
              currency: row.currency,
              status: receivableStatus({ invoiceAmount: row.invoiceAmount, collectedAmount: collected, dueDate: row.dueDate })
            }
          }
        }
      });
      if (changed) result.updated += 1;
      else if (!wasCreated) result.unchanged += 1;
    }
    await tx.financialReportUpload.update({
      where: { id: upload.id },
      data: { status: "confirmed", errorSummary: null }
    });
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "receivables.import_confirmed",
        entityType: "financial_report_upload",
        entityId: upload.id,
        metadata: result
      }
    });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

export async function listReceivablesWorkspace(input?: { query?: string; status?: string; take?: number }) {
  const query = input?.query?.trim() || "";
  const take = Math.min(Math.max(input?.take || 100, 1), 300);
  const [receivables, uploads, clients, aliases, payments, credits, campaigns, locations] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        includedInReport: true,
        ...(input?.status ? { status: input.status } : {}),
        ...(query ? { OR: [{ invoiceNumber: { contains: query } }, { clientName: { contains: query } }, { location: { contains: query } }] } : {})
      },
      include: {
        client: { select: { id: true, companyName: true } },
        payments: {
          orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
          take: 20,
          include: { createdBy: { select: { name: true } }, cancelledBy: { select: { name: true } } }
        },
        credits: { where: { status: "available" } }
      },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }],
      take
    }),
    prisma.financialReportUpload.findMany({
      where: { OR: [{ receivableImportRows: { some: {} } }, { receivables: { some: {} } }] },
      select: {
        id: true, originalFileName: true, reportDate: true, uploadedAt: true, status: true, errorSummary: true,
        uploadedBy: { select: { name: true } },
        _count: { select: { receivableImportRows: true, receivables: true, issues: true } }
      },
      orderBy: { uploadedAt: "desc" },
      take: 30
    }),
    prisma.clientAccount.findMany({
      where: { status: { notIn: ["merged", "archived"] } },
      select: { id: true, companyName: true, taxId: true },
      orderBy: { companyName: "asc" },
      take: 5000
    }),
    prisma.financialClientAlias.findMany({
      include: { client: { select: { companyName: true } }, createdBy: { select: { name: true } } },
      orderBy: [{ companyCode: "asc" }, { aliasName: "asc" }]
    }),
    prisma.financialReceivablePayment.findMany({
      include: { receivable: { select: { invoiceNumber: true, clientName: true } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.financialClientCredit.findMany({
      where: { status: "available" },
      include: { client: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.campaign.findMany({
      where: { archivedAt: null },
      select: { id: true, campaignName: true, clientId: true, startDate: true, endDate: true },
      orderBy: { startDate: "desc" },
      take: 2000
    }),
    prisma.location.findMany({
      select: { id: true, code: true, address: true, city: true },
      orderBy: { code: "asc" },
      take: 5000
    })
  ]);
  return {
    receivables: receivables.map(serializeReceivableLedger),
    uploads: uploads.map((upload) => ({ ...upload, reportDate: upload.reportDate?.toISOString() || null, uploadedAt: upload.uploadedAt.toISOString() })),
    clients,
    aliases,
    payments: payments.map((payment) => serializePayment(payment)),
    credits: credits.map((credit) => ({ ...credit, amount: credit.amount.toFixed(2), remainingAmount: credit.remainingAmount.toFixed(2), createdAt: credit.createdAt.toISOString() })),
    campaigns: campaigns.map((campaign) => ({ ...campaign, startDate: campaign.startDate?.toISOString() || null, endDate: campaign.endDate?.toISOString() || null })),
    locations
  };
}

function classifyImportRow(input: {
  row: ReceivablesImportRow;
  clients: Array<{ id: string; companyName: string; normalizedName: string | null; aliases: unknown; accountOwnerUserId: string | null }>;
  aliases: Array<{ companyCode: string; normalizedAlias: string; clientId: string }>;
  existingReceivables: Array<{ id: string; clientId: string | null; companyCode: string | null; normalizedInvoiceNumber: string | null; currency: string | null; invoicedAmount: Prisma.Decimal | null; collectedAmount: Prisma.Decimal | null; remainingAmount: Prisma.Decimal | null; lastReportDate: Date | null; rawRowJson: Prisma.JsonValue | null; canonicalKey: string | null; includedInReport: boolean; updatedAt: Date; _count: { payments: number } }>;
  duplicateInvoiceKeys: Set<string>;
}) {
  const { row } = input;
  if (row.rowState === "conflict") return classification(row, "conflict", "conflict", 0, "Neconcordanță critică în raport.", null, null, null);
  if (!row.normalizedInvoiceNumber || !row.currency || row.invoiceAmount == null) return classification(row, "manual", "unmatched", 0, "Factura, moneda sau valoarea lipsește.", null, null, null);
  const invoiceKey = [row.companyCode, row.normalizedInvoiceNumber, row.currency, row.normalizedClientName].join("|");
  if (input.duplicateInvoiceKeys.has(invoiceKey)) return classification(row, "conflict", "conflict", 0, "Factura apare de mai multe ori în același raport.", null, null, null);

  const clientMatch = matchClientCandidates({ clientName: row.clientNameRaw, companyCode: row.companyCode, clients: input.clients, aliases: input.aliases });
  const clientId = clientMatch.clientIds[0] || null;
  const invoiceCandidates = input.existingReceivables.filter((item) =>
    item.companyCode === row.companyCode && item.normalizedInvoiceNumber === row.normalizedInvoiceNumber && item.currency === row.currency
  );
  const exactInvoice = clientId ? invoiceCandidates.filter((item) => item.clientId === clientId) : [];
  const consolidatedExact = consolidateHistoricalDuplicates(exactInvoice);
  if (exactInvoice.length > 1 && !consolidatedExact) {
    return classification(row, "conflict", "conflict", 0, "Mai multe creanțe diferite corespund facturii.", clientId, null, null);
  }
  const matchedInvoice = exactInvoice.length === 1 ? exactInvoice[0] : consolidatedExact;
  if (matchedInvoice && clientMatch.level === "safe") {
    if (money(row.reportCollectedAmount).lessThan(money(matchedInvoice.collectedAmount).minus("0.01"))) {
      return classification(
        row,
        "conflict",
        "conflict",
        0,
        `Raportul indică ${money(row.reportCollectedAmount).toFixed(2)} încasat, dar aplicația are deja ${money(matchedInvoice.collectedAmount).toFixed(2)}. Încasările existente nu vor fi suprascrise.`,
        clientId,
        matchedInvoice.id,
        null
      );
    }
    const unchanged = sourceHashFromRaw(matchedInvoice.rawRowJson) === row.sourceHash;
    return classification(row, row.rowState === "credit" ? "needs_confirmation" : "allocated_auto", row.rowState === "credit" ? "probable" : "safe", row.rowState === "credit" ? 90 : 100, row.rowState === "credit" ? "Supraplata necesită confirmare explicită." : unchanged ? "Factură existentă, identică cu ultima reconciliere." : exactInvoice.length > 1 ? "Duplicate istorice identice; a fost aleasă înregistrarea canonică." : "Factură și client identificați sigur.", clientId, matchedInvoice.id, unchanged ? "unchanged" : "update_receivable");
  }
  const unassignedInvoice = invoiceCandidates.length === 1 && !invoiceCandidates[0].clientId ? invoiceCandidates[0] : null;
  if (unassignedInvoice && clientMatch.level === "safe") {
    return classification(row, "needs_confirmation", "probable", 90, "Factura există fără client alocat; confirmă legarea clientului.", clientId, unassignedInvoice.id, "update_receivable");
  }
  if (clientMatch.level === "safe") {
    return classification(row, row.rowState === "credit" ? "needs_confirmation" : "allocated_auto", row.rowState === "credit" ? "probable" : "safe", row.rowState === "credit" ? 90 : 100, row.rowState === "credit" ? "Creanță nouă cu supraplată; confirmă creditul." : "Client identificat sigur; se va crea creanța.", clientId, null, "create_receivable");
  }
  if (clientMatch.level === "conflict") return classification(row, "conflict", "conflict", 0, clientMatch.reason, null, null, null);
  if (clientMatch.level === "probable") return classification(row, "needs_confirmation", "probable", clientMatch.score, clientMatch.reason, clientId, null, "create_receivable");
  return classification(row, "manual", "unmatched", 0, clientMatch.reason, null, null, null);
}

function classification(row: ReceivablesImportRow, status: string, confidenceLevel: string, confidenceScore: number, matchReason: string, clientId: string | null, receivableId: string | null, proposedAction: string | null) {
  return { row, status, confidenceLevel, confidenceScore, matchReason, clientId, receivableId, proposedAction };
}

function duplicateKeys(rows: ReceivablesImportRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = [row.companyCode, row.normalizedInvoiceNumber, row.currency, row.normalizedClientName].join("|");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function consolidateHistoricalDuplicates(rows: Array<{
  id: string;
  invoicedAmount: Prisma.Decimal | null;
  collectedAmount: Prisma.Decimal | null;
  remainingAmount: Prisma.Decimal | null;
  rawRowJson: Prisma.JsonValue | null;
  canonicalKey: string | null;
  includedInReport: boolean;
  updatedAt: Date;
  _count: { payments: number };
}>) {
  if (rows.length < 2) return rows[0] || null;
  const first = rows[0];
  const identical = rows.every((row) =>
    money(row.invoicedAmount).equals(money(first.invoicedAmount)) &&
    money(row.collectedAmount).equals(money(first.collectedAmount)) &&
    money(row.remainingAmount).equals(money(first.remainingAmount))
  );
  if (!identical) return null;
  return [...rows].sort((left, right) =>
    Number(Boolean(right.canonicalKey)) - Number(Boolean(left.canonicalKey)) ||
    right._count.payments - left._count.payments ||
    Number(right.includedInReport) - Number(left.includedInReport) ||
    right.updatedAt.getTime() - left.updatedAt.getTime()
  )[0];
}

function serializeImportRow(row: Awaited<ReturnType<typeof prisma.financialReceivableImportRow.findMany>>[number] & Record<string, unknown>) {
  return {
    ...row,
    invoiceDate: row.invoiceDate instanceof Date ? row.invoiceDate.toISOString() : row.invoiceDate,
    dueDate: row.dueDate instanceof Date ? row.dueDate.toISOString() : row.dueDate,
    invoiceAmount: decimalString(row.invoiceAmount),
    reportCollectedAmount: decimalString(row.reportCollectedAmount),
    reportRemainingAmount: decimalString(row.reportRemainingAmount),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    resolvedAt: row.resolvedAt instanceof Date ? row.resolvedAt.toISOString() : row.resolvedAt
  };
}

function groupRows(rows: ReturnType<typeof serializeImportRow>[]) {
  const groups: Record<string, typeof rows> = {
    allocated_auto: [], needs_confirmation: [], manual: [], existing: [], updates: [], unchanged: [], conflict: [], credit: [], ignored: [], imported: []
  };
  for (const row of rows) {
    (groups[row.status] ||= []).push(row);
    if (row.receivableId) groups.existing.push(row);
    if (row.proposedAction === "update_receivable") groups.updates.push(row);
    if (row.proposedAction === "unchanged" && row.status !== "unchanged") groups.unchanged.push(row);
    if (row.resolutionAction === "confirm_credit" || money(row.reportRemainingAmount as string | null).isNegative()) groups.credit.push(row);
  }
  return groups;
}

function importTotals(rows: ReturnType<typeof serializeImportRow>[]) {
  const result = new Map<string, { companyCode: string; currency: string; clientId: string | null; clientName: string; state: string; invoiceAmount: Prisma.Decimal; collectedAmount: Prisma.Decimal; remainingAmount: Prisma.Decimal; count: number }>();
  for (const row of rows) {
    const currency = String(row.currency || "NECUNOSCUT");
    const clientId = typeof row.clientId === "string" ? row.clientId : null;
    const relatedClient = (row as Record<string, unknown>).client;
    const clientName = relatedClient && typeof relatedClient === "object" && "companyName" in relatedClient ? String(relatedClient.companyName) : "Nealocat";
    const dueDate = row.dueDate ? new Date(String(row.dueDate)) : null;
    const state = money(row.reportRemainingAmount as string | null).lessThan(0)
      ? "credit"
      : dueDate && dueDate < new Date(new Date().toISOString().slice(0, 10)) && money(row.reportRemainingAmount as string | null).greaterThan(0)
        ? "overdue"
        : "in_term";
    const key = [row.companyCode, currency, clientId || "nealocat", state].join("|");
    const current = result.get(key) || { companyCode: String(row.companyCode), currency, clientId, clientName, state, invoiceAmount: money(0), collectedAmount: money(0), remainingAmount: money(0), count: 0 };
    current.invoiceAmount = current.invoiceAmount.plus(money(row.invoiceAmount as string | null));
    current.collectedAmount = current.collectedAmount.plus(money(row.reportCollectedAmount as string | null));
    current.remainingAmount = current.remainingAmount.plus(money(row.reportRemainingAmount as string | null));
    current.count += 1;
    result.set(key, current);
  }
  return [...result.values()].map((item) => ({ ...item, invoiceAmount: item.invoiceAmount.toFixed(2), collectedAmount: item.collectedAmount.toFixed(2), remainingAmount: item.remainingAmount.toFixed(2) }));
}

async function activePaymentTotal(tx: Prisma.TransactionClient, receivableId: string) {
  const aggregate = await tx.financialReceivablePayment.aggregate({
    where: { receivableId, status: ACTIVE_PAYMENT_STATUS },
    _sum: { amount: true }
  });
  return money(aggregate._sum.amount);
}

function serializeReceivableLedger(row: Record<string, any>) {
  return {
    ...row,
    invoicedAmount: decimalString(row.invoicedAmount),
    collectedAmount: decimalString(row.collectedAmount),
    remainingAmount: decimalString(row.remainingAmount),
    dueDate: row.dueDate?.toISOString() || null,
    invoiceDate: row.invoiceDate?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    payments: row.payments.map(serializePayment),
    credits: row.credits.map((credit: Record<string, any>) => ({ ...credit, amount: decimalString(credit.amount), remainingAmount: decimalString(credit.remainingAmount), createdAt: credit.createdAt.toISOString() }))
  };
}

function serializePayment(payment: Record<string, any>) {
  return {
    ...payment,
    amount: decimalString(payment.amount),
    receivedAt: payment.receivedAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    cancelledAt: payment.cancelledAt?.toISOString() || null
  };
}

function decimalOrNull(value: string | null) {
  return value == null ? null : money(value);
}

function decimalString(value: unknown) {
  if (value == null) return null;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  return String(value);
}

function companyName(code: ReceivablesCompanyCode) {
  if (code === "FOCUS_MEDIA") return "Focus Media";
  if (code === "EXCELLENCE_MEDIA") return "Excellence Media";
  return "Focus BG / Focus Media LLC EOOD";
}

function sourceHashFromRaw(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceHash = (value as Record<string, Prisma.JsonValue>).sourceHash;
  return typeof sourceHash === "string" ? sourceHash : null;
}
