import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isDigitalLocationType } from "@/lib/location-medium";

export class CommercialError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const commercialManagerRoles = new Set([
  "SUPER_ADMIN",
  "COO",
  "SALES_DIRECTOR",
]);
export const agentToolScopes = [
  "inventory.search",
  "availability.check",
  "opportunity.read",
  "quote.draft",
  "approval.request",
  "hold.execute",
  "receipt.read",
] as const;
export type AgentToolScope = (typeof agentToolScopes)[number];
export const COMMERCIAL_POLICY_VERSION = "commercial-tools-v1";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(object[key]))
      .join(",") +
    "}"
  );
}
export function commercialHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function normalizeRecipient(value: string) {
  return value.trim().toLowerCase();
}

export function dateOnly(value: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T00:00:00.000Z")
    : new Date(NaN);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new CommercialError(
      "INVALID_DATE",
      "Data trebuie să fie o zi validă YYYY-MM-DD.",
    );
  return parsed;
}
export function checkedPeriod(start: string, end: string) {
  const from = dateOnly(start),
    to = dateOnly(end);
  if (to < from || to.getTime() - from.getTime() > 1096 * 86_400_000)
    throw new CommercialError(
      "INVALID_PERIOD",
      "Perioada trebuie să fie ordonată și de cel mult trei ani.",
    );
  return { from, to };
}
export function validatedTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("ro-RO", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new CommercialError("INVALID_TIMEZONE", "Fus orar invalid.");
  }
}
export const isDigitalFormat = isDigitalLocationType;

// Deterministic money: integer decimal input and Decimal arithmetic; inclusive
// calendar days are shared with the documented OOH commercial convention.
export function quoteMoney(
  monthly: string,
  from: Date,
  to: Date,
  vatRateBps: number,
  vatTreatment: string,
) {
  if (
    !/^\d{1,10}(?:\.\d{1,2})?$/.test(monthly) ||
    new Prisma.Decimal(monthly).lte(0)
  )
    throw new CommercialError(
      "INVALID_PRICE",
      "Prețul lunar trebuie să fie pozitiv, cu maximum două zecimale.",
    );
  let sum = new Prisma.Decimal(0);
  for (
    let cursor = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
    );
    cursor <= to;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    const end = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    );
    const a = Math.max(from.getTime(), cursor.getTime()),
      b = Math.min(to.getTime(), end.getTime());
    const days = Math.floor((b - a) / 86_400_000) + 1;
    sum = sum.plus(
      new Prisma.Decimal(monthly)
        .mul(days)
        .div(end.getUTCDate())
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    );
  }
  const rate = new Prisma.Decimal(vatRateBps).div(10_000);
  const net =
    vatTreatment === "inclusive"
      ? sum.div(rate.plus(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : sum;
  const tax =
    vatTreatment === "exempt"
      ? new Prisma.Decimal(0)
      : vatTreatment === "inclusive"
        ? sum.minus(net)
        : net.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    net: net.toFixed(2),
    tax: tax.toFixed(2),
    gross: net.plus(tax).toFixed(2),
  };
}

export function assertUsableApproval(
  approval: {
    state: string;
    expiresAt: Date;
    consumedAt: Date | null;
    payloadHash: string;
    recipientHash: string | null;
    principalId: string | null;
    action: string;
  },
  expected: {
    payloadHash: string;
    recipientHash: string | null;
    principalId?: string | null;
    action: string;
  },
  now = new Date(),
) {
  if (
    approval.state !== "approved" ||
    approval.consumedAt ||
    approval.expiresAt <= now ||
    approval.payloadHash !== expected.payloadHash ||
    approval.recipientHash !== expected.recipientHash ||
    approval.action !== expected.action ||
    approval.principalId !== (expected.principalId ?? null)
  ) {
    throw new CommercialError(
      "APPROVAL_INVALID",
      "Aprobarea lipsește, a expirat, a fost folosită sau nu corespunde exact acțiunii.",
      409,
    );
  }
}

