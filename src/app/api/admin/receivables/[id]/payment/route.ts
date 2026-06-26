import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { assertReceivablePaymentStatus, calculateReceivablePayment } from "@/lib/financial-integrity";
import { recalculateFinancialSnapshots } from "@/lib/financial-review";
import { moneyDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const paymentSchema = z.object({
  mode: z.enum(["add", "set"]).default("add"),
  amount: z.preprocess((value) => Number(String(value).replace(",", ".")), z.number().nonnegative()),
  collectedAt: z.string().trim().nullable().optional(),
  paymentMethod: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
}).strict();

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;

  try {
    const input = paymentSchema.parse(await request.json());
    const row = await prisma.financialReceivable.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Factura nu exista." }, { status: 404, headers: noStoreHeaders });
    if (!row.includedInReport) return NextResponse.json({ error: "Factura exclusa nu poate fi incasata." }, { status: 400, headers: noStoreHeaders });
    assertReceivablePaymentStatus(row.status);

    const payment = calculateReceivablePayment({
      invoiceAmount: row.invoicedAmount,
      previousCollected: row.collectedAmount,
      paymentAmount: input.amount,
      mode: input.mode,
      dueDate: row.dueDate
    });
    const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
    if (Number.isNaN(collectedAt.getTime())) {
      return NextResponse.json({ error: "Data incasarii nu este valida." }, { status: 400, headers: noStoreHeaders });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const receivable = await tx.financialReceivable.update({
        where: { id },
        data: {
          collectedAmount: moneyDecimal(payment.collected),
          remainingAmount: moneyDecimal(payment.remaining),
          status: payment.status,
          needsReview: false,
          collectedAt,
          paymentMethod: input.paymentMethod || null,
          collectionNotes: input.notes || row.collectionNotes
        }
      });

      if (row.billingItemId) {
        await tx.billingItem.update({
          where: { id: row.billingItemId },
          data: {
            collectedAmount: moneyDecimal(payment.collected),
            remainingAmount: moneyDecimal(payment.remaining),
            collectedAt,
            paymentMethod: input.paymentMethod || null,
            collectionNotes: input.notes || null,
            status: payment.remaining <= 0 ? "collected" : "partially_collected"
          }
        });
      }

      return receivable;
    });

    await recalculateFinancialSnapshots(row.uploadId);
    await recordAudit({
      actor: session,
      action: "receivable.payment_recorded",
      entityType: "financial_receivable",
      entityId: id,
      metadata: {
        invoiceNumber: row.invoiceNumber,
        previousCollected: payment.previousCollected,
        collected: payment.collected,
        remaining: payment.remaining,
        status: payment.status,
        mode: input.mode
      },
      request
    });

    return NextResponse.json({ receivable: updated }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Incasarea nu a putut fi salvata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
