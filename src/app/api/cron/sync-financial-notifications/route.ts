import { NextRequest, NextResponse } from "next/server";
import { syncCrmNotifications, syncFinancialNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET lipseste." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [financialCreated, crmCreated] = await Promise.all([
    syncFinancialNotifications(),
    syncCrmNotifications()
  ]);
  return NextResponse.json({ ok: true, financialCreated, crmCreated });
}
