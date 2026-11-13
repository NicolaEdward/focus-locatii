import sharp, { type Metadata } from "sharp";
import type { NextRequest } from "next/server";
import { safeOperationalProofFileName, validateOperationalProofFile } from "@/lib/operational-proof";
import { OPERATIONAL_PROOF_MAX_EDGE, OPERATIONAL_PROOF_MAX_PIXELS, OPERATIONAL_PROOF_REQUEST_MAX_BYTES, OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES, OperationalProofUploadError } from "@/lib/operational-proof-upload-limits";
const decodedMime: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function readOperationalProofForm(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new OperationalProofUploadError("Trimite fotografiile prin formularul de finalizare a lucrării.", 415);
  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > OPERATIONAL_PROOF_REQUEST_MAX_BYTES) throw payloadTooLarge();
  if (!request.body) throw new OperationalProofUploadError("Formularul cu fotografii lipsește.");
  const reader = request.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > OPERATIONAL_PROOF_REQUEST_MAX_BYTES) { await reader.cancel(); throw payloadTooLarge(); }
      chunks.push(new Uint8Array(next.value).buffer);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
  catch { throw new OperationalProofUploadError("Formularul cu fotografii nu poate fi citit. Reîncarcă lucrarea și selectează fotografiile din nou."); }
}

/** Decode actual bytes, cap decoded pixels and discard EXIF/GPS metadata. */
export async function prepareOperationalProofImage(file: File) {
  try { validateOperationalProofFile(file); }
  catch (error) { throw new OperationalProofUploadError(error instanceof Error ? error.message : "Fotografia nu este validă."); }
  const input = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try { metadata = await sharp(input, { limitInputPixels: OPERATIONAL_PROOF_MAX_PIXELS, failOn: "error" }).metadata(); }
  catch { throw new OperationalProofUploadError("Fotografia nu poate fi citită sau depășește 30 megapixeli. Folosește un JPG, PNG sau WebP valid."); }
  const actualMime = decodedMime[metadata.format || ""];
  if (!actualMime || actualMime !== file.type || (metadata.pages || 1) > 1) throw new OperationalProofUploadError("Fotografia trebuie să fie o imagine statică JPG, PNG sau WebP; fișierul nu corespunde formatului declarat.");
  let buffer: Buffer | null = null;
  try {
    for (const edge of [OPERATIONAL_PROOF_MAX_EDGE, 1600, 1280]) {
      buffer = await sharp(input, { limitInputPixels: OPERATIONAL_PROOF_MAX_PIXELS, failOn: "error" }).rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
      if (buffer.length <= OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES) break;
    }
  } catch { throw new OperationalProofUploadError("Fotografia este deteriorată și nu poate fi salvată. Încarcă o altă copie."); }
  if (!buffer || buffer.length > OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES) throw payloadTooLarge();
  return { fileName: safeOperationalProofFileName(file.name.replace(/\.[^.]*$/, "").slice(0, 180) + ".jpg"), fileType: "image/jpeg", fileSize: buffer.length, storageUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` };
}

function payloadTooLarge() { return new OperationalProofUploadError("Fotografiile depășesc limita de trimitere de 3,5 MB. Reîncearcă din aplicație pentru optimizare sau alege mai puține fotografii.", 413); }
