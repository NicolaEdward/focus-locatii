import { NextRequest, NextResponse } from "next/server";
import { syncOperationsControlAlerts } from "@/lib/operations-controls";
import { secureEqual } from "@/lib/security-secrets";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secureEqual(request.headers.get("authorization") || "", `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await syncOperationsControlAlerts(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Control check failed" }, { status: 503 }); }
}
