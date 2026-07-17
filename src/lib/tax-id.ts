export function normalizeTaxId(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 80);
}

export function canonicalTaxId(value?: string | null) {
  const normalized = normalizeTaxId(value);
  return /^RO\d+$/.test(normalized) ? normalized.slice(2) : normalized;
}

export function isUsableTaxId(value?: string | null) {
  const canonical = canonicalTaxId(value);
  return canonical.length >= 2 && canonical.length <= 32;
}

export function taxIdsMatch(left?: string | null, right?: string | null) {
  const a = canonicalTaxId(left);
  const b = canonicalTaxId(right);
  return Boolean(a && b && a === b);
}

export function taxIdSearchValues(value?: string | null) {
  const normalized = normalizeTaxId(value);
  const canonical = canonicalTaxId(value);
  return [...new Set([normalized, canonical].filter((entry) => entry.length >= 2))];
}
