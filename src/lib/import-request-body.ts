import { InventoryImportError } from "@/lib/inventory-import";

// Route handlers are not covered by serverActions.bodySizeLimit. Bound the
// actual incoming bytes before parsing multipart/JSON bodies into memory.
export async function readImportRequestBody(request: Request, maximumBytes: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) throw new InventoryImportError("Cererea de import depășește limita permisă.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InventoryImportError("Lipsește corpul importului.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new InventoryImportError("Cererea de import depășește limita permisă.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
