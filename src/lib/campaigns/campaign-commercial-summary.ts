import { Prisma, type PrismaClient } from "@prisma/client";
import { calculateProrata } from "@/lib/prorata";

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
  const monthlyGroups = new Map<string, { monthlyRent: Prisma.Decimal; currency: "RON" | "EUR"; periodStart: Date; periodEnd: Date }>();

  for (const reservation of booked) {
    const monthlyRent = canonicalMonthlyRent(reservation);
    const currency = canonicalCurrency(reservation.currency);
    if (!currency) {
      dataQualityReasons.add("BOOKED_CURRENCY_MISSING");
      continue;
    }
    if (monthlyRent == null || monthlyRent <= 0) {
      dataQualityReasons.add("BOOKED_MONTHLY_RENT_MISSING");
      continue;
    }
    // Prorate a shared contractual period once, after summing persisted row
    // shares. Rounding each face first can create a cent on partial months.
    const key = `${reservation.contractGroupId || `single:${monthlyGroups.size}`}|${currency}|${reservation.periodStart.toISOString()}|${reservation.periodEnd.toISOString()}`;
    const group = monthlyGroups.get(key);
    if (group) group.monthlyRent = group.monthlyRent.plus(monthlyRent);
    else monthlyGroups.set(key, { monthlyRent: new Prisma.Decimal(monthlyRent), currency, periodStart: reservation.periodStart, periodEnd: reservation.periodEnd });
  }
  for (const group of monthlyGroups.values()) {
    const prorata = calculateProrata(group.monthlyRent.toNumber(), group.periodStart, group.periodEnd, group.periodStart, group.periodEnd);
    totals[group.currency] = totals[group.currency].plus(prorata.amount);
  }

  const currencies = (["RON", "EUR"] as const).filter((currency) => totals[currency].gt(0));
  if (currencies.length > 1) dataQualityReasons.add("MIXED_CAMPAIGN_CURRENCIES");
  const hasIncompleteCommercialData = dataQualityReasons.has("BOOKED_CURRENCY_MISSING")
    || dataQualityReasons.has("BOOKED_MONTHLY_RENT_MISSING");

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
          currency: true
        }
      }
    }
  });
  if (!campaign) return null;

  const summary = deriveCampaignCommercialSummary(campaign.reservations);
  await client.campaign.update({
    where: { id: campaignId },
    data: {
      startDate: summary.periodStart,
      endDate: summary.periodEnd,
      currency: summary.currency,
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
