import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { financialReconciliationSummary, listFinancialReconciliation } from "@/lib/financial-reconciliation";
import { bucharestDayBounds } from "@/lib/dashboard/executive/time";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  const params = request.nextUrl.searchParams;
  const legalEntityId = params.get("legalEntityId") || undefined;
  const from = parseDate(params.get("from"), false);
  const to = parseDate(params.get("to"), true);
  const [reconciliation, summary] = await Promise.all([
    listFinancialReconciliation({
      legalEntityId,
      status: params.get("status") || undefined,
      classification: params.get("classification") || undefined,
      query: params.get("q") || undefined,
      from,
      to,
      page: Number(params.get("page") || 1),
      take: Number(params.get("take") || 30)
    }),
    financialReconciliationSummary({ legalEntityId, from, to })
  ]);
  return NextResponse.json({ reconciliation, summary }, { headers });
}

function parseDate(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const bounds = bucharestDayBounds(value);
  return endOfDay ? new Date(bounds.endExclusive.getTime() - 1) : bounds.start;
}