export function remainingDoohCapacity(
  bookings: {
    shareBps: number;
    periodStart: Date;
    periodEnd: Date;
    daypartStartMinute: number;
    daypartEndMinute: number;
  }[],
  input: {
    periodStart: Date;
    periodEnd: Date;
    daypartStartMinute: number;
    daypartEndMinute: number;
  },
) {
  // Evaluate every event boundary in time and local daypart. Summing every row
  // would incorrectly reject bookings whose occupied subwindows are disjoint.
  const times = [
    ...new Set([
      input.periodStart.getTime(),
      ...bookings.flatMap((b) => [
        Math.max(input.periodStart.getTime(), b.periodStart.getTime()),
        Math.min(input.periodEnd.getTime(), b.periodEnd.getTime()),
      ]),
    ]),
  ].filter(
    (x) => x >= input.periodStart.getTime() && x < input.periodEnd.getTime(),
  );
  const minutes = [
    ...new Set([
      input.daypartStartMinute,
      ...bookings.flatMap((b) => [
        Math.max(input.daypartStartMinute, b.daypartStartMinute),
        Math.min(input.daypartEndMinute, b.daypartEndMinute),
      ]),
    ]),
  ].filter((x) => x >= input.daypartStartMinute && x < input.daypartEndMinute);
  let peak = 0;
  for (const t of times)
    for (const minute of minutes) {
      const used = bookings
        .filter(
          (b) =>
            b.periodStart.getTime() <= t &&
            b.periodEnd.getTime() > t &&
            b.daypartStartMinute <= minute &&
            b.daypartEndMinute > minute,
        )
        .reduce((s, b) => s + b.shareBps, 0);
      peak = Math.max(peak, used);
    }
  return Math.max(0, 10_000 - peak);
}

export function pilotArm(
  pilotId: string,
  companyKey: string,
): "human" | "assisted" {
  return parseInt(commercialHash({ pilotId, companyKey }).slice(0, 8), 16) %
    2 ===
    0
    ? "human"
    : "assisted";
}
export type PilotMetrics = {
  humanMinutes: number;
  modelCost: number;
  reworkMinutes: number;
  validSources: number;
  totalClaims: number;
  calculationErrors: number;
  unauthorizedEffects: number;
  availabilityErrors: number;
  booked: boolean;
  paidAmount: number;
  verifiedMargin: number | null;
  complaints: number;
};
export function summarizePilot(
  rows: {
    arm: string;
    metrics: PilotMetrics;
    matureAt: Date | null;
    reviewed?: boolean;
  }[],
  now = new Date(),
) {
  return ["human", "assisted"].map((arm) => {
    const all = rows.filter((x) => x.arm === arm),
      mature = all.filter((x) => x.matureAt && x.matureAt <= now);
    const sum = (key: keyof PilotMetrics, entries = all) =>
      entries.reduce(
        (s, x) =>
          s +
          (typeof x.metrics[key] === "number" ? (x.metrics[key] as number) : 0),
        0,
      );
    const incidents =
        sum("unauthorizedEffects") +
        sum("availabilityErrors") +
        sum("calculationErrors"),
      reviewed = all.filter((x) => x.reviewed).length;
    return {
      arm,
      enrolled: all.length,
      mature: mature.length,
      booked: mature.filter((x) => x.metrics.booked).length,
      paidAmount: sum("paidAmount", mature),
      verifiedMargin:
        !mature.length || mature.some((x) => x.metrics.verifiedMargin === null)
          ? null
          : sum("verifiedMargin", mature),
      humanMinutes: sum("humanMinutes") + sum("reworkMinutes"),
      modelCost: sum("modelCost"),
      sourcePrecision: sum("totalClaims")
        ? sum("validSources") / sum("totalClaims")
        : null,
      calculationErrors: sum("calculationErrors"),
      unauthorizedEffects: sum("unauthorizedEffects"),
      availabilityErrors: sum("availabilityErrors"),
      complaints: sum("complaints"),
      stopRequired: incidents > 0,
      reviewed,
      zeroEventUpper95Approx:
        reviewed && incidents === 0 ? Math.min(1, 3 / reviewed) : null,
    };
  });
}
