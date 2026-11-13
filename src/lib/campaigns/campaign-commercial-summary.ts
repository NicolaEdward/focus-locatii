import { Prisma, type PrismaClient } from "@prisma/client";
import { amountForPriceIntervals, combinePriceIntervals, getValidatedPriceIntervals, type RentalPriceSegmentInput, type PriceInterval } from "@/lib/segmented-billing";

export const CAMPAIGN_COMMERCIAL_SUMMARY_SOURCE = "BOOKED_RESERVATIONS" as const;

type CampaignDbClient = PrismaClient | Prisma.TransactionClient;

export type CampaignCommercialReservation = {
  status: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  amount?: number | null;
  monthlyRentShare?: number | null;
  monthlyRentTotal?: number | null;
  contractGroupId?: string | null;
  currency?: string | null;
  priceSegments?: RentalPriceSegmentInput[];
};

export type CampaignCommercialSummary = {
  source: typeof CAMPAIGN_COMMERCIAL_SUMMARY_SOURCE;
  periodStart: Date | null;
  periodEnd: Date | null;
  bookedReservationCount: number;
  totalsByCurrency: {
    RON: number;
    EUR: number;
  };
  currency: "RON" | "EUR" | null;
  totalContractValue: number | null;
  dataQualityReasons: string[];
};

export function deriveCampaignCommercialSummary(
  reservations: CampaignCommercialReservation[]
): CampaignCommercialSummary {
  const booked = reservations
    .filter((reservation) => reservation.status === "BOOKED")
    .map((reservation) => ({
      ...reservation,
      periodStart: toDate(reservation.periodStart),
      periodEnd: toDate(reservation.periodEnd)
    }))
    .filter((reservation): reservation is typeof reservation & { periodStart: Date; periodEnd: Date } =>
      Boolean(reservation.periodStart && reservation.periodEnd && reservation.periodStart <= reservation.periodEnd)
    );

  const totals = { RON: new Prisma.Decimal(0), EUR: new Prisma.Decimal(0) };
  const dataQualityReasons = new Set<string>();
  const monthlyGroups = new Map<string, PriceInterval[][]>();

  for (const [index, reservation] of booked.entries()) {
    const monthlyRent = canonicalMonthlyRent(reservation);
    const currency = canonicalCurrency(reservation.currency);
    if (!currency) {
      dataQualityReasons.add("BOOKED_CURRENCY_MISSING");
      continue;
    }
    if (!reservation.priceSegments?.length && (monthlyRent == null || monthlyRent <= 0)) {
      dataQualityReasons.add("BOOKED_MONTHLY_RENT_MISSING");
      continue;
    }
    const schedule = getValidatedPriceIntervals({
      periodStart: reservation.periodStart,
      periodEnd: reservation.periodEnd,
      monthlyAmount: monthlyRent || 0,
      currency,
    }, reservation.priceSegments);
    if (!schedule.valid) {
      for (const reason of schedule.reasons) dataQualityReasons.add(reason);
      continue;
    }
    // Shares can change on different dates per face. Sum their interval schedules
    // before rounding the aggregate once for each contractual calendar month.
    const key = `${reservation.contractGroupId || `single:${index}`}|${currency}`;
    const group = monthlyGroups.get(key) || [];
    group.push(schedule.intervals);
    monthlyGroups.set(key, group);
  }
  for (const schedules of monthlyGroups.values()) {
    const combined = combinePriceIntervals(schedules);
    if (!combined.length) continue;
    const amount = amountForPriceIntervals(combined, combined[0].periodStart, combined[combined.length - 1].periodEnd);
    totals[combined[0].currency] = totals[combined[0].currency].plus(amount);
  }

  const currencies = (["RON", "EUR"] as const).filter((currency) => totals[currency].gt(0));
  if (currencies.length > 1) dataQualityReasons.add("MIXED_CAMPAIGN_CURRENCIES");
  const hasIncompleteCommercialData = dataQualityReasons.size > 0;

  return {
    source: CAMPAIGN_COMMERCIAL_SUMMARY_SOURCE,
    periodStart: booked.length
      ? new Date(Math.min(...booked.map((reservation) => reservation.periodStart.getTime())))
      : null,
    periodEnd: booked.length
      ? new Date(Math.max(...booked.map((reservation) => reservation.periodEnd.getTime())))
      : null,
    bookedReservationCount: booked.length,
    totalsByCurrency: {
      RON: totals.RON.toDecimalPlaces(2).toNumber(),
      EUR: totals.EUR.toDecimalPlaces(2).toNumber()
    },
    currency: currencies.length === 1 ? currencies[0] : null,
    totalContractValue: currencies.length === 1 && !hasIncompleteCommercialData
      ? totals[currencies[0]].toDecimalPlaces(2).toNumber()
      : null,
    dataQualityReasons: [...dataQualityReasons]
  };
}

export async function syncCampaignCommercialSummary(
  client: CampaignDbClient,
  campaignId: string
) {
  // Reservation writes can touch different locations concurrently, so serialize
  // the derived campaign snapshot before reading all BOOKED rows.
  await client.$queryRaw(Prisma.sql`
    SELECT id
    FROM portfolio_campaigns
    WHERE id = ${campaignId}
    FOR UPDATE
  `);
  const campaign = await client.campaign.findUnique({
    where: { id: campaignId },
    select: {
      currency: true,
      status: true,
      startDate: true,
      endDate: true,
      reservations: {
        where: { status: "BOOKED" },
        select: {
          status: true,
          periodStart: true,
          periodEnd: true,
          amount: true,
          monthlyRentShare: true,
          monthlyRentTotal: true,
          contractGroupId: true,
          currency: true,
          priceSegments: { select: { effectiveFrom: true, effectiveTo: true, monthlyRent: true, currency: true }, orderBy: { effectiveFrom: "asc" } }
        }
      }
    }
  });
  if (!campaign) return null;

  const summary = deriveCampaignCommercialSummary(campaign.reservations);
  await client.campaign.update({
    where: { id: campaignId },
    data: {
      startDate: summary.bookedReservationCount || campaign.status !== "draft" ? summary.periodStart : campaign.startDate,
      endDate: summary.bookedReservationCount || campaign.status !== "draft" ? summary.periodEnd : campaign.endDate,
      // A proposal currency is not a booked value. Keep the explicit choice
      // before the first BOOKED; otherwise use only the canonical booked unit.
      currency: summary.bookedReservationCount ? summary.currency : canonicalCurrency(campaign.currency),
      totalContractValue: summary.totalContractValue == null
        ? null
        : new Prisma.Decimal(summary.totalContractValue)
    }
  });
  return summary;
}

function canonicalMonthlyRent(reservation: CampaignCommercialReservation) {
  const value = reservation.amount
    ?? reservation.monthlyRentShare
    ?? (reservation.contractGroupId ? null : reservation.monthlyRentTotal);
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function canonicalCurrency(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "RON" || normalized === "EUR" ? normalized : null;
}

function toDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
