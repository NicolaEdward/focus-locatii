import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { moneyNumber } from "@/lib/money";
import { sanitizeSpreadsheetRows } from "@/lib/spreadsheet-export";
import { currentFinancialReportScope } from "@/lib/financial-report-scope";
import { receivableNetAmount, receivableNetRemaining, receivableAdjustmentTotal } from "@/lib/receivable-adjustments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.export", "finance.manage"]);
  if (response || !session) return response;

  const snapshot = request.nextUrl.searchParams.get("scope") === "snapshot";
  const uploadId = request.nextUrl.searchParams.get("uploadId");
  const upload = snapshot && uploadId ? await prisma.financialReportUpload.findFirst({ where: { id: uploadId, status: "confirmed" }, select: { id: true } }) : null;
  if (snapshot && !upload) return NextResponse.json({ error: "Exportul de versiune necesită un upload confirmat explicit." }, { status: 400 });
  const scope = await currentFinancialReportScope();
  const validated = request.nextUrl.searchParams.get("includeReview") !== "1";
  const included = { includedInReport: true, ...(validated ? { needsReview: false } : {}) };

  const [payables, receivables] = await Promise.all([
    prisma.financialPayable.findMany({ where: { ...(upload ? { uploadId: upload.id } : scope.payables), ...included }, orderBy: [{ companyName: "asc" }, { dueDate: "asc" }] }),
    prisma.financialReceivable.findMany({ where: { ...(upload ? { uploadId: upload.id } : scope.receivables), ...included }, orderBy: [{ companyName: "asc" }, { dueDate: "asc" }] })
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(payables.map((row) => ({
    Firma: row.companyName,
    Furnizor: row.supplierName,
    "Descriere document": row.documentDescription,
    "Data scadenta": dateValue(row.dueDate),
    "Suma de plata": moneyNumber(row.amountToPay),
    Moneda: row.currency,
    Achitat: moneyNumber(row.amountPaid),
    "Rest de plata": moneyNumber(row.remainingAmount),
    Status: row.status,
    "Needs review": row.needsReview ? "Da" : "Nu",
    Observatii: row.reviewNote
  })))), "Plati");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(receivables.map((row) => ({
    Firma: row.companyName,
    Factura: row.invoiceNumber,
    Locatie: row.location,
    Campanie: row.campaignDetails,
    Client: row.clientName,
    "Data scadenta": dateValue(row.dueDate),
    "Suma facturata": moneyNumber(row.invoicedAmount),
    "Ajustări storno": moneyNumber(receivableAdjustmentTotal(row.rawRowJson)),
    "Valoare netă ajustată": moneyNumber(receivableNetAmount(row.invoicedAmount, row.rawRowJson)),
    Moneda: row.currency,
    Incasat: moneyNumber(row.collectedAmount),
    "Rest de incasat": moneyNumber(receivableNetRemaining(row)),
    Status: row.status,
    "Needs review": row.needsReview ? "Da" : "Nu",
    Observatii: row.reviewNote
  })))), "Incasari");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await recordAudit({
    actor: session,
    action: "financial.export",
    entityType: upload ? "financial_report_upload" : "financial_registry",
    entityId: upload?.id,
    metadata: { scope: snapshot ? "snapshot" : "canonical-current", includedReview: !validated, receivableCount: receivables.length, payableCount: payables.length },
    request
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="situatie-financiara-${snapshot ? "versiune" : "registru-curent"}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}
