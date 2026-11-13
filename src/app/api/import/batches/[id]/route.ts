import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) {
    if (response) response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
  const { id } = await context.params;
  if (!/^inventory-[a-f0-9]{40}$/.test(id)) return NextResponse.json({ error: "Identificator de import invalid." }, { status: 400, headers });
  const result = await prisma.importBatch.findUnique({ where: { id }, select: { id: true, totalRows: true, createdCount: true, updatedCount: true, missingGpsCount: true, suspectGpsCount: true, okGpsCount: true } });
  // Absence does not prove failure: a running transaction is not visible yet.
  if (!result) return NextResponse.json({ status: "unknown", summary: null }, { status: 202, headers });
  const { id: batchId, ...values } = result;
  return NextResponse.json({ status: "completed", summary: { batchId, ...values } }, { headers });
}
