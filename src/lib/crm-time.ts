import { CRM_TIME_ZONE } from "@/lib/crm-domain";

export class CrmDateInputError extends Error {
  constructor(message: string, public readonly code: "CRM_DATE_INVALID" | "CRM_TIME_NONEXISTENT" | "CRM_TIME_AMBIGUOUS" = "CRM_DATE_INVALID") { super(message); }
}
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function parts(value: Date) {
  const fields = dateFormatter.formatToParts(value);
  const read = (name: Intl.DateTimeFormatPartTypes) => Number(fields.find((field) => field.type === name)?.value);
  return [read("year"), read("month"), read("day"), read("hour"), read("minute"), read("second")];
}
function asUtc(values: number[], milliseconds = 0) {
  const value = new Date(0);
  value.setUTCFullYear(values[0], values[1] - 1, values[2]);
  value.setUTCHours(values[3] || 0, values[4] || 0, values[5] || 0, milliseconds);
  return value.getTime();
}
function invalid(): never { throw new CrmDateInputError("Data sau ora introdusă nu este validă."); }

/**
 * Date-only fields retain their UTC calendar representation. Unzoned datetime-local
 * values are Bucharest wall times. DST gaps and folds are rejected rather than guessed.
 * An explicit RFC3339 offset or Z identifies an unambiguous instant for integrations.
 */
export function crmParseDateInput(input: string): Date {
  const value = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return invalid();
  const values = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)];
  const milliseconds = Number((match[7] || "").padEnd(3, "0"));
  if (values[1] < 1 || values[1] > 12 || values[2] < 1 || values[2] > 31 || values[3] > 23 || values[4] > 59 || values[5] > 59) return invalid();
  const naive = asUtc(values, milliseconds), roundTrip = new Date(naive);
  if (roundTrip.getUTCFullYear() !== values[0] || roundTrip.getUTCMonth() + 1 !== values[1] || roundTrip.getUTCDate() !== values[2]) return invalid();
  if (!match[4]) return roundTrip;
  const offset = match[8];
  if (offset) {
    if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return invalid();
    const explicit = new Date(value);
    if (!Number.isFinite(explicit.getTime())) return invalid();
    return explicit;
  }
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const instant = naive + hours * 3600000;
    offsets.add(asUtc(parts(new Date(instant))) - Math.floor(instant / 1000) * 1000);
  }
  const candidates = [...offsets].map((offsetMs) => new Date(naive - offsetMs)).filter((candidate) => parts(candidate).every((part, index) => part === values[index]));
  if (!candidates.length) throw new CrmDateInputError("Ora aleasă nu există în București din cauza schimbării orei. Alege o altă oră.", "CRM_TIME_NONEXISTENT");
  if (candidates.length > 1) throw new CrmDateInputError("Ora aleasă apare de două ori în București la schimbarea orei. Alege o oră care nu este ambiguă.", "CRM_TIME_AMBIGUOUS");
  return candidates[0];
}

export function crmLocalDateTimeInput(value: Date) {
  if (!Number.isFinite(value.getTime())) return "";
  const [year, month, day, hour, minute] = parts(value);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
