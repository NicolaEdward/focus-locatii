import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { evaluateDocumentAccess, linksFromDocument, resolveDocumentAccess } from "@/lib/client-document-access";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own"]);
  if (response || !session) return response;
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
        "content-type": document.fileType || match[1],
        "content-disposition": `attachment; filename="${sanitizeFileName(document.fileName)}"`
      }
    });
  }
  return NextResponse.redirect(document.storageUrl);
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;

  const existing = await prisma.clientDocument.findUnique({ where: { id } });
  if (!existing || existing.status === "archived") {
    return NextResponse.json({ error: "Documentul nu exista." }, { status: 404, headers: noStoreHeaders });
  }
  const accessError = evaluateDocumentAccess(session, await resolveDocumentAccess(linksFromDocument(existing)), "manage");
  if (accessError) {
    return NextResponse.json({ error: accessError.error }, { status: accessError.status, headers: noStoreHeaders });
  }

  const document = await prisma.clientDocument.update({
    where: { id },
    data: { status: "archived" }
  });
  await recordAudit({
    actor: session,
    action: "document.archive",
    entityType: "client_document",
    entityId: id,
    metadata: { fileName: document.fileName, clientId: document.clientId, reservationId: document.reservationId },
    request
  });

  return NextResponse.json({ document }, { headers: noStoreHeaders });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.\- ]+/g, "_");
}
