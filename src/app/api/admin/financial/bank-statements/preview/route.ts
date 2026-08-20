import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createBankImportToken, parseBankStatement } from "@/lib/bcr-george-import";
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
      const preview = parseBankStatement(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        String(form.get("companyCode") || "") || null
      );
      const counts = preview.rows.reduce<Record<string, number>>((result, row) => {
        result[row.classification] = (result[row.classification] || 0) + 1;
        return result;
      }, {});
      const totals = preview.rows.reduce<Record<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>>((result, row) => {
        result[row.currency] ||= { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
        result[row.currency].debit = result[row.currency].debit.plus(row.debitAmount);
        result[row.currency].credit = result[row.currency].credit.plus(row.creditAmount);
        return result;
      }, {});
      const { rows, ...metadata } = preview;
      emitStructuredLog("info", "bank_statement_preview_completed", {
        operation: "bank_statement.preview",
        role: session.role,
        durationMs: Math.round(performance.now() - startedAt),
        status: "success",
        metrics: { rowCount: preview.rows.length, itemCount: preview.warnings.length }
      });
      return NextResponse.json({
        preview: {
          ...metadata,
          rowCount: rows.length,
          sampleRows: rows.slice(0, 12).map((row) => ({
            rowNumber: row.rowNumber,
            bookedAt: row.bookedAt.toISOString(),
            currency: row.currency,
            debitAmount: row.debitAmount,
            creditAmount: row.creditAmount,
            description: row.description,
            classification: row.classification,
            accountLabel: row.accountLabel
          })),
          periodStart: preview.periodStart.toISOString(),
          periodEnd: preview.periodEnd.toISOString(),
          issuedAt: preview.issuedAt?.toISOString() || null,
          accounts: preview.accounts.map((account) => ({
            ...account,
            periodStart: account.periodStart.toISOString(),
            periodEnd: account.periodEnd.toISOString()
          })),
          counts,
          totals: Object.entries(totals).map(([currency, value]) => ({
            currency,
            debit: value.debit.toFixed(2),
            credit: value.credit.toFixed(2)
          })),
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
