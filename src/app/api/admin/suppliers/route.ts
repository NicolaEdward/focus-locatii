import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createSupplier } from "@/lib/suppliers";
import { normalizeClientName } from "@/lib/clients";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.manage", "finance.validate"]);
  if (response || !session) return response;
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const suppliers = await prisma.supplier.findMany({
    where: {
      status: { not: "archived" },
      ...(query
        ? {
            OR: [
              { supplierName: { contains: query } },
              { normalizedName: { contains: normalizeClientName(query) } },
              { taxId: { contains: query } }
            ]
          }
        : {})
    },
    include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 3 } },
    orderBy: { supplierName: "asc" },
    take: 5000
  });
  return NextResponse.json({ suppliers }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage", "finance.validate"]);
  if (response || !session) return response;
  try {
    const supplier = await createSupplier(await request.json(), session);
    await recordAudit({
      actor: session,
      action: "supplier.upsert",
      entityType: "supplier",
      entityId: supplier.id,
      metadata: { supplierName: supplier.supplierName },
      request
    });
    return NextResponse.json({ supplier }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Furnizorul nu a putut fi salvat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
