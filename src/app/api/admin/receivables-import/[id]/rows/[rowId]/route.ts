import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { resolveReceivablesImportRow } from "@/lib/receivables-import-service";

type Context = { params: Promise<{ id: string; rowId: string }> };
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["confirm", "create", "ignore", "confirm_credit", "confirm_ledger"]),
  clientId: z.string().trim().nullable().optional(),
  receivableId: z.string().trim().nullable().optional(),
  campaignId: z.string().trim().nullable().optional(),
  locationId: z.string().trim().nullable().optional(),
  companyCode: z.enum(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]).nullable().optional(),
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  saveAlias: z.boolean().optional()
}).strict();

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  try {
    const { id, rowId } = await context.params;
    const preview = await resolveReceivablesImportRow({ ...schema.parse(await request.json()), uploadId: id, rowId, actor: session });
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Alocarea nu a putut fi salvată." }, { status: 400 });
  }
}
