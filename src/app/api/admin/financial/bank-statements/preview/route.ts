import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createBankImportToken, parseBcrGeorgeStatement } from "@/lib/bcr-george-import";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/financial/bank-statements/preview", operation: "bank_statement.preview" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const startedAt = performance.now();
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Incarca extrasul bancar CSV." }, { status: 400, headers: noStoreHeaders });
      if (!/\.csv$/i.test(file.name)) return NextResponse.json({ error: "Extrasul bancar trebuie sa fie CSV." }, { status: 400, headers: noStoreHeaders });
      if (file.type && !["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream"].includes(file.type.toLowerCase())) {
        return NextResponse.json({ error: "Tipul fisierului nu corespunde unui extras CSV." }, { status: 400, headers: noStoreHeaders });
      }
      const preview = parseBcrGeorgeStatement(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        String(form.get("companyCode") || "") || null
      );
      const counts = preview.rows.reduce<Record<string, number>>((result, row) => {
        result[row.classification] = (result[row.classification] || 0) + 1;
        return result;
      }, {});
      emitStructuredLog("info", "bank_statement_preview_completed", {
        operation: "bank_statement.preview",
        role: session.role,
        durationMs: Math.round(performance.now() - startedAt),
        status: "success",
        metrics: { rowCount: preview.rows.length, itemCount: preview.warnings.length }
      });
      return NextResponse.json({
        preview: {
          ...preview,
          rows: preview.rows.map((row) => ({ ...row, bookedAt: row.bookedAt.toISOString(), valueDate: row.valueDate?.toISOString() || null })),
          periodStart: preview.periodStart.toISOString(),
          periodEnd: preview.periodEnd.toISOString(),
          issuedAt: preview.issuedAt?.toISOString() || null,
          counts,
          importToken: createBankImportToken(preview)
        }
      }, { headers: noStoreHeaders });
    } catch (error) {
      emitStructuredLog("warn", "bank_statement_preview_failed", {
        operation: "bank_statement.preview",
        role: session.role,
        durationMs: Math.round(performance.now() - startedAt),
        status: 400,
        errorCode: "BANK_STATEMENT_PREVIEW_FAILED"
      });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Extrasul nu a putut fi analizat." }, { status: 400, headers: noStoreHeaders });
    }
  });
}
