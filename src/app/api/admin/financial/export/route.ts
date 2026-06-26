import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { moneyNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.export", "finance.manage"]);
  if (response || !session) return response;

  const upload = await prisma.financialReportUpload.findFirst({
    where: { activeVersion: true, status: "confirmed" },
    orderBy: { uploadedAt: "desc" }
  });
  if (!upload) {
    return NextResponse.json({ error: "Nu exista un raport financiar confirmat." }, { status: 404 });
  }

  const [payables, receivables] = await Promise.all([
    prisma.financialPayable.findMany({ where: { uploadId: upload.id }, orderBy: [{ companyName: "asc" }, { dueDate: "asc" }] }),
    prisma.financialReceivable.findMany({ where: { uploadId: upload.id }, orderBy: [{ companyName: "asc" }, { dueDate: "asc" }] })
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payables.map((row) => ({
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
  }))), "Plati");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(receivables.map((row) => ({
    Firma: row.companyName,
    Factura: row.invoiceNumber,
    Locatie: row.location,
    Campanie: row.campaignDetails,
    Client: row.clientName,
    "Data scadenta": dateValue(row.dueDate),
    "Suma facturata": moneyNumber(row.invoicedAmount),
    Moneda: row.currency,
    Incasat: moneyNumber(row.collectedAmount),
    "Rest de incasat": moneyNumber(row.remainingAmount),
    Status: row.status,
    "Needs review": row.needsReview ? "Da" : "Nu",
    Observatii: row.reviewNote
  }))), "Incasari");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await recordAudit({
    actor: session,
    action: "financial.export",
    entityType: "financial_report_upload",
    entityId: upload.id,
    request
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="situatie-financiara-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

function dateValue(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}
