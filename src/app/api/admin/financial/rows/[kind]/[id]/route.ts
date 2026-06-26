import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeInvoiceNumber } from "@/lib/clients";
import { matchingFinancialIssueIds, resolveFinancialRowEdit } from "@/lib/financial-integrity";
import { recalculateFinancialSnapshots } from "@/lib/financial-review";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ kind: string; id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const money = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}, z.number().nullable().optional());

const date = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}, z.date().nullable().optional());

const bodySchema = z.object({
  includeInReport: z.boolean().optional(),
  rowType: z.string().trim().max(80).optional(),
  name: z.string().trim().max(191).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  invoiceNumber: z.string().trim().max(191).nullable().optional(),
  location: z.string().trim().max(2000).nullable().optional(),
  campaignDetails: z.string().trim().max(2000).nullable().optional(),
  dueDate: date,
  amount: money,
  paidOrCollected: money,
  remaining: money,
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  status: z.string().trim().max(80).nullable().optional(),
  reviewNote: z.string().trim().max(2000).nullable().optional(),
  excludeReason: z.string().trim().max(2000).nullable().optional()
});

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;

  const { kind, id } = await context.params;
  if (kind !== "payable" && kind !== "receivable") {
    return NextResponse.json({ error: "Tip de rand financiar invalid." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const input = bodySchema.parse(await request.json());
    const row = kind === "payable"
      ? await prisma.financialPayable.findUnique({ where: { id } })
      : await prisma.financialReceivable.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ error: "Randul financiar nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    const rowData = row as Record<string, any>;

    const nextCurrency = input.currency === undefined ? row.currency : input.currency;
    const resolved = resolveFinancialRowEdit({
      kind,
      existingIncludedInReport: row.includedInReport,
      existingStatus: row.status,
      existingAmount: kind === "payable" ? rowData.amountToPay : rowData.invoicedAmount,
      existingPaidOrCollected: kind === "payable" ? rowData.amountPaid : rowData.collectedAmount,
      existingRemaining: row.remainingAmount,
      existingDueDate: row.dueDate,
      includeInReport: input.includeInReport,
      amount: input.amount,
      paidOrCollected: input.paidOrCollected,
      remaining: input.remaining,
      dueDate: input.dueDate,
      currency: nextCurrency,
      status: input.status
    });

    const rawRow = row.rawRowJson && typeof row.rawRowJson === "object" && !Array.isArray(row.rawRowJson)
      ? row.rawRowJson as Record<string, unknown>
      : {};
    const rowNumber = Number(rawRow.rowNumber) || null;

    await prisma.$transaction(async (tx) => {
      if (kind === "payable") {
        await tx.financialPayable.update({
          where: { id },
          data: {
            supplierName: input.name === undefined ? rowData.supplierName : input.name,
            documentDescription: input.description === undefined ? rowData.documentDescription : input.description,
            dueDate: resolved.dueDate,
            amountToPay: resolved.amount,
            amountPaid: resolved.paidOrCollected,
            remainingAmount: resolved.remaining,
            currency: nextCurrency,
            status: resolved.status,
            includedInReport: resolved.includeInReport,
            rowType: resolved.includeInReport ? input.rowType || "payable" : input.rowType || "excluded",
            needsReview: resolved.needsReview,
            reviewNote: input.reviewNote === undefined ? (resolved.needsReview ? row.reviewNote : null) : input.reviewNote,
            reviewedByUserId: session.id,
            reviewedAt: new Date(),
            excludeReason: resolved.includeInReport ? null : input.excludeReason || row.excludeReason || "Exclus manual din import."
          }
        });
      } else {
        await tx.financialReceivable.update({
          where: { id },
          data: {
            clientName: input.name === undefined ? rowData.clientName : input.name,
            invoiceNumber: input.invoiceNumber === undefined ? rowData.invoiceNumber : input.invoiceNumber,
            normalizedInvoiceNumber: input.invoiceNumber === undefined ? rowData.normalizedInvoiceNumber : normalizeInvoiceNumber(input.invoiceNumber),
            location: input.location === undefined ? rowData.location : input.location,
            campaignDetails: input.campaignDetails === undefined ? rowData.campaignDetails : input.campaignDetails,
            dueDate: resolved.dueDate,
            invoicedAmount: resolved.amount,
            collectedAmount: resolved.paidOrCollected,
            remainingAmount: resolved.remaining,
            currency: nextCurrency,
            status: resolved.status,
            includedInReport: resolved.includeInReport,
            rowType: resolved.includeInReport ? input.rowType || "receivable" : input.rowType || "excluded",
            needsReview: resolved.needsReview,
            reviewNote: input.reviewNote === undefined ? (resolved.needsReview ? row.reviewNote : null) : input.reviewNote,
            reviewedByUserId: session.id,
            reviewedAt: new Date(),
            excludeReason: resolved.includeInReport ? null : input.excludeReason || row.excludeReason || "Exclus manual din import."
          }
        });
      }

      const issueCandidates = rowNumber
        ? await tx.financialImportIssue.findMany({
            where: {
              uploadId: row.uploadId,
              rowNumber,
              resolvedAt: null
            },
            select: {
              id: true,
              uploadId: true,
              companyCode: true,
              companyName: true,
              sheetName: true,
              rowNumber: true,
              rawRowJson: true,
              resolvedAt: true
            }
          })
        : [];
      const issueIds = matchingFinancialIssueIds({
        uploadId: row.uploadId,
        companyCode: row.companyCode,
        companyName: row.companyName,
        rawRowJson: row.rawRowJson
      }, issueCandidates);
      if (issueIds.length) {
        await tx.financialImportIssue.updateMany({
          where: { id: { in: issueIds }, resolvedAt: null },
          data: {
            resolvedByUserId: session.id,
            resolvedAt: new Date(),
            resolutionNote: resolved.includeInReport ? "Corectat manual in Import Review." : "Exclus manual din raport."
          }
        });
      }
    });

    await recalculateFinancialSnapshots(row.uploadId);
    await recordAudit({
      actor: session,
      action: resolved.includeInReport ? "financial.row_reviewed" : "financial.row_excluded",
      entityType: `financial_${kind}`,
      entityId: id,
      metadata: { kind, input, status: resolved.status, needsReview: resolved.needsReview, currency: nextCurrency },
      request
    });

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Randul financiar nu a putut fi corectat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
