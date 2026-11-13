import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { confirmExcelImport, previewExcelImport } from "@/lib/import-excel";
import { InventoryImportError, inventoryOptions } from "@/lib/inventory-import";
import { SpreadsheetSecurityError } from "@/lib/secure-spreadsheet";
import { readImportRequestBody } from "@/lib/import-request-body";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 120;
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const correlationId = requestCorrelationId(request);
  const startedAt = performance.now();
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) {
    if (response) response.headers.set("Cache-Control", noStoreHeaders["Cache-Control"]);
    return response;
  }
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new InventoryImportError("Importul Excel trebuie trimis ca formular multipart.", 415);
    const bytes = await readImportRequestBody(request, 21 * 1024 * 1024);
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(bytes).buffer }).formData(); }
    catch { throw new InventoryImportError("Formularul de import nu este valid."); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new InventoryImportError("Lipsește fișierul Excel.");
    if (file.size > 20 * 1024 * 1024) throw new InventoryImportError("Fișierul depășește limita de 20 MB.", 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    const options = inventoryOptions({ publishNewLocations: form.get("publishNewLocations") === "true", overrideManagedFields: form.get("overrideManagedFields") === "true" });
    const input = { buffer, fileName: file.name, mimeType: file.type, signal: request.signal, actor: session, options };
    if (form.get("action") !== "confirm") {
      return NextResponse.json({ preview: await previewExcelImport(input) }, { headers: noStoreHeaders });
    }
    const previewToken = form.get("previewToken");
    if (typeof previewToken !== "string") throw new InventoryImportError("Verifică preview-ul înainte de confirmare.", 409);
    const summary = await confirmExcelImport({ ...input, previewToken });
    emitStructuredLog("info", "spreadsheet_import_confirm_completed", {
      correlationId,
      operation: "inventory.import",
      entityType: "import_batch",
      entityId: summary.batchId,
      role: session?.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: "success",
      metrics: { fileBytes: file.size, rowCount: summary.totalRows }
    });
    return NextResponse.json({ summary }, { headers: noStoreHeaders });
  } catch (error) {
    emitStructuredLog("warn", "spreadsheet_import_failed", {
      correlationId,
      operation: "inventory.import",
      role: session?.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: error instanceof SpreadsheetSecurityError || error instanceof InventoryImportError ? error.status : 503,
      errorCode: safeErrorCode(error, "INVENTORY_IMPORT_FAILED")
    });
    return NextResponse.json(
      { error: error instanceof SpreadsheetSecurityError || error instanceof InventoryImportError ? error.message : "Importul este temporar indisponibil. Verifică rezultatul aceleiași încercări înainte de un import nou." },
      { status: error instanceof SpreadsheetSecurityError || error instanceof InventoryImportError ? error.status : 503, headers: noStoreHeaders }
    );
  }
}
