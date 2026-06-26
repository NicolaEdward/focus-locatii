import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listAdminLocations } from "@/lib/locations";

export async function GET(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  const locations = await listAdminLocations();
  return NextResponse.json({ exportedAt: new Date().toISOString(), locations });
}
