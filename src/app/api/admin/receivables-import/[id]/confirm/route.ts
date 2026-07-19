import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { confirmReceivablesImport, getReceivablesImportPreview } from "@/lib/receivables-import-service";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest, context: Context) {
  const correlationId = requestCorrelationId(request);
  const startedAt = performance.now();
  const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const result = await confirmReceivablesImport({ uploadId: id, actor: session });
    emitStructuredLog("info", "spreadsheet_import_confirm_completed", {
      correlationId,
      operation: "receivables.confirm",
      entityType: "financial_report_upload",
      entityId: id,
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: "success",
      metrics: {
        createdCount: result.created,
        updatedCount: result.updated,
        itemCount: result.unchanged + result.ignored
      }
    });
    return NextResponse.json({ result, preview: await getReceivablesImportPreview(id) });
  } catch (error) {
    emitStructuredLog("error", "spreadsheet_import_confirm_failed", {
      correlationId,
      operation: "receivables.confirm",
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: 409,
      errorCode: safeErrorCode(error, "RECEIVABLES_CONFIRM_FAILED")
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Importul nu a putut fi confirmat." }, { status: 409 });
  }
}
