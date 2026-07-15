import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { evaluateDocumentAccess, resolveDocumentAccess } from "@/lib/client-document-access";
import { OPERATIONAL_PROOF_DOCUMENT_TYPE } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const maxFileSize = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;

  try {
    const form = await request.formData();
    const clientId = textValue(form.get("clientId"));
    const campaignId = textValue(form.get("campaignId"));
    const reservationId = textValue(form.get("reservationId"));
    const billingItemId = textValue(form.get("billingItemId"));
    const financialReceivableId = textValue(form.get("financialReceivableId"));
    const financialPayableId = textValue(form.get("financialPayableId"));
    const documentType = textValue(form.get("documentType")) || "other";
    const notes = textValue(form.get("notes"));
    const expiryDate = parseDate(textValue(form.get("expiryDate")));
    const url = textValue(form.get("storageUrl"));
    const file = form.get("file");

    if (!clientId && !campaignId && !reservationId && !billingItemId && !financialReceivableId && !financialPayableId) {
      return NextResponse.json({ error: "Leaga documentul de client, campanie sau factura." }, { status: 400, headers: noStoreHeaders });
    }
    if (documentType === OPERATIONAL_PROOF_DOCUMENT_TYPE) {
      return NextResponse.json({ error: "Pozele dovada se incarca numai din fluxul operational." }, { status: 400, headers: noStoreHeaders });
    }
    const accessError = evaluateDocumentAccess(
      session,
      await resolveDocumentAccess({ clientId, campaignId, reservationId, billingItemId, financialReceivableId, financialPayableId }),
      "manage"
    );
    if (accessError) {
      return NextResponse.json({ error: accessError.error }, { status: accessError.status, headers: noStoreHeaders });
    }

    const uploadedFile = file instanceof File ? file : null;
    if (!uploadedFile && !url) {
      return NextResponse.json({ error: "Alege un fisier sau introdu un link catre document." }, { status: 400, headers: noStoreHeaders });
    }
    if (uploadedFile && uploadedFile.size > maxFileSize) {
      return NextResponse.json({ error: "Fisierul depaseste limita de 5 MB." }, { status: 400, headers: noStoreHeaders });
    }

    const storageUrl = uploadedFile ? await fileToDataUrl(uploadedFile) : safeExternalDocumentUrl(url as string);
    const document = await prisma.clientDocument.create({
      data: {
        clientId,
        campaignId,
        reservationId,
        billingItemId,
        financialReceivableId,
        financialPayableId,
        fileName: uploadedFile?.name || textValue(form.get("fileName")) || "document",
        fileType: uploadedFile?.type || textValue(form.get("fileType")),
        fileSize: uploadedFile?.size || null,
        documentType,
        uploadedByUserId: session.id,
        expiryDate,
        notes,
        storageUrl,
        status: "active"
      }
    });

    await recordAudit({
      actor: session,
      action: "document.upload",
      entityType: "client_document",
      entityId: document.id,
      metadata: { clientId, campaignId, reservationId, billingItemId, financialReceivableId, financialPayableId, documentType, fileName: document.fileName },
      request
    });

    return NextResponse.json({
      document: {
        id: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        fileSize: document.fileSize,
        documentType: document.documentType,
        uploadedAt: document.uploadedAt.toISOString(),
        expiryDate: document.expiryDate?.toISOString() || null,
        status: document.status
      }
    }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Documentul nu a putut fi salvat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function textValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = file.type || "application/octet-stream";
  return `data:${type};base64,${buffer.toString("base64")}`;
}

function safeExternalDocumentUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Linkul documentului trebuie sa foloseasca HTTP sau HTTPS.");
  }
  return url.toString();
}
