export type EffectiveInstallationDate = {
  date: Date | null;
  source: "installationDate" | "periodStart" | null;
};

export function effectiveInstallationDate(input: {
  installationDate?: Date | string | null;
  periodStart?: Date | string | null;
}): EffectiveInstallationDate {
  const explicit = coerceDate(input.installationDate);
  if (explicit) return { date: explicit, source: "installationDate" };

  const fallback = coerceDate(input.periodStart);
  if (fallback) return { date: fallback, source: "periodStart" };

  return { date: null, source: null };
}

export function hasMissingInstallationSchedule(input: {
  installationDate?: Date | string | null;
  periodStart?: Date | string | null;
}) {
  return effectiveInstallationDate(input).date == null;
}

function coerceDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
