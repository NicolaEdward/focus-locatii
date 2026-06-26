import slugify from "slugify";

export function money(value?: number | null, fallback?: string | null) {
  if (fallback && !value) return fallback;
  if (value == null || Number.isNaN(value)) return "La cerere";
  return new Intl.NumberFormat("ro-RO", {
    maximumFractionDigits: 0
  }).format(value);
}

export function moneyEur(value?: number | null, fallback?: string | null) {
  const formatted = money(value, fallback);
  return formatted === "La cerere" ? formatted : `${formatted} EUR`;
}

export function monthlyRate(value?: number | null, fallback?: string | null) {
  const formatted = moneyValue(value, fallback);
  return formatted === "La cerere" ? formatted : `${formatted} euro + TVA / luna`;
}

export function oneTimeRate(value?: number | null, fallback?: string | null) {
  const formatted = moneyValue(value, fallback);
  return formatted === "La cerere" ? formatted : `${formatted} euro + TVA`;
}

function moneyValue(value?: number | null, fallback?: string | null) {
  const parsedFallback = parseNumber(fallback);
  const amount = value ?? parsedFallback;
  if (amount == null || Number.isNaN(amount)) return fallback?.trim() || "La cerere";
  return new Intl.NumberFormat("ro-RO", {
    maximumFractionDigits: 0
  }).format(amount);
}

export function sqm(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(value)} sqm`;
}

export const MEDIA_TYPE_OPTIONS = ["Autocolant", "Mesh", "Panou", "Pasarela", "Pod", "Pasaj", "Blockout", "Prisma"] as const;

export type MediaType = (typeof MEDIA_TYPE_OPTIONS)[number];

export function normalizeMediaType(value?: string | null, ...context: Array<string | null | undefined>): MediaType | null {
  const source = [value, ...context].filter(Boolean).join(" ").toLowerCase();
  if (!source.trim()) return null;

  if (/(autocolant|sticker|vinyl|colant|door|base sticker|baza sticker)/.test(source)) return "Autocolant";
  if (/mesh/.test(source)) return "Mesh";
  if (/(prisma|prisme|trivision)/.test(source)) return "Prisma";
  if (/blockout/.test(source)) return "Blockout";
  if (/pasarela/.test(source)) return "Pasarela";
  if (/pasaj/.test(source)) return "Pasaj";
  if (/(pod|bridge|cfr)/.test(source)) return "Pod";
  if (/(panou|billboard|backlit|unipol|citylight|led|screen|display|totem|st[aâ]lp)/.test(source)) return "Panou";

  return "Panou";
}

export function makeSlug(value: string) {
  return slugify(value || "categorie", {
    lower: true,
    strict: true,
    locale: "ro"
  });
}

export function makeCode(categoryName: string, nr: string | number | null | undefined, rowIndex: number) {
  const cleanNr = String(nr || "").trim();
  if (cleanNr) return cleanNr.toUpperCase().replace(/\s+/g, "-");
  return `${makeSlug(categoryName).slice(0, 12)}-${rowIndex + 1}`.toUpperCase();
}

export function toBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["yes", "y", "da", "true", "1", "illuminated", "iluminat"].includes(text)) return true;
  if (["no", "n", "nu", "false", "0"].includes(text)) return false;
  return null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .match(/-?\d+(\.\d+)?/);
  if (!text) return null;
  const parsed = Number(text[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function arrayFromJson(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

export function statusLabel(status: string, availability?: string | null) {
  if (availability && status === "AVAILABLE_FROM") return availability;
  const labels: Record<string, string> = {
    AVAILABLE: "Disponibil",
    AVAILABLE_FROM: "Disponibil cu data",
    BOOKED: "Inchiriat",
    RESERVED: "Rezervat",
    UNKNOWN: "De verificat"
  };
  return labels[status] || "De verificat";
}

export function publicStatusLabel(status: string, availability?: string | null) {
  if (status === "AVAILABLE_FROM") return "Inchiriat";
  return statusLabel(status, availability);
}

export function isPublicRentedStatus(status?: string | null) {
  return status === "AVAILABLE_FROM" || status === "BOOKED";
}

export function statusFromAvailabilityText(status?: string | null, availability?: string | null) {
  const current = String(status || "").trim().toUpperCase();
  const text = String(availability || "").trim().toLowerCase();

  if (/(ocupat|booked|reserved|rezervat|indisponibil|suspendat|suspended)/.test(text)) return "BOOKED" as const;
  if (/(from|din|incepand|incep[aâ]nd|\d{1,2}[./-]\d{1,2})/.test(text)) return "AVAILABLE_FROM" as const;
  if (/(available|disponibil|liber)/.test(text)) return "AVAILABLE" as const;

  if (["AVAILABLE", "AVAILABLE_FROM", "BOOKED", "RESERVED", "UNKNOWN"].includes(current)) {
    return current as "AVAILABLE" | "AVAILABLE_FROM" | "BOOKED" | "RESERVED" | "UNKNOWN";
  }

  return "UNKNOWN" as const;
}
