import { NextRequest, NextResponse } from "next/server";
import { requireNotificationAccess } from "@/lib/notification-access";
import { listNotificationsForUser } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireNotificationAccess(request);
  if (response || !session) return response;
  const notifications = await listNotificationsForUser(session);
  return NextResponse.json({ notifications }, { headers: noStoreHeaders });
}
