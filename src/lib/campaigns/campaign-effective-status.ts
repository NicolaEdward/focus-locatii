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
  reason: "ARCHIVED" | "CANCELLED" | "COMPLETED" | "DRAFT" | "MISSING_DATES" | "INVALID_DATES" | "BEFORE_START" | "IN_RANGE" | "AFTER_END";
  label: string;
  startDate: string | null;
  endDate: string | null;
  today: string;
  timeZone: typeof CAMPAIGN_TIME_ZONE;
  endDateInclusive: true;
};

type CampaignStatusInput = {
  status?: string | null;
  archivedAt?: Date | string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
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
  const startDate = campaignDateKey(input.startDate);
  const endDate = campaignDateKey(input.endDate);
  const today = bucharestDateKey(now);

  if (input.archivedAt || lifecycleStatus === "archived") return decision("ARCHIVED", "ARCHIVED");
  if (lifecycleStatus === "cancelled") return decision("CANCELLED", "CANCELLED");
  if (lifecycleStatus === "completed") return decision("ENDED", "COMPLETED");
  if (lifecycleStatus === "draft") return decision("DRAFT", "DRAFT");
  if (!startDate || !endDate) return decision("INCOMPLETE", "MISSING_DATES");
  if (startDate > endDate) return decision("INCOMPLETE", "INVALID_DATES");
  if (today < startDate) return decision("SCHEDULED", "BEFORE_START");
  if (today > endDate) return decision("ENDED", "AFTER_END");
  return decision("ACTIVE", "IN_RANGE");

  function decision(effectiveStatus: CampaignEffectiveStatus, reason: CampaignStatusDecision["reason"]): CampaignStatusDecision {
    return {
      effectiveStatus,
      lifecycleStatus,
      reason,
      label: labels[effectiveStatus],
      startDate,
      endDate,
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

export function campaignEffectiveStatusWhere(status: CampaignEffectiveStatus, now = new Date()): Prisma.CampaignWhereInput {
  const today = dateKeyAsUtcDate(bucharestDateKey(now));
  const nonTerminal: Prisma.CampaignWhereInput = {
    archivedAt: null,
    status: { notIn: ["archived", "cancelled", "completed", "draft"] }
  };

  switch (status) {
    case "ARCHIVED":
      return { OR: [{ archivedAt: { not: null } }, { status: "archived" }] };
    case "CANCELLED":
      return { archivedAt: null, status: "cancelled" };
    case "DRAFT":
      return { archivedAt: null, status: "draft" };
    case "SCHEDULED":
      return { ...nonTerminal, startDate: { gt: today }, endDate: { not: null } };
    case "ACTIVE":
      return { ...nonTerminal, startDate: { lte: today }, endDate: { gte: today } };
    case "ENDED":
      return {
        archivedAt: null,
        OR: [
          { status: "completed" },
          { status: { notIn: ["archived", "cancelled", "draft"] }, endDate: { lt: today } }
        ]
      };
    case "INCOMPLETE":
      return {
        ...nonTerminal,
        OR: [{ startDate: null }, { endDate: null }]
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
