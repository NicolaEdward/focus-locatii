import { NextRequest, NextResponse } from "next/server";
import { readImportRequestBody } from "@/lib/import-request-body";
import { requirePermission } from "@/lib/auth";
import { confirmInventoryImport, inventoryOptions, inventoryPayloadHash, InventoryImportError, MAX_ATOMIC_INVENTORY_ROWS, previewInventoryImport } from "@/lib/inventory-import";

export const maxDuration = 120;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_JSON_NODES = 50_000;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) {
    if (response) response.headers.set("Cache-Control", noStoreHeaders["Cache-Control"]);
    return response;
  }
  try {
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") throw new InventoryImportError("Importul trebuie trimis ca application/json.", 415);
    const rawBody = await readImportRequestBody(request, MAX_JSON_BYTES);
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody.toString("utf8")); } catch { throw new InventoryImportError("Fișierul JSON nu este valid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InventoryImportError("Importul JSON trebuie să conțină un obiect cu lista locations.");
    validateJsonShape(body);
    const locations = Array.isArray(body?.locations) ? body.locations : [];
    if (locations.length > MAX_ATOMIC_INVENTORY_ROWS) throw new InventoryImportError(`Importul JSON este limitat la ${MAX_ATOMIC_INVENTORY_ROWS} de locații per lot atomic.`, 413);
    const rows = locations.map((location: unknown) => {
      if (!location || typeof location !== "object" || Array.isArray(location)) throw new InventoryImportError("Rândul de inventar este invalid.");
      const data = location as Record<string, unknown>;
      return { code: String(data.code || "").trim(), categoryName: String(data.categoryName || "").trim(), data };
    });
    const options = inventoryOptions(body.options);
    const input = { rows, payloadHash: inventoryPayloadHash(JSON.stringify({ locations, options })), actor: session, options };
    if (body.action !== "confirm") return NextResponse.json({ preview: await previewInventoryImport(input) }, { headers: noStoreHeaders });
    if (typeof body.previewToken !== "string") throw new InventoryImportError("Verifică preview-ul înainte de confirmare.", 409);
    const summary = await confirmInventoryImport({ ...input, fileName: "inventory.json", previewToken: body.previewToken });
    return NextResponse.json({ summary, created: summary.createdCount, updated: summary.updatedCount, total: summary.totalRows }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof InventoryImportError ? error.message : "Importul este temporar indisponibil. Verifică rezultatul aceleiași încercări înainte de un import nou." }, { status: error instanceof InventoryImportError ? error.status : 503, headers: noStoreHeaders });
  }
}

function validateJsonShape(value: unknown) {
  let nodes = 0;
  const visit = (current: unknown, depth: number) => {
    if (++nodes > MAX_JSON_NODES) throw new InventoryImportError("Importul JSON este prea complex.");
    if (depth > 12) throw new InventoryImportError("Importul JSON depășește adâncimea maximă permisă.");
    if (!current || typeof current !== "object") return;
    for (const key of Object.keys(current)) {
      if (UNSAFE_KEYS.has(key.toLowerCase())) throw new InventoryImportError("Importul JSON conține o cheie nesigură.");
      visit((current as Record<string, unknown>)[key], depth + 1);
    }
  };
  visit(value, 0);
}
