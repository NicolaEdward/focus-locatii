import { NextResponse } from "next/server";
import { authEmailCapability } from "@/lib/transactional-email";

export async function GET() {
  return NextResponse.json({ passwordReset: authEmailCapability().enabled }, { headers: { "Cache-Control": "no-store" } });
}
