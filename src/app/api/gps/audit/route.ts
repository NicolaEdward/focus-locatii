import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { runGpsAudit } from "@/lib/location-mutations";

export async function POST(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  return NextResponse.json(await runGpsAudit());
}
