export type EffectiveNeutralizationDate = {
  date: Date | null;
  source: "neutralizationDate" | "periodEnd" | null;
};

export function effectiveNeutralizationDate(input: {
  neutralizationDate?: Date | string | null;
  periodEnd?: Date | string | null;
}): EffectiveNeutralizationDate {
  const explicit = coerceDate(input.neutralizationDate);
  if (explicit) return { date: explicit, source: "neutralizationDate" };

  const fallback = coerceDate(input.periodEnd);
  if (fallback) return { date: fallback, source: "periodEnd" };

  return { date: null, source: null };
}

export function hasMissingNeutralizationSchedule(input: {
  neutralizationDate?: Date | string | null;
  periodEnd?: Date | string | null;
}) {
  return effectiveNeutralizationDate(input).date == null;
}

function coerceDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
