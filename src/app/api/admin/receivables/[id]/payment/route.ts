import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordReceivablePayment } from "@/lib/receivables-payment-service";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

const schema = z.object({
  mode: z.literal("add").default("add"),
  amount: z.union([z.number().positive(), z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/)]),
  collectedAt: z.string().trim().min(1),
  paymentMethod: z.string().trim().max(120).nullable().optional(),
  paymentReference: z.string().trim().max(191).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  confirmOverpayment: z.boolean().optional(),
  requestKey: z.string().trim().min(8).max(191)
}).strict();

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const receivedAt = body.collectedAt ? new Date(body.collectedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw new Error("Data încasării nu este validă.");
    const result = await recordReceivablePayment({
      receivableId: id,
      amount: String(body.amount).replace(",", "."),
      receivedAt,
      paymentMethod: body.paymentMethod,
      paymentReference: body.paymentReference,
      notes: body.notes,
      confirmOverpayment: body.confirmOverpayment,
      requestKey: body.requestKey,
      actor: session
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Încasarea nu a putut fi salvată." }, { status: 400 });
  }
}
