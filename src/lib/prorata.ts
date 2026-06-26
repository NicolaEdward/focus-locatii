type DateInput = Date | string;

export type ProrataSegment = {
  month: string;
  activeFrom: string;
  activeTo: string;
  activeDays: number;
  daysInMonth: number;
  amount: number;
};

export function calculateProrata(
  monthlyAmount: number,
  occupancyStart: DateInput,
  occupancyEnd: DateInput,
  reportStart: DateInput,
  reportEnd: DateInput
) {
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
    return { amount: 0, segments: [] as ProrataSegment[] };
  }

  const occupiedFrom = utcDay(occupancyStart);
  const occupiedTo = utcDay(occupancyEnd);
  const requestedFrom = utcDay(reportStart);
  const requestedTo = utcDay(reportEnd);
  if (!occupiedFrom || !occupiedTo || !requestedFrom || !requestedTo) {
    return { amount: 0, segments: [] as ProrataSegment[] };
  }
  if (occupiedFrom > occupiedTo || requestedFrom > requestedTo) {
    return { amount: 0, segments: [] as ProrataSegment[] };
  }

  const overlapFrom = maxDate(occupiedFrom, requestedFrom);
  const overlapTo = minDate(occupiedTo, requestedTo);
  if (overlapFrom > overlapTo) {
    return { amount: 0, segments: [] as ProrataSegment[] };
  }

  const segments: ProrataSegment[] = [];
  let monthCursor = firstDayOfMonth(overlapFrom);
  const finalMonth = firstDayOfMonth(overlapTo);

  while (monthCursor <= finalMonth) {
    const monthEnd = lastDayOfMonth(monthCursor);
    const activeFrom = maxDate(overlapFrom, monthCursor);
    const activeTo = minDate(overlapTo, monthEnd);
    const activeDays = daysInclusive(activeFrom, activeTo);
    const daysInMonth = monthEnd.getUTCDate();
    const amount = roundMoney((monthlyAmount * activeDays) / daysInMonth);

    segments.push({
      month: monthCursor.toISOString().slice(0, 7),
      activeFrom: activeFrom.toISOString().slice(0, 10),
      activeTo: activeTo.toISOString().slice(0, 10),
      activeDays,
      daysInMonth,
      amount
    });

    monthCursor = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1));
  }

  return {
    amount: roundMoney(segments.reduce((sum, segment) => sum + segment.amount, 0)),
    segments
  };
}

function utcDay(value: DateInput) {
  const date = value instanceof Date ? value : parseDateOnly(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === value.slice(0, 10) ? date : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstDayOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function lastDayOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

function daysInclusive(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function minDate(...values: Date[]) {
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function maxDate(...values: Date[]) {
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
