import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { generateBillingPlan, listBillingPlan } from "@/lib/billing-plan";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "finance.view",
  ]);
  if (response || !session) return response;
  try {
    return NextResponse.json(
      await listBillingPlan({
        campaignId: request.nextUrl.searchParams.get("campaignId") || undefined,
        currency: request.nextUrl.searchParams.get("currency") || undefined,
        status: request.nextUrl.searchParams.get("status") || undefined,
        page: Number(request.nextUrl.searchParams.get("page") || 1),
      }),
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Planul nu poate fi citit.",
      },
      { status: 400, headers },
    );
  }
}
export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, [
    "finance.validate",
    "finance.manage",
  ]);
  if (response || !session) return response;
  try {
    const input = z
      .object({ campaignId: z.string().min(1).max(191) })
      .parse(await request.json());
    return NextResponse.json(
      await generateBillingPlan({ ...input, actor: session }),
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Planul nu poate fi generat.",
      },
      { status: 400, headers },
    );
  }
}
