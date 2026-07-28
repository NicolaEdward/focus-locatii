import type { Prisma } from "@prisma/client";

export const CAMPAIGN_TIME_ZONE = "Europe/Bucharest";

export const CAMPAIGN_EFFECTIVE_STATUSES = [
  "INCOMPLETE",
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "ENDED",
  "CANCELLED",
  "ARCHIVED"
] as const;

export type CampaignEffectiveStatus = (typeof CAMPAIGN_EFFECTIVE_STATUSES)[number];

export type CampaignStatusDecision = {
  effectiveStatus: CampaignEffectiveStatus;
  lifecycleStatus: string;
  reason: "ARCHIVED" | "CANCELLED" | "COMPLETED" | "DRAFT" | "MISSING_DATES" | "INVALID_DATES" | "BEFORE_START" | "IN_RANGE" | "ACTIVE_BOOKED_PERIOD" | "AFTER_END";
  label: string;
  startDate: string | null;
  endDate: string | null;
  periodSource: "CAMPAIGN" | "BOOKED";
  today: string;
  timeZone: typeof CAMPAIGN_TIME_ZONE;
  endDateInclusive: true;
};

type CampaignBookingPeriodInput = {
  status?: string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
};

type CampaignStatusInput = {
  status?: string | null;
  archivedAt?: Date | string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  bookedPeriods?: CampaignBookingPeriodInput[] | null;
};

const labels: Record<CampaignEffectiveStatus, string> = {
  INCOMPLETE: "Incompleta",
  DRAFT: "Ciorna",
  SCHEDULED: "Programata",
  ACTIVE: "Activa",
  ENDED: "Incheiata",
  CANCELLED: "Anulata",
  ARCHIVED: "Arhivata"
};

export function deriveCampaignEffectiveStatus(input: CampaignStatusInput, now = new Date()): CampaignStatusDecision {
  const lifecycleStatus = String(input.status || "draft").trim().toLowerCase();
  const campaignStartDate = campaignDateKey(input.startDate);
  const campaignEndDate = campaignDateKey(input.endDate);
  const today = bucharestDateKey(now);
  const bookedPeriods = (input.bookedPeriods || [])
    .filter((period) => String(period.status || "").toUpperCase() === "BOOKED")
    .map((period) => ({ startDate: campaignDateKey(period.periodStart), endDate: campaignDateKey(period.periodEnd) }))
    .filter((period): period is { startDate: string; endDate: string } => Boolean(period.startDate && period.endDate));
  const bookedStart = minDateKey(bookedPeriods.map((period) => period.startDate));
  const bookedEnd = maxDateKey(bookedPeriods.map((period) => period.endDate));
  const startDate = bookedStart || campaignStartDate;
  const endDate = bookedEnd || campaignEndDate;
  const periodSource: CampaignStatusDecision["periodSource"] = bookedStart && bookedEnd ? "BOOKED" : "CAMPAIGN";

  if (input.archivedAt || lifecycleStatus === "archived") return decision("ARCHIVED", "ARCHIVED");
  if (lifecycleStatus === "cancelled") return decision("CANCELLED", "CANCELLED");
  if (lifecycleStatus === "completed") return decision("ENDED", "COMPLETED");
  if (lifecycleStatus === "draft") return decision("DRAFT", "DRAFT");
  if (!startDate || !endDate) return decision("INCOMPLETE", "MISSING_DATES");
  if (startDate > endDate) return decision("INCOMPLETE", "INVALID_DATES");
  if (today < startDate) return decision("SCHEDULED", "BEFORE_START");
  if (today > endDate) return decision("ENDED", "AFTER_END");
  return decision("ACTIVE", periodSource === "BOOKED" ? "ACTIVE_BOOKED_PERIOD" : "IN_RANGE");

  function decision(
    effectiveStatus: CampaignEffectiveStatus,
    reason: CampaignStatusDecision["reason"],
    decisionStartDate = startDate,
    decisionEndDate = endDate,
    decisionPeriodSource: CampaignStatusDecision["periodSource"] = periodSource
  ): CampaignStatusDecision {
    return {
      effectiveStatus,
      lifecycleStatus,
      reason,
      label: labels[effectiveStatus],
      startDate: decisionStartDate,
      endDate: decisionEndDate,
      periodSource: decisionPeriodSource,
      today,
      timeZone: CAMPAIGN_TIME_ZONE,
      endDateInclusive: true
    };
  }
}

export function campaignEffectiveStatusLabel(status: CampaignEffectiveStatus) {
  return labels[status];
}

export function isCampaignActive(input: CampaignStatusInput, now = new Date()) {
  return deriveCampaignEffectiveStatus(input, now).effectiveStatus === "ACTIVE";
}

export function activeCampaignBookingWhere(now = new Date()): Prisma.ReservationWhereInput {
  const today = dateKeyAsUtcDate(bucharestDateKey(now));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  return {
    status: "BOOKED",
    periodStart: { lt: tomorrow },
    periodEnd: { gte: today }
  };
}

export function campaignEffectiveStatusWhere(status: CampaignEffectiveStatus, now = new Date()): Prisma.CampaignWhereInput {
  const today = dateKeyAsUtcDate(bucharestDateKey(now));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const nonTerminal: Prisma.CampaignWhereInput = {
    archivedAt: null,
    status: { notIn: ["archived", "cancelled", "completed", "draft"] }
  };
  const activeBooking: Prisma.CampaignWhereInput = {
    reservations: { some: activeCampaignBookingWhere(now) }
  };
  const campaignPeriodActive: Prisma.CampaignWhereInput = {
    startDate: { lt: tomorrow },
    endDate: { gte: today }
  };

  switch (status) {
    case "ARCHIVED":
      return { OR: [{ archivedAt: { not: null } }, { status: "archived" }] };
    case "CANCELLED":
      return { archivedAt: null, status: "cancelled" };
    case "DRAFT":
      return { archivedAt: null, status: "draft" };
    case "SCHEDULED":
      return {
        AND: [
          nonTerminal,
          { NOT: activeBooking },
          { startDate: { gte: tomorrow }, endDate: { not: null } }
        ]
      };
    case "ACTIVE":
      return { ...nonTerminal, OR: [campaignPeriodActive, activeBooking] };
    case "ENDED":
      return {
        archivedAt: null,
        OR: [
          { status: "completed" },
          {
            AND: [
              { status: { notIn: ["archived", "cancelled", "draft"] } },
              { NOT: activeBooking },
              { endDate: { lt: today } }
            ]
          }
        ]
      };
    case "INCOMPLETE":
      return {
        AND: [
          nonTerminal,
          { NOT: activeBooking },
          { OR: [{ startDate: null }, { endDate: null }] }
        ]
      };
  }
}

export function bucharestDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMPAIGN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function campaignDateKey(value?: Date | string | null) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dateKeyAsUtcDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function minDateKey(values: string[]) {
  return values.length ? values.reduce((minimum, value) => value < minimum ? value : minimum) : null;
}

function maxDateKey(values: string[]) {
  return values.length ? values.reduce((maximum, value) => value > maximum ? value : maximum) : null;
}
