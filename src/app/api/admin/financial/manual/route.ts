import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeInvoiceNumber } from "@/lib/clients";
import { companyCodeForEntity, companyEntityOrThrow } from "@/lib/company-entities";
import { financialStatus, recalculateFinancialSnapshots } from "@/lib/financial-review";
import { prisma } from "@/lib/prisma";
import { normalizeReceivableInvoiceNumber, receivableCanonicalKey, receivableStatus } from "@/lib/receivables-domain";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const money = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  return String(value).trim().replace(",", ".");
}, z.string().regex(/^-?\d+(?:\.\d{1,2})?$/).transform((value) => new Prisma.Decimal(value)).nullable().optional());

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
    const amount = input.amount ?? new Prisma.Decimal(0);
    const paidOrCollected = input.paidOrCollected ?? new Prisma.Decimal(0);
    if (amount.isNegative() || paidOrCollected.isNegative()) throw new Error("Valorile financiare nu pot fi negative.");
    if (input.kind === "receivable" && paidOrCollected.greaterThan(amount)) {
      throw new Error("Supraplata se înregistrează din registrul creanței, cu confirmare explicită pentru credit client.");
    }
    const calculatedRemaining = Prisma.Decimal.max(amount.minus(paidOrCollected), 0);
    if (input.remaining && input.remaining.minus(calculatedRemaining).abs().greaterThan("0.01")) {
      throw new Error("Restul introdus nu corespunde diferenței dintre valoare și suma plătită/încasată.");
    }
    const remaining = calculatedRemaining;
    const companyName = companyEntityOrThrow(input.companyName);
    const companyCode = input.companyCode || companyCodeForEntity(companyName) || normalizeCompanyCode(companyName);
    const normalizedInvoiceNumber = input.kind === "receivable"
      ? normalizeReceivableInvoiceNumber(input.invoiceNumber)
      : normalizeInvoiceNumber(input.invoiceNumber);
    if (input.kind === "receivable" && !normalizedInvoiceNumber) {
      return NextResponse.json({ error: "Numărul facturii este obligatoriu pentru o creanță." }, { status: 400, headers: noStoreHeaders });
    }
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
    const created = await prisma.$transaction(async (tx) => {
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
        const payable = await tx.financialPayable.create({
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
        return { upload: activeUpload, entityId: payable.id };
      } else {
        const canonicalKey = receivableCanonicalKey({
          companyCode,
          normalizedInvoiceNumber,
          currency: input.currency
        });
        const existingInvoice = await tx.financialReceivable.findFirst({
          where: {
            OR: [
              { canonicalKey },
              {
                companyCode,
                normalizedInvoiceNumber,
                currency: input.currency,
                includedInReport: true
              }
            ]
          },
          select: { id: true }
        });
        if (existingInvoice) {
          throw new Error("Factura există deja pentru această firmă emitentă, număr și monedă.");
        }
        const receivable = await tx.financialReceivable.create({
          data: {
            uploadId: activeUpload.id,
            clientId: client?.id || null,
            campaignId: campaign?.id || null,
            accountOwnerUserId: client?.accountOwnerUserId || null,
            companyName,
            companyCode,
            invoiceNumber: input.invoiceNumber || null,
            normalizedInvoiceNumber,
            canonicalKey,
            invoiceDate: input.invoiceDate,
            location: input.location || null,
            campaignDetails: campaign?.campaignName || input.campaignDetails || input.documentDescription || null,
            clientName: client?.companyName || input.name || null,
            dueDate: input.dueDate,
            invoicedAmount: amount,
            collectedAmount: new Prisma.Decimal(0),
            remainingAmount: amount,
            currency: input.currency,
            status: receivableStatus({ invoiceAmount: amount, collectedAmount: 0, dueDate: input.dueDate }),
            rawRowJson,
            needsReview,
            includedInReport: true,
            rowType: "receivable",
            reviewNote: needsReview ? "Introdus manual, lipseste scadenta sau informatie critica." : input.note || null,
            reviewedByUserId: session.id,
            reviewedAt: new Date()
          }
        });
        if (paidOrCollected.greaterThan(0)) {
          const payment = await tx.financialReceivablePayment.create({
            data: {
              receivableId: receivable.id,
              amount: paidOrCollected,
              currency: input.currency,
              receivedAt: input.invoiceDate || new Date(),
              notes: input.note || "Încasare introdusă odată cu creanța manuală.",
              source: "manual_opening_payment",
              createdByUserId: session.id
            }
          });
          await tx.financialReceivable.update({
            where: { id: receivable.id },
            data: {
              collectedAmount: paidOrCollected,
              remainingAmount: remaining,
              collectedAt: remaining.equals(0) ? payment.receivedAt : null,
              status: receivableStatus({ invoiceAmount: amount, collectedAmount: paidOrCollected, dueDate: input.dueDate })
            }
          });
          await tx.auditLog.create({
            data: {
              userId: session.id,
              action: "receivable.payment_created",
              entityType: "financial_receivable_payment",
              entityId: payment.id,
              metadata: { receivableId: receivable.id, amount: paidOrCollected.toFixed(2), currency: input.currency, source: "manual_opening_payment" }
            }
          });
        }
        return { upload: activeUpload, entityId: receivable.id };
      }
    });

    await recalculateFinancialSnapshots(created.upload.id);
    await recordAudit({
      actor: session,
      action: "financial.manual_entry",
      entityType: `financial_${input.kind}`,
      entityId: created.entityId,
      metadata: { input: { ...input, companyName, amount: amount.toFixed(2), paidOrCollected: paidOrCollected.toFixed(2), remaining: remaining.toFixed(2), status, companyCode } },
      request
    });

    return NextResponse.json({ ok: true, uploadId: created.upload.id, entityId: created.entityId, status }, { headers: noStoreHeaders });
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
