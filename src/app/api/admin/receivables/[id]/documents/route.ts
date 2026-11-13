import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { evaluateDocumentAccess, linksFromDocument, resolveDocumentAccess } from "@/lib/client-document-access";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.view"]);
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  try {
    const { id } = await context.params;
    const invoiceAccess = await resolveDocumentAccess({ financialReceivableId: id });
    const denied = evaluateDocumentAccess(session, invoiceAccess, "view");
    if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status, headers });
    const rows = await prisma.clientDocument.findMany({
      where: { financialReceivableId: id, status: "active", documentType: { not: OPERATIONAL_PROOF_DOCUMENT_TYPE } },
      select: { id: true, fileName: true, fileType: true, fileSize: true, documentType: true, uploadedAt: true, expiryDate: true, status: true, clientId: true, campaignId: true, reservationId: true, billingItemId: true, financialReceivableId: true, financialPayableId: true, uploadedBy: { select: { name: true } } },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      take: 101,
    });
    const accessChecks = new Map<string, ReturnType<typeof resolveDocumentAccess>>([[JSON.stringify({ financialReceivableId: id }), Promise.resolve(invoiceAccess)]]);
    const visible: typeof rows = [];
    for (const document of rows) {
      const links = linksFromDocument(document);
      const key = JSON.stringify(Object.fromEntries(Object.entries(links).filter(([, value]) => Boolean(value))));
      let check = accessChecks.get(key);
      if (!check) { check = resolveDocumentAccess(links); accessChecks.set(key, check); }
      if (!evaluateDocumentAccess(session, await check, "view")) visible.push(document);
    }
    return NextResponse.json({ documents: visible.slice(0, 100).map((document) => ({ id: document.id, fileName: document.fileName, fileType: document.fileType, fileSize: document.fileSize, documentType: document.documentType, uploadedAt: document.uploadedAt.toISOString(), expiryDate: document.expiryDate?.toISOString() || null, status: document.status, uploadedByName: document.uploadedBy?.name || null })), hasMore: rows.length > 100 }, { headers });
  } catch {
    return NextResponse.json({ error: "Documentele facturii sunt temporar indisponibile." }, { status: 503, headers });
  }
}
