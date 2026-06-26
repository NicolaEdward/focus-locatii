import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listNotificationsForUser, syncFinancialNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAdmin(request);
  if (response || !session) return response;
  await syncFinancialNotifications();
  const notifications = await listNotificationsForUser(session);
  return NextResponse.json({ notifications }, { headers: noStoreHeaders });
}
