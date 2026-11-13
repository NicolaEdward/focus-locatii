/** Shared classification; digital inventory never implies physical installation. */
export function isDigitalLocationType(type?: string | null) {
  return /\b(dooh|digital|led|ecrane?|screen|lcd|display)\b/i.test(String(type || ""));
}
