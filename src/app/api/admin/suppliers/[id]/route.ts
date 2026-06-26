import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { updateSupplier } from "@/lib/suppliers";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage", "finance.validate"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const supplier = await updateSupplier(id, await request.json());
    await recordAudit({ actor: session, action: "supplier.update", entityType: "supplier", entityId: id, request });
    return NextResponse.json({ supplier }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Furnizorul nu a putut fi actualizat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const supplier = await updateSupplier(id, { status: "archived" });
    await recordAudit({ actor: session, action: "supplier.archive", entityType: "supplier", entityId: id, request });
    return NextResponse.json({ supplier }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Furnizorul nu a putut fi arhivat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
