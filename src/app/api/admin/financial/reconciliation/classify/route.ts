import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { classifyBankTransaction } from "@/lib/financial-reconciliation-mutations";

const schema = z.object({ transactionId: z.string().min(1), classification: z.string().min(1), reason: z.string().trim().min(2).max(500) });
const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  try {
    const body = schema.parse(await request.json());
    const transaction = await classifyBankTransaction({ ...body, actor: session });
    return NextResponse.json({ ok: true, transaction: { id: transaction.id, classification: transaction.classification, reconciliationStatus: transaction.reconciliationStatus } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tranzactia nu a putut fi clasificata." }, { status: 400, headers });
  }
}
