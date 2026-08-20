export const companyEntities = [
  { value: "Focus Media", label: "Focus Media", code: "FOCUS_MEDIA", legalName: "FOCUS MEDIA OUTDOOR SRL", taxId: "40766474" },
  { value: "Excellence Media", label: "Excellence Media", code: "EXCELLENCE_MEDIA", legalName: "EXCELLENCE MEDIA PRODUCTION SRL", taxId: "29522177" },
  { value: "Focus BG / Focus Media LLC EOOD", label: "Focus BG / Focus Media LLC EOOD", code: "FOCUS_BG", legalName: "FOCUS MEDIA LLC EOOD", taxId: null }
] as const;

export type CompanyEntity = (typeof companyEntities)[number]["value"];

const aliases = new Map<string, CompanyEntity>([
  ["focus media", "Focus Media"],
  ["focus", "Focus Media"],
  ["focus media outdoor", "Focus Media"],
  ["focus media outdoor srl", "Focus Media"],
  ["excellence", "Excellence Media"],
  ["excellence media", "Excellence Media"],
  ["excellence media production", "Excellence Media"],
  ["excellence media production srl", "Excellence Media"],
  ["excellence media production s r l", "Excellence Media"],
  ["focus bg", "Focus BG / Focus Media LLC EOOD"],
  ["focus media llc eood", "Focus BG / Focus Media LLC EOOD"],
  ["focus bg / focus media llc eood", "Focus BG / Focus Media LLC EOOD"],
  ["focus media llc", "Focus BG / Focus Media LLC EOOD"]
]);

export function normalizeCompanyEntity(value?: string | null): CompanyEntity | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  const alias = aliases.get(lowered);
  if (alias) return alias;
  return companyEntities.find((entity) => entity.value.toLowerCase() === lowered)?.value || null;
}

export function companyEntityOrDefault(value?: string | null): CompanyEntity {
  return normalizeCompanyEntity(value) || "Focus Media";
}

export function companyEntityOrThrow(value?: string | null): CompanyEntity {
  const entity = normalizeCompanyEntity(value);
  if (!entity) {
    throw new Error("Firma contractanta trebuie aleasa din lista: Focus Media, Excellence Media sau Focus BG / Focus Media LLC EOOD.");
  }
  return entity;
}

export function companyCodeForEntity(value?: string | null) {
  const entity = normalizeCompanyEntity(value);
  return companyEntities.find((item) => item.value === entity)?.code || null;
}
