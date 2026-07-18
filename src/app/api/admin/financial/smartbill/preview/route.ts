import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import {
  buildSmartBillPreview,
  parseSmartBillCustomerInvoices,
  parseSmartBillSupplierDocuments,
  resolveSmartBillCompanyContext,
  type SmartBillCompanyContext,
  type SmartBillExistingFinancialRow,
  type SmartBillMatchEntity,
  type SmartBillParsedReport,
  type SmartBillReportType
} from "@/lib/smartbill-import";
import { prisma } from "@/lib/prisma";
import { SpreadsheetSecurityError } from "@/lib/secure-spreadsheet";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const reportTypeSchema = z.enum(["customer_invoices", "supplier_documents"]);
const companyNameSchema = z.string().trim().min(1, "Alege firma pentru importul SmartBill.");

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.manage"]);
  if (response || !session) return response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const reportType = reportTypeSchema.parse(form.get("reportType"));
    const companyContext = resolveSmartBillCompanyContext(companyNameSchema.parse(form.get("companyName")));
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Incarca raportul SmartBill Excel." }, { status: 400, headers: noStoreHeaders });
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: "Fisierul SmartBill trebuie sa fie Excel." }, { status: 400, headers: noStoreHeaders });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Fisierul SmartBill este prea mare pentru import." }, { status: 413, headers: noStoreHeaders });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseSmartBillReportWithDetection(buffer, reportType, { fileName: file.name, mimeType: file.type, signal: request.signal });
    const context = await loadSmartBillPreviewContext(parsed.reportType, companyContext);
    const preview = buildSmartBillPreview({ parsed, fileName: file.name, companyContext, context });
    return NextResponse.json({ preview }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Raportul SmartBill nu a putut fi previzualizat." },
      { status: error instanceof SpreadsheetSecurityError ? error.status : 400, headers: noStoreHeaders }
    );
  }
}

async function parseSmartBillReportWithDetection(
  buffer: Buffer,
  requestedType: SmartBillReportType,
  file: { fileName: string; mimeType: string; signal: AbortSignal }
): Promise<SmartBillParsedReport> {
  const requested = await parseSmartBillReport(buffer, requestedType, file);
  const requestedValidRows = countValidSmartBillRows(requested);
  if (requested.rows.length && requestedValidRows > 0) return requested;

  const alternateType: SmartBillReportType = requestedType === "customer_invoices" ? "supplier_documents" : "customer_invoices";
  let alternate: SmartBillParsedReport | null = null;
  try {
    alternate = await parseSmartBillReport(buffer, alternateType, file);
  } catch {
    return requested;
  }
  const alternateValidRows = countValidSmartBillRows(alternate);
  if (alternate.rows.length && alternateValidRows > requestedValidRows) {
    console.info("[smartbill-preview] report_type_auto_detected", {
      requestedType,
      detectedType: alternateType,
      requestedRows: requested.rows.length,
      requestedValidRows,
      alternateRows: alternate.rows.length,
      alternateValidRows
    });
    return alternate;
  }
  return requested;
}

function parseSmartBillReport(buffer: Buffer, reportType: SmartBillReportType, file: { fileName: string; mimeType: string; signal: AbortSignal }) {
  return reportType === "customer_invoices"
    ? parseSmartBillCustomerInvoices(buffer, file)
    : parseSmartBillSupplierDocuments(buffer, file);
}

function countValidSmartBillRows(report: SmartBillParsedReport) {
  return report.rows.filter((row) => !row.issues.length).length;
}

async function loadSmartBillPreviewContext(reportType: SmartBillReportType, companyContext: SmartBillCompanyContext) {
  const companyWhere = {
    OR: [
      { companyCode: companyContext.companyCode },
      { companyName: companyContext.companyName }
    ]
  };
  if (reportType === "customer_invoices") {
    const [clients, receivables] = await Promise.all([
      prisma.clientAccount.findMany({
        where: { status: { notIn: ["merged", "archived"] } },
        select: { id: true, companyName: true, normalizedName: true, taxId: true, accountOwnerUserId: true }
      }),
      prisma.financialReceivable.findMany({
        where: { ...companyWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
        select: {
          id: true,
          companyName: true,
          companyCode: true,
          normalizedInvoiceNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          clientId: true,
          clientName: true,
          dueDate: true,
          currency: true,
          invoicedAmount: true,
          collectedAmount: true,
          remainingAmount: true,
          rawRowJson: true,
          includedInReport: true,
          status: true,
          client: { select: { taxId: true, normalizedName: true } }
        },
        take: 10000,
        orderBy: { createdAt: "desc" }
      })
    ]);
    return {
      clients: clients.map((client) => ({
        id: client.id,
        name: client.companyName,
        normalizedName: client.normalizedName,
        taxId: client.taxId,
        accountOwnerUserId: client.accountOwnerUserId
      })) satisfies SmartBillMatchEntity[],
      receivables: receivables.map((row) => ({
        ...row,
        amount: row.invoicedAmount,
        paidOrCollectedAmount: row.collectedAmount,
        entityTaxId: row.client?.taxId || null,
        entityNormalizedName: row.client?.normalizedName || null
      })) satisfies SmartBillExistingFinancialRow[]
    };
  }

  const [suppliers, payables] = await Promise.all([
    prisma.supplier.findMany({
      where: { status: { notIn: ["archived"] } },
      select: { id: true, supplierName: true, normalizedName: true, taxId: true }
    }),
    prisma.financialPayable.findMany({
      where: { ...companyWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      select: {
        id: true,
        companyName: true,
        companyCode: true,
        normalizedInvoiceNumber: true,
        invoiceNumber: true,
        invoiceDate: true,
        supplierId: true,
          supplierName: true,
          dueDate: true,
          currency: true,
          amountToPay: true,
          amountPaid: true,
          remainingAmount: true,
          rawRowJson: true,
          includedInReport: true,
          status: true,
          supplier: { select: { taxId: true, normalizedName: true } }
        },
      take: 10000,
      orderBy: { createdAt: "desc" }
    })
  ]);
  return {
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.supplierName,
      normalizedName: supplier.normalizedName,
      taxId: supplier.taxId
    })) satisfies SmartBillMatchEntity[],
    payables: payables.map((row) => ({
      ...row,
      amount: row.amountToPay,
      paidOrCollectedAmount: row.amountPaid,
      entityTaxId: row.supplier?.taxId || null,
      entityNormalizedName: row.supplier?.normalizedName || null
    })) satisfies SmartBillExistingFinancialRow[]
  };
}
