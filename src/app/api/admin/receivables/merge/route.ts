import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { validateReceivableDuplicateMerge } from "@/lib/financial-integrity";
import { recalculateFinancialSnapshots } from "@/lib/financial-review";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const mergeSchema = z.object({
  primaryInvoiceId: z.string().trim().min(1),
  duplicateInvoiceId: z.string().trim().min(1),
  reason: z.string().trim().max(1000).nullable().optional()
});

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;

  try {
    const input = mergeSchema.parse(await request.json());
    const [primary, duplicate] = await Promise.all([
      prisma.financialReceivable.findUnique({ where: { id: input.primaryInvoiceId } }),
      prisma.financialReceivable.findUnique({ where: { id: input.duplicateInvoiceId } })
    ]);
    if (!primary || !duplicate) {
      return NextResponse.json({ error: "Una dintre facturi nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    validateReceivableDuplicateMerge(primary, duplicate);

    await prisma.$transaction(async (tx) => {
      await tx.financialReceivable.update({
        where: { id: duplicate.id },
        data: {
          includedInReport: false,
          status: "archived",
          rowType: "duplicate",
          excludeReason: input.reason || `Duplicat al facturii ${primary.invoiceNumber || primary.id}.`,
          reviewedByUserId: session.id,
          reviewedAt: new Date(),
          reviewNote: `Factura duplicata, pastrata pentru istoric. Principal: ${primary.id}`
        }
      });
    });
    await recalculateFinancialSnapshots(duplicate.uploadId);
    if (primary.uploadId !== duplicate.uploadId) await recalculateFinancialSnapshots(primary.uploadId);
    await recordAudit({
      actor: session,
      action: "receivable.duplicate_archived",
      entityType: "financial_receivable",
      entityId: duplicate.id,
      metadata: {
        primaryInvoiceId: primary.id,
        duplicateInvoiceId: duplicate.id,
        invoiceNumber: duplicate.invoiceNumber,
        reason: input.reason || null
      },
      request
    });

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Duplicatul nu a putut fi arhivat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
