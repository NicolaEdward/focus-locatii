import { EXECUTIVE_TIME_ZONE } from "@/lib/dashboard/executive/contracts";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: EXECUTIVE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EXECUTIVE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function bucharestBusinessDateKey(value = new Date()) {
  return dateKeyFormatter.format(value);
}

export function validDateKey(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? fallback : text;
}

export function addDateKeyDays(key: string, days: number) {
  const value = new Date(`${key}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dateKeyAsStorageDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export function bucharestDayBounds(key: string) {
  return {
    start: zonedMidnightUtc(key),
    endExclusive: zonedMidnightUtc(addDateKeyDays(key, 1))
  };
}

export function currentMonthPeriod(snapshotKey: string) {
  const [year, month] = snapshotKey.split("-").map(Number);
  const start = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const end = addDateKeyDays(nextMonth.toISOString().slice(0, 10), -1);
  return { start, end };
}

export function previousEquivalentPeriod(start: string, end: string) {
  const durationDays = Math.max(1, daysBetween(start, end) + 1);
  const comparisonEnd = addDateKeyDays(start, -1);
  return {
    start: addDateKeyDays(comparisonEnd, -(durationDays - 1)),
    end: comparisonEnd
  };
}

export function daysBetween(from: string, to: string) {
  return Math.round((dateKeyAsStorageDate(to).getTime() - dateKeyAsStorageDate(from).getTime()) / 86_400_000);
}

function zonedMidnightUtc(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  for (let index = 0; index < 3; index += 1) {
    candidate = new Date(wallClockUtc - timeZoneOffsetMs(candidate));
  }
  return candidate;
}

function timeZoneOffsetMs(value: Date) {
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - value.getTime();
}
