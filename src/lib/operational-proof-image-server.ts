import sharp from "sharp";
import {
  OPERATIONAL_PROOF_MAX_PIXELS,
  validateOperationalProofBuffer,
  validateOperationalProofFile
} from "@/lib/operational-proof";

export async function readAndValidateOperationalProofFile(file: File) {
  validateOperationalProofFile(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error("Fisierul incarcat este incomplet.");
  const decoded = await decodeAndValidateOperationalProofBuffer(bytes, file.type);
  return { bytes, ...decoded };
}

export async function decodeAndValidateOperationalProofBuffer(bytes: Buffer, declaredMimeType: string) {
  const decoded = validateOperationalProofBuffer(bytes, declaredMimeType);
  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: OPERATIONAL_PROOF_MAX_PIXELS,
      pages: 1,
      sequentialRead: true
    });
    const metadata = await image.metadata();
    const decodedMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format || "unknown"}`;
    if (
      decodedMime !== declaredMimeType ||
      metadata.width !== decoded.width ||
      metadata.height !== decoded.height
    ) {
      throw new Error("Image metadata mismatch");
    }
    // stats() forces libvips to decode pixel data instead of trusting container headers only.
    await image.stats();
    return decoded;
  } catch {
    throw new Error("Imaginea este corupta sau nu poate fi decodata in siguranta.");
  }
}
