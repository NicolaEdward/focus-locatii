import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DocumentAuditError } from "@/lib/document-source-domain";
import { documentAuditHeaders } from "@/lib/document-source-service";

export async function readDocumentAuditJson(request: NextRequest, maxBytes = 256 * 1024) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new DocumentAuditError("Cererea depășește limita permisă.", 413, "DOCUMENT_BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentAuditError("Conținut JSON necesar.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new DocumentAuditError("Cererea depășește limita permisă.", 413, "DOCUMENT_BODY_TOO_LARGE"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export function documentAuditFailure(error: unknown) {
  if (error instanceof DocumentAuditError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: documentAuditHeaders });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Datele documentului sau configurația nu sunt valide. Verifică valorile și dovezile obligatorii.", code: "DOCUMENT_INPUT_INVALID" }, { status: 400, headers: documentAuditHeaders });
  return NextResponse.json({ error: "Verificarea documentelor nu este disponibilă. Reîncarcă starea înainte de reîncercare.", code: "DOCUMENT_AUDIT_UNAVAILABLE" }, { status: 503, headers: documentAuditHeaders });
}
