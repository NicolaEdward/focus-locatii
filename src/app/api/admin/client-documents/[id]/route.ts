import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { evaluateDocumentAccess, lockDocumentLinks, linksFromDocument, resolveDocumentAccess } from "@/lib/client-document-access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own"]);
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(noStoreHeaders)) response.headers.set(key, value);
    return response;
  }
  const { id } = await context.params;
  const document = await prisma.clientDocument.findUnique({ where: { id } });
  if (!document || document.status === "archived") {
    return NextResponse.json({ error: "Documentul nu exista." }, { status: 404, headers: noStoreHeaders });
  }
  const accessError = evaluateDocumentAccess(session, await resolveDocumentAccess(linksFromDocument(document)), "view");
  if (accessError) {
    return NextResponse.json({ error: accessError.error }, { status: accessError.status, headers: noStoreHeaders });
  }
  if (document.storageUrl.startsWith("data:")) {
    const match = document.storageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "Fisier invalid." }, { status: 400, headers: noStoreHeaders });
    const body = Buffer.from(match[2], "base64");
    return new NextResponse(body, {
      headers: {
        ...noStoreHeaders,
        "content-type": document.fileType || match[1],
        "content-disposition": `attachment; filename="${sanitizeFileName(document.fileName)}"`
      }
    });
  }
  const redirect = NextResponse.redirect(document.storageUrl);
  for (const [key, value] of Object.entries(noStoreHeaders)) redirect.headers.set(key, value);
  return redirect;
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(noStoreHeaders)) response.headers.set(key, value);
    return response;
  }
  const { id } = await context.params;

  try {
    const document = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM portfolio_client_documents WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.clientDocument.findUnique({ where: { id } });
      if (!existing || existing.status === "archived") throw Object.assign(new Error("Documentul nu există."), { status: 404 });
      const links = linksFromDocument(existing);
      await lockDocumentLinks(tx, links);
      const accessError = evaluateDocumentAccess(session, await resolveDocumentAccess(links, tx), "manage");
      if (accessError) throw Object.assign(new Error(accessError.error), { status: accessError.status });
      const archived = await tx.clientDocument.update({ where: { id }, data: { status: "archived" } });
      await tx.auditLog.create({ data: {
        userId: session.id, action: "document.archive", entityType: "client_document", entityId: id,
        metadata: { durability: "business-transaction", fileName: archived.fileName, clientId: archived.clientId, reservationId: archived.reservationId }
      } });
      return { id: archived.id, status: archived.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return NextResponse.json({ document }, { headers: noStoreHeaders });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && [403, 404, 409, 422].includes(Number(error.status)) ? Number(error.status) : 503;
    return NextResponse.json({ error: status === 503 ? "Arhivarea documentului este temporar indisponibilă." : (error as Error).message }, { status, headers: noStoreHeaders });
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.\- ]+/g, "_");
}
