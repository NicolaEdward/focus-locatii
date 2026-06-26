import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { getFinancialDashboardData } from "@/lib/financial-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.manage"]);
  if (response || !session) return response;

  const financial = await getFinancialDashboardData();
  return NextResponse.json({ financial }, { headers: noStoreHeaders });
}
