import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordReceivablePayment } from "@/lib/receivables-payment-service";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/),
  receivedAt: z.string().trim().min(1),
  paymentMethod: z.string().trim().max(120).nullable().optional(),
  paymentReference: z.string().trim().max(191).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  confirmOverpayment: z.boolean().optional(),
  requestKey: z.string().trim().min(8).max(191)
}).strict();

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const key = request.nextUrl.searchParams.get("requestKey");
  if (!key || key.length > 191) return NextResponse.json({ error: "Cheia operației este obligatorie." }, { status: 400 });
  const payment = await prisma.financialReceivablePayment.findFirst({
    where: { receivableId: id, requestKey: key },
    select: { id: true, amount: true, currency: true, status: true, receivedAt: true }
  });
  return NextResponse.json({ found: Boolean(payment), payment: payment ? { ...payment, amount: payment.amount.toFixed(2), receivedAt: payment.receivedAt.toISOString() } : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const receivedAt = new Date(body.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) throw new Error("Data încasării nu este validă.");
    const result = await recordReceivablePayment({ ...body, amount: body.amount.replace(",", "."), receivableId: id, receivedAt, actor: session });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Încasarea nu a putut fi salvată." }, { status: 400 });
  }
}
