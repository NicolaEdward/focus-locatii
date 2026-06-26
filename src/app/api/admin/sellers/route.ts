import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listSellerUsers } from "@/lib/seller-users";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own", "users.manage"]);
  if (response) return response;
  return NextResponse.json({ sellers: await listSellerUsers() }, { headers: noStoreHeaders });
}
