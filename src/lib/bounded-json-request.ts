export class JsonRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Bound bytes while streaming, including requests without Content-Length. */
export async function readBoundedJson(request: Request, maximumBytes = 4096): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new JsonRequestError("Cererea trebuie trimisă în format JSON.", 415);
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) throw new JsonRequestError("Cererea este prea mare.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new JsonRequestError("Lipsește corpul cererii.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new JsonRequestError("Cererea este prea mare.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new JsonRequestError("Cererea JSON nu este validă.", 400); }
}
