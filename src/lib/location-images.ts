export const PRODUCTION_SKETCH_ALT = "PRODUCTION_SKETCH";

export function isProductionSketchImage(image: { alt?: string | null }) {
  return String(image.alt || "").trim().toUpperCase() === PRODUCTION_SKETCH_ALT;
}
