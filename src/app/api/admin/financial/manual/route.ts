import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeInvoiceNumber } from "@/lib/clients";
import { companyCodeForEntity, companyEntityOrThrow } from "@/lib/company-entities";
import { financialStatus, recalculateFinancialSnapshots } from "@/lib/financial-review";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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

const schema = z.object({
  kind: z.enum(["receivable", "payable"]),
  companyName: z.string().trim().min(2).max(191),
  companyCode: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().max(191).nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  campaignId: z.string().trim().nullable().optional(),
  supplierId: z.string().trim().nullable().optional(),
  documentDescription: z.string().trim().max(2000).nullable().optional(),
  invoiceNumber: z.string().trim().max(191).nullable().optional(),
  invoiceDate: date,
  location: z.string().trim().max(2000).nullable().optional(),
  campaignDetails: z.string().trim().max(2000).nullable().optional(),
  dueDate: date,
  amount: money,
  paidOrCollected: money,
  remaining: money,
  currency: z.preprocess((value) => value || "RON", z.enum(["RON", "EUR"])),
  note: z.string().trim().max(2000).nullable().optional()
});

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.validate", "finance.manage"]);
  if (response || !session) return response;

  try {
    const input = schema.parse(await request.json());
    const amount = input.amount ?? 0;
    const paidOrCollected = input.paidOrCollected ?? 0;
    const remaining = input.remaining ?? Math.max(0, roundMoney(amount - paidOrCollected));
    const companyName = companyEntityOrThrow(input.companyName);
    const companyCode = input.companyCode || companyCodeForEntity(companyName) || normalizeCompanyCode(companyName);
    const normalizedInvoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
    const [client, campaign, supplier] = await Promise.all([
      input.kind === "receivable" && input.clientId
        ? prisma.clientAccount.findUnique({ where: { id: input.clientId }, include: { accountOwner: { select: { id: true } } } })
        : null,
      input.kind === "receivable" && input.campaignId
        ? prisma.campaign.findUnique({ where: { id: input.campaignId } })
        : null,
      input.kind === "payable" && input.supplierId
        ? prisma.supplier.findUnique({ where: { id: input.supplierId } })
        : null
    ]);
    if (input.kind === "receivable" && !client) {
      return NextResponse.json({ error: "Factura client trebuie asociata unui client real." }, { status: 400, headers: noStoreHeaders });
    }
    if (input.kind === "receivable" && campaign && campaign.clientId !== client?.id) {
      return NextResponse.json({ error: "Campania facturii nu apartine clientului selectat." }, { status: 400, headers: noStoreHeaders });
    }
    if (input.kind === "payable" && !supplier) {
      return NextResponse.json({ error: "Factura furnizor trebuie asociata unui furnizor real." }, { status: 400, headers: noStoreHeaders });
    }
    if (normalizedInvoiceNumber) {
      const duplicate = input.kind === "receivable"
        ? await prisma.financialReceivable.findFirst({
            where: {
              normalizedInvoiceNumber,
              companyCode,
              clientId: client?.id,
              includedInReport: true,
              status: { notIn: ["cancelled", "archived"] }
            },
            select: { id: true, invoiceNumber: true }
          })
        : await prisma.financialPayable.findFirst({
            where: {
              normalizedInvoiceNumber,
              companyCode,
              supplierId: supplier?.id,
              includedInReport: true,
              status: { notIn: ["cancelled", "archived"] }
            },
            select: { id: true, invoiceNumber: true }
          });
      if (duplicate) {
        return NextResponse.json(
          { error: `Factura pare deja introdusa (${input.invoiceNumber}). Verifica duplicatele inainte sa o salvezi din nou.` },
          { status: 409, headers: noStoreHeaders }
        );
      }
    }
    const status = financialStatus({
      kind: input.kind,
      remainingAmount: remaining,
      paidOrCollected,
      dueDate: input.dueDate
    });
    const needsReview = status === "needs_review";
    const upload = await prisma.$transaction(async (tx) => {
      let activeUpload = await tx.financialReportUpload.findFirst({
        where: { activeVersion: true, status: "confirmed" },
        orderBy: { uploadedAt: "desc" }
      });
      if (!activeUpload) {
        activeUpload = await tx.financialReportUpload.create({
          data: {
            uploadedByUserId: session.id,
            reportDate: startOfUtcDay(new Date()),
            originalFileName: "Introducere manuala financiar",
            fileHash: `manual-${Date.now()}-${session.id}`,
            status: "confirmed",
            activeVersion: true
          }
        });
      }

      const rawRowJson = {
        source: "manual",
        enteredBy: session.email,
        enteredAt: new Date().toISOString(),
        note: input.note || null
      } satisfies Prisma.InputJsonObject;

      if (input.kind === "payable") {
        await tx.financialPayable.create({
          data: {
            uploadId: activeUpload.id,
            supplierId: supplier?.id || null,
            companyName,
            companyCode,
            supplierName: supplier?.supplierName || input.name || null,
            invoiceNumber: input.invoiceNumber || null,
            normalizedInvoiceNumber,
            invoiceDate: input.invoiceDate,
            documentDescription: input.documentDescription || input.note || null,
            dueDate: input.dueDate,
            amountToPay: amount,
            amountPaid: paidOrCollected,
            remainingAmount: remaining,
            currency: input.currency,
            status,
            rawRowJson,
            needsReview,
            includedInReport: true,
            rowType: "payable",
            reviewNote: needsReview ? "Introdus manual, lipseste scadenta sau informatie critica." : input.note || null,
            reviewedByUserId: session.id,
            reviewedAt: new Date()
          }
        });
      } else {
        await tx.financialReceivable.create({
          data: {
            uploadId: activeUpload.id,
            clientId: client?.id || null,
            campaignId: campaign?.id || null,
            accountOwnerUserId: client?.accountOwnerUserId || null,
            companyName,
            companyCode,
            invoiceNumber: input.invoiceNumber || null,
            normalizedInvoiceNumber,
            invoiceDate: input.invoiceDate,
            location: input.location || null,
            campaignDetails: campaign?.campaignName || input.campaignDetails || input.documentDescription || null,
            clientName: client?.companyName || input.name || null,
            dueDate: input.dueDate,
            invoicedAmount: amount,
            collectedAmount: paidOrCollected,
            remainingAmount: remaining,
            currency: input.currency,
            status,
            rawRowJson,
            needsReview,
            includedInReport: true,
            rowType: "receivable",
            reviewNote: needsReview ? "Introdus manual, lipseste scadenta sau informatie critica." : input.note || null,
            reviewedByUserId: session.id,
            reviewedAt: new Date()
          }
        });
      }
      return activeUpload;
    });

    await recalculateFinancialSnapshots(upload.id);
    await recordAudit({
      actor: session,
      action: "financial.manual_entry",
      entityType: `financial_${input.kind}`,
      entityId: upload.id,
      metadata: { input: { ...input, companyName, amount, paidOrCollected, remaining, status, companyCode } },
      request
    });

    return NextResponse.json({ ok: true, uploadId: upload.id, status }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Randul financiar nu a putut fi introdus manual." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function normalizeCompanyCode(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("excellence")) return "EXCELLENCE_MEDIA";
  if (normalized.includes("focus bg") || normalized.includes("llc") || normalized.includes("eood")) return "FOCUS_BG";
  if (normalized.includes("focus")) return "FOCUS_MEDIA";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
