import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.confirm", "finance.manage"]);
  if (response || !session) return response;
  const transactionId = request.nextUrl.searchParams.get("transactionId") || "";
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  const transaction = await prisma.financialBankTransaction.findUnique({ where: { id: transactionId }, select: { id: true, legalEntityId: true, currency: true, debitAmount: true, creditAmount: true } });
  if (!transaction) return NextResponse.json({ error: "Tranzactia nu exista." }, { status: 404 });
  if (transaction.creditAmount.greaterThan(0)) {
    const documents = await prisma.financialReceivable.findMany({
      where: {
        legalEntityId: transaction.legalEntityId, currency: transaction.currency, includedInReport: true,
        remainingAmount: { gt: 0.01 }, status: { notIn: ["cancelled", "archived"] },
        ...(query ? { OR: [{ invoiceNumber: { contains: query } }, { clientName: { contains: query } }, { client: { companyName: { contains: query } } }] } : {})
      },
      select: { id: true, invoiceNumber: true, clientName: true, remainingAmount: true, currency: true, dueDate: true },
      orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }], take: 30
    });
    return NextResponse.json({ direction: "receivable", options: documents.map((document) => ({ id: document.id, documentNumber: document.invoiceNumber, partnerName: document.clientName, remainingAmount: document.remainingAmount?.toFixed(2) || "0.00", currency: document.currency, dueDate: document.dueDate?.toISOString() || null })) }, { headers: { "Cache-Control": "no-store" } });
  }
  const documents = await prisma.financialPayable.findMany({
    where: {
      legalEntityId: transaction.legalEntityId, currency: transaction.currency, includedInReport: true,
      remainingAmount: { gt: 0.01 }, status: { notIn: ["cancelled", "archived"] },
      ...(query ? { OR: [{ invoiceNumber: { contains: query } }, { supplierName: { contains: query } }, { supplier: { supplierName: { contains: query } } }] } : {})
    },
    select: { id: true, invoiceNumber: true, supplierName: true, remainingAmount: true, currency: true, dueDate: true },
    orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }], take: 30
  });
  return NextResponse.json({ direction: "payable", options: documents.map((document) => ({ id: document.id, documentNumber: document.invoiceNumber, partnerName: document.supplierName, remainingAmount: document.remainingAmount?.toFixed(2) || "0.00", currency: document.currency, dueDate: document.dueDate?.toISOString() || null })) }, { headers: { "Cache-Control": "no-store" } });
}
