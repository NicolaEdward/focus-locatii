"use client";

import { OPERATIONAL_PROOF_MAX_FILES_PER_TASK, validateOperationalProofFile } from "@/lib/operational-proof";
import { OPERATIONAL_PROOF_MAX_EDGE, OPERATIONAL_PROOF_MAX_PIXELS, OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES, OPERATIONAL_PROOF_UPLOAD_MAX_BYTES } from "@/lib/operational-proof-upload-limits";

/** Optimize sequentially to keep mobile memory bounded, before the API call. */
export async function prepareOperationalProofUpload(files: readonly File[]): Promise<File[]> {
  if (files.length > OPERATIONAL_PROOF_MAX_FILES_PER_TASK) throw new Error("Alege maximum 10 fotografii pentru aceeași lucrare.");
  const target = Math.min(OPERATIONAL_PROOF_OPTIMIZED_FILE_BYTES, Math.floor(OPERATIONAL_PROOF_UPLOAD_MAX_BYTES / Math.max(files.length, 1)));
  const optimized: File[] = [];
  for (const file of files) {
    validateOperationalProofFile(file);
    const image = await decode(file);
    try {
      if (!image.width || !image.height || image.width * image.height > OPERATIONAL_PROOF_MAX_PIXELS) throw new Error("Fotografia are o rezoluție prea mare. Alege o copie de maximum 30 megapixeli.");
      let result: Blob | null = null;
      for (const edge of [OPERATIONAL_PROOF_MAX_EDGE, 1600, 1280]) {
        const ratio = Math.min(1, edge / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Browserul nu poate pregăti fotografia. Încearcă un browser actualizat.");
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
        for (const quality of [.84, .72, .60]) {
          result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Fotografia nu poate fi optimizată.")), "image/jpeg", quality));
          if (result.size <= target) break;
        }
        canvas.width = 1; canvas.height = 1;
        if (result && result.size <= target) break;
      }
      if (!result || result.size > target) throw new Error("Fotografiile sunt prea mari pentru o singură trimitere. Alege mai puține fotografii sau copii cu rezoluție mai mică.");
      optimized.push(new File([result], `${file.name.replace(/\.[^.]*$/, "") || "dovada"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified }));
    } finally { image.dispose(); }
  }
  if (optimized.reduce((sum, file) => sum + file.size, 0) > OPERATIONAL_PROOF_UPLOAD_MAX_BYTES) throw new Error("Fotografiile depășesc limita totală de 3,5 MB. Alege mai puține fotografii.");
  return optimized;
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    }
    const url = URL.createObjectURL(file);
    try {
      const element = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Fotografia nu este o imagine validă.")); img.src = url; });
      return { source: element, width: element.naturalWidth, height: element.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  } catch { throw new Error("Fotografia nu poate fi citită. Folosește un fișier JPG, PNG sau WebP valid."); }
}
