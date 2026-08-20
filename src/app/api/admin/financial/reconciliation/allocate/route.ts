import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { allocateBankTransaction } from "@/lib/financial-reconciliation-mutations";

const schema = z.object({
  bankTransactionId: z.string().min(1),
  requestKey: z.string().min(8).max(160),
  notes: z.string().trim().max(1000).optional().nullable(),
  rememberMerchantAlias: z.boolean().optional().default(false),
  allocations: z.array(z.object({
    direction: z.enum(["receivable", "payable"]),
    documentId: z.string().min(1),
    amount: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/)
  })).min(1).max(100)
});
const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  try {
    const body = schema.parse(await request.json());
    const result = await allocateBankTransaction({ ...body, allocations: body.allocations.map((allocation) => ({ ...allocation, amount: allocation.amount.replace(",", ".") })), actor: session });
    await recordAudit({ actor: session, action: "financial.reconciliation_confirmed", entityType: "financial_bank_transaction", entityId: body.bankTransactionId, metadata: { allocationCount: body.allocations.length, requestKey: body.requestKey }, request });
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconcilierea nu a putut fi confirmata." }, { status: 400, headers });
  }
}
