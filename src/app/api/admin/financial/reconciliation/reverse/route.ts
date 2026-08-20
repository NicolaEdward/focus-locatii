import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { reverseBankAllocation } from "@/lib/financial-reconciliation-mutations";

const schema = z.object({ paymentId: z.string().min(1), direction: z.enum(["receivable", "payable"]), reason: z.string().trim().min(2).max(500) });
const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  try {
    const result = await reverseBankAllocation({ ...schema.parse(await request.json()), actor: session });
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Alocarea nu a putut fi anulata." }, { status: 400, headers });
  }
}
