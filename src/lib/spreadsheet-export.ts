const FORMULA_PREFIX = /^[\u0009\u0020\u00a0]*[=+\-@]/;

export function escapeSpreadsheetFormula(value: unknown) {
  if (typeof value !== "string" || !FORMULA_PREFIX.test(value)) return value;
  return `'${value}`;
}

export function sanitizeSpreadsheetRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const safe = Object.create(null) as T;
    for (const [key, value] of Object.entries(row)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      safe[key as keyof T] = escapeSpreadsheetFormula(value) as T[keyof T];
    }
    return safe;
  });
}
