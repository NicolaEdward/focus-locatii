export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_TIMEOUT_MS = 10_000;

export class PassiveImageError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function passiveImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { mime: "image/gif", extension: "gif" };
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

// Count actual bytes, not the optional and attacker-controlled Content-Length.
export async function readLimitedPhoto(response: Response, maxBytes = PHOTO_MAX_BYTES): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw new PassiveImageError("Imaginea depășește limita de 15 MB.", 413);
  }
  if (!response.body) throw new PassiveImageError("Imagine indisponibilă.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PassiveImageError("Imaginea depășește limita de 15 MB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
