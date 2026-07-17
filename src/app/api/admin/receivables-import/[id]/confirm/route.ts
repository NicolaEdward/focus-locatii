import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { confirmReceivablesImport, getReceivablesImportPreview } from "@/lib/receivables-import-service";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const result = await confirmReceivablesImport({ uploadId: id, actor: session });
    return NextResponse.json({ result, preview: await getReceivablesImportPreview(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Importul nu a putut fi confirmat." }, { status: 409 });
  }
}
