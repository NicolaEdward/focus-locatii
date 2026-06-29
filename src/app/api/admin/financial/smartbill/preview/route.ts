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
  type SmartBillReportType
} from "@/lib/smartbill-import";
import { prisma } from "@/lib/prisma";

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
      return NextResponse.json({ error: "Fisierul SmartBill este prea mare pentru import." }, { status: 400, headers: noStoreHeaders });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = reportType === "customer_invoices"
      ? parseSmartBillCustomerInvoices(buffer)
      : parseSmartBillSupplierDocuments(buffer);
    const context = await loadSmartBillPreviewContext(reportType, companyContext);
    const preview = buildSmartBillPreview({ parsed, fileName: file.name, companyContext, context });
    return NextResponse.json({ preview }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Raportul SmartBill nu a putut fi previzualizat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
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
          currency: true,
          invoicedAmount: true,
          rawRowJson: true,
          includedInReport: true,
          status: true
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
        amount: row.invoicedAmount
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
        currency: true,
        amountToPay: true,
        rawRowJson: true,
        includedInReport: true,
        status: true
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
      amount: row.amountToPay
    })) satisfies SmartBillExistingFinancialRow[]
  };
}
