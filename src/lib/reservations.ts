import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { amendedPriceIntervals, assertReservationVersion, assertReservationGroupVersions, ReservationConflictError } from "@/lib/reservation-amendments";
import { retryClosedConnectionRead } from "@/lib/database-read-retry";
import { loadAvailabilityDecisions } from "@/lib/availability-service";
import { getInventoryAvailabilitySummary } from "@/lib/inventory-availability-summary";
import { hasPermission } from "@/lib/rbac";
import { bucharestBusinessDateKey, dateKeyAsStorageDate } from "@/lib/dashboard/executive/time";
import {
  effectiveBlockingReservationWhere,
  effectiveHoldWhere,
  expireStaleHolds,
  HOLD_DURATION_DAYS,
  reservationLifecycleData
} from "@/lib/reservation-lifecycle";
import { occupancySummaryFromCounts } from "@/lib/reservation-lifecycle-domain";
import type { OccupancySummaryDTO, ReservationDTO, ReservationListItemDTO, ReservationPageDTO } from "@/types/location";
import type { AuthSession } from "@/lib/auth";
import { assertReservationInitialStatus, assertReservationTransition, ReservationPermissionError } from "@/lib/reservation-workflow";
import { allocateMoneyAcrossRows } from "@/lib/money-allocation";
import { isDigitalLocationType } from "@/lib/location-medium";
import { bookingPeriodsConflict } from "@/lib/availability";
import { emitStructuredLog } from "@/lib/observability";
import { resolveSellerForMutation } from "@/lib/seller-users";
import { paymentTermOptions, billingRules, billingFrequencies } from "@/lib/billing";
import { syncCampaignCommercialSummary } from "@/lib/campaigns/campaign-commercial-summary";
import { companyEntityOrThrow, normalizeCompanyEntity } from "@/lib/company-entities";
import { DECORATION_LOOKAHEAD_DAYS, NEUTRALIZATION_LOOKAHEAD_DAYS, OPERATION_HISTORY_DAYS } from "@/lib/operation-schedule";
import { SELLER_CAPABLE_ROLES } from "@/lib/sales-roles";
import { operationCost, withOperationCost } from "@/lib/operation-status";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  isOperationalProofActive,
  operationalProofDownloadPath,
  parseOperationalProofNotes
} from "@/lib/operational-proof";

const reservationStatusSchema = z.enum(["HOLD", "RESERVED", "BOOKED", "CANCELLED", "EXPIRED"]);
const activeReservationStatuses = ["HOLD", "RESERVED", "BOOKED"] as const;
const operationalReservationStatuses = ["BOOKED"] as const;
type SellerPatch = { ownerId?: string | null; sellerUserId?: string | null; salesperson?: string | null };
type ReservationDbClient = typeof prisma | Prisma.TransactionClient;
// A wait on a location lock must be followed by a fresh read, not a REPEATABLE READ snapshot.
const reservationUpdateTransactionOptions = { maxWait: 5_000, timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted } as const;
export const reservationWriteTransactionOptions = reservationUpdateTransactionOptions;

const reservationInclude = {
  client: { select: { accountOwnerUserId: true } },
  location: { select: { code: true, address: true, city: true, type: true } },
  priceSegments: { orderBy: { effectiveFrom: "asc" as const } },
  changeLogs: {
    orderBy: { createdAt: "desc" as const },
    take: 8,
    include: { createdBy: { select: { name: true } } }
  },
  billingItems: {
    orderBy: { invoiceDate: "desc" as const },
    take: 20,
    select: {
      id: true,
      invoiceDate: true,
      invoiceNumber: true,
      receivables: { select: { id: true } }
    }
  },
  documents: {
    where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" },
    orderBy: { uploadedAt: "desc" as const },
    take: 40,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      uploadedAt: true,
      expiryDate: true,
      notes: true,
      status: true,
      uploadedBy: { select: { name: true } }
    }
  }
};

const reservationSummaryInclude = {
  client: { select: { accountOwnerUserId: true } },
  location: { select: { code: true, address: true, city: true, type: true } }
};

const reservationWorkspaceSelect = {
  id: true,
  locationId: true,
  clientId: true,
  campaignId: true,
  status: true,
  clientName: true,
  clientCompany: true,
  contractCompany: true,
  campaignName: true,
  contractNumber: true,
  salesperson: true,
  amount: true,
  monthlyRentTotal: true,
  monthlyRentShare: true,
  contractGroupId: true,
  periodStart: true,
  periodEnd: true,
  installationDate: true,
  neutralizationDate: true,
  bookedAt: true,
  holdExpiresAt: true,
  ownerId: true,
  sellerUserId: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  location: { select: { code: true, address: true, city: true, type: true } }
} satisfies Prisma.ReservationSelect;

type ReservationWorkspaceRow = Prisma.ReservationGetPayload<{ select: typeof reservationWorkspaceSelect }>;

const reservationOperationalInclude = {
  ...reservationSummaryInclude,
  documents: {
    where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" },
    orderBy: { uploadedAt: "desc" as const },
    take: 40,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      uploadedAt: true,
      expiryDate: true,
      notes: true,
      status: true,
      uploadedBy: { select: { name: true } }
    }
  }
};

const optionalNumber = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}, z.number().nonnegative("Valorile financiare nu pot fi negative.").nullable().optional());

const requiredDate = z.preprocess((value) => {
  const date = parseDate(value);
  return date || value;
}, z.date());

const optionalDate = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "" || value == null) return null;
  return parseDate(value);
}, z.date().nullable().optional());

const optionalText = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "" || value == null) return null;
  const text = String(value).trim();
  return text || null;
}, z.string().nullable().optional());

const optionalInt = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return parsed;
}, z.number().int().min(0).nullable().optional());

export const reservationInputSchema = z.object({
  locationId: z.string().trim().min(1).nullable().optional(),
  locationIds: z.array(z.string().trim().min(1)).max(500).nullable().optional(),
  clientId: optionalText,
  campaignId: optionalText,
  status: reservationStatusSchema.default("RESERVED"),
  clientName: optionalText,
  clientCompany: optionalText,
  contractCompany: optionalText,
  clientEmail: z.preprocess((value) => value === undefined ? undefined : value === "" || value == null ? null : String(value).trim(), z.string().email("Emailul clientului nu este valid.").max(254).nullable().optional()),
  clientPhone: optionalText,
  campaignName: optionalText,
  contractNumber: optionalText,
  salesperson: optionalText,
  sellerUserId: optionalText,
  notes: optionalText,
  productionNotes: optionalText,
  amount: optionalNumber,
  monthlyRentTotal: optionalNumber,
  monthlyRentShare: optionalNumber,
  contractGroupId: optionalText,
  ownerId: optionalText,
  periodStart: requiredDate,
  periodEnd: requiredDate,
  installationDate: optionalDate,
  neutralizationDate: optionalDate,
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  paymentTermType: optionalText,
  paymentTermDays: optionalInt,
  customPaymentTermNote: optionalText,
  billingRule: optionalText,
  billingDayOfMonth: optionalInt,
  customBillingDate: optionalDate,
  billingFrequency: optionalText,
  invoiceGenerationMode: optionalText,
  nextInvoiceDate: optionalDate,
  billingNotes: optionalText,
  cancellationReason: optionalText
});

export const reservationPatchSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  expectedVersions: z.record(z.string(), z.string().datetime()).optional(),
  amendmentEffectiveDate: optionalDate,
  amendmentReference: z.string().trim().min(3).max(191).optional(),
  amendmentMode: z.enum(["amendment", "correction"]).optional(),
  groupRentShares: z.array(z.object({ reservationId: z.string().min(1), monthlyRent: z.number().positive().finite() })).max(500).optional(),
  locationId: z.string().trim().min(1).nullable().optional(),
  clientId: optionalText,
  campaignId: optionalText,
  status: reservationStatusSchema.optional(),
  clientName: optionalText,
  clientCompany: optionalText,
  contractCompany: optionalText,
  clientEmail: z.preprocess((value) => value === undefined ? undefined : value === "" || value == null ? null : String(value).trim(), z.string().email("Emailul clientului nu este valid.").max(254).nullable().optional()),
  clientPhone: optionalText,
  campaignName: optionalText,
  contractNumber: optionalText,
  salesperson: optionalText,
  sellerUserId: optionalText,
  notes: optionalText,
  productionNotes: optionalText,
  amount: optionalNumber,
  monthlyRentTotal: optionalNumber,
  monthlyRentShare: optionalNumber,
  contractGroupId: optionalText,
  ownerId: optionalText,
  periodStart: optionalDate,
  periodEnd: optionalDate,
  installationDate: optionalDate,
  neutralizationDate: optionalDate,
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  paymentTermType: optionalText,
  paymentTermDays: optionalInt,
  customPaymentTermNote: optionalText,
  billingRule: optionalText,
  billingDayOfMonth: optionalInt,
  customBillingDate: optionalDate,
  billingFrequency: optionalText,
  invoiceGenerationMode: optionalText,
  nextInvoiceDate: optionalDate,
  billingNotes: optionalText,
  cancellationReason: optionalText
});

export async function listReservations(filters: {
  status?: string | null;
  client?: string | null;
  locationId?: string | null;
  from?: string | null;
  to?: string | null;
} = {}, actor?: AuthSession | null, options: { includeDetails?: boolean } = {}) {
  const where = reservationListWhere(filters, actor);

  const reservationsWithSegments = await prisma.reservation.findMany({
    where,
    include: options.includeDetails === false ? reservationSummaryInclude : reservationInclude,
    orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }, { periodStart: "desc" }],
    take: 500
  });

  return reservationsWithSegments.map(serializeReservation);
}

export async function listReservationWorkspace(
  filters: {
    status?: string | null;
    client?: string | null;
    locationId?: string | null;
    from?: string | null;
    to?: string | null;
  } = {},
  actor?: AuthSession | null
) {
  const rows = await prisma.reservation.findMany({
    where: reservationListWhere(filters, actor),
    select: reservationWorkspaceSelect,
    orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }, { periodStart: "desc" }],
    take: 500
  });

  return rows.map(serializeReservationWorkspaceRow);
}

export type ReservationPageFilters = {
  query?: string | null;
  status?: string | null;
  scope?: "active" | "history" | "all" | string | null;
  page?: number | string | null;
  pageSize?: number | string | null;
};

const reservationListItemSelect = {
  id: true,
  locationId: true,
  status: true,
  clientName: true,
  campaignName: true,
  salesperson: true,
  contractNumber: true,
  periodStart: true,
  periodEnd: true,
  holdExpiresAt: true,
  amount: true,
  currency: true,
  updatedAt: true,
  location: { select: { code: true, address: true } }
} satisfies Prisma.ReservationSelect;

type ReservationListItemRow = Prisma.ReservationGetPayload<{ select: typeof reservationListItemSelect }>;

export async function listReservationPage(
  filters: ReservationPageFilters = {},
  actor?: AuthSession | null
): Promise<{ page: ReservationPageDTO; summary: OccupancySummaryDTO }> {
  const now = new Date();
  const today = startOfUtcDay(now);
  const pageSize = clampInteger(filters.pageSize, 10, 10, 50);
  const requestedPage = clampInteger(filters.page, 1, 1, 100_000);
  const accessWhere = reservationAccessWhere(actor);
  const where = paginatedReservationWhere(filters, actor, now, today);
  const [total, summary] = await Promise.all([
    prisma.reservation.count({ where }),
    getReservationOccupancySummary(actor, now)
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumber = Math.min(requestedPage, totalPages);

  const rows = await prisma.reservation.findMany({
    where,
    select: reservationListItemSelect,
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { updatedAt: "desc" }],
    skip: (pageNumber - 1) * pageSize,
    take: pageSize
  });

  return {
    page: {
      items: rows.map(serializeReservationListItem),
      page: pageNumber,
      pageSize,
      total,
      totalPages,
      hasNextPage: pageNumber < totalPages,
      hasPreviousPage: pageNumber > 1
    },
    summary
  };
}

export async function getReservationOccupancySummary(
  actor?: AuthSession | null,
  now = new Date()
): Promise<OccupancySummaryDTO> {
  const today = dateKeyAsStorageDate(bucharestBusinessDateKey(now));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const accessWhere = reservationAccessWhere(actor);
  const [activeHolds, occupiedNow, upcoming, inventory] = await Promise.all([
    prisma.reservation.count({
      where: combineReservationWhere(accessWhere, effectiveHoldWhere(now), { periodEnd: { gte: today } })
    }),
    prisma.reservation.count({
      where: combineReservationWhere(accessWhere, { status: "BOOKED", periodStart: { lt: tomorrow }, periodEnd: { gte: today } })
    }),
    prisma.reservation.count({
      where: combineReservationWhere(accessWhere, { status: "BOOKED", periodStart: { gte: tomorrow }, periodEnd: { gte: today } })
    }),
    actor && hasPermission(actor.role, "inventory.view")
      ? getInventoryAvailabilitySummary({ now })
      : Promise.resolve(null)
  ]);

  return { ...occupancySummaryFromCounts({ activeHolds, occupiedNow, upcoming }), inventory };
}

function reservationListWhere(
  filters: { status?: string | null; client?: string | null; locationId?: string | null; from?: string | null; to?: string | null },
  actor?: AuthSession | null
): Prisma.ReservationWhereInput {
  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  const parts: Prisma.ReservationWhereInput[] = [reservationAccessWhere(actor)];
  if (filters.status) parts.push({ status: filters.status as never });
  if (filters.locationId) parts.push({ locationId: filters.locationId });
  if (filters.client) {
    parts.push({
      OR: [
        { clientName: { contains: filters.client } },
        { clientCompany: { contains: filters.client } },
        { campaignName: { contains: filters.client } }
      ]
    });
  }
  if (from) parts.push({ periodEnd: { gte: from } });
  if (to) parts.push({ periodStart: { lte: to } });
  return combineReservationWhere(...parts);
}

function paginatedReservationWhere(
  filters: ReservationPageFilters,
  actor: AuthSession | null | undefined,
  now: Date,
  today: Date
): Prisma.ReservationWhereInput {
  const parts: Prisma.ReservationWhereInput[] = [reservationAccessWhere(actor)];
  const query = String(filters.query || "").trim();
  const scope = filters.scope === "history" || filters.scope === "all" ? filters.scope : "active";
  const status = normalizeReservationStatus(filters.status);

  if (filters.status === "HOLD_ACTIVE") parts.push({ status: { in: ["HOLD", "RESERVED"] } });
  else if (status) parts.push({ status });
  if (query) {
    parts.push({
      OR: [
        { clientName: { contains: query } },
        { clientCompany: { contains: query } },
        { campaignName: { contains: query } },
        { contractNumber: { contains: query } },
        { salesperson: { contains: query } },
        { location: { code: { contains: query } } },
        { location: { address: { contains: query } } }
      ]
    });
  }
  if (scope === "active") {
    parts.push(effectiveBlockingReservationWhere(now), { periodEnd: { gte: today } });
  } else if (scope === "history") {
    parts.push({ OR: [{ status: { in: ["CANCELLED", "EXPIRED"] } }, { periodEnd: { lt: today } }] });
  }
  return combineReservationWhere(...parts);
}

function reservationAccessWhere(actor?: AuthSession | null): Prisma.ReservationWhereInput {
  if (actor?.role !== "SALES_AGENT") return {};
  return {
    OR: [
      { sellerUserId: actor.id },
      { ownerId: actor.id },
      { ownerId: null, salesperson: { in: [actor.name, actor.email] } }
    ]
  };
}

function combineReservationWhere(...parts: Prisma.ReservationWhereInput[]) {
  const active = parts.filter((part) => Object.keys(part).length > 0);
  if (!active.length) return {};
  if (active.length === 1) return active[0];
  return { AND: active } satisfies Prisma.ReservationWhereInput;
}

function serializeReservationListItem(row: ReservationListItemRow): ReservationListItemDTO {
  return {
    id: row.id,
    locationId: row.locationId,
    locationCode: row.location.code,
    locationName: row.location.address,
    status: row.status as ReservationListItemDTO["status"],
    clientName: row.clientName,
    campaignName: row.campaignName,
    salesperson: row.salesperson,
    contractNumber: row.contractNumber,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    holdExpiresAt: row.holdExpiresAt?.toISOString() || null,
    amount: row.amount,
    currency: row.currency,
    updatedAt: row.updatedAt.toISOString()
  };
}

function serializeReservationWorkspaceRow(row: ReservationWorkspaceRow): ReservationDTO {
  return {
    id: row.id,
    locationId: row.locationId,
    clientId: row.clientId,
    campaignId: row.campaignId,
    locationCode: row.location.code,
    locationName: row.location.address,
    status: row.status as ReservationDTO["status"],
    clientName: row.clientName,
    clientCompany: row.clientCompany,
    contractCompany: row.contractCompany,
    campaignName: row.campaignName,
    contractNumber: row.contractNumber,
    salesperson: row.salesperson,
    amount: row.amount,
    monthlyRentTotal: row.monthlyRentTotal,
    monthlyRentShare: row.monthlyRentShare,
    contractGroupId: row.contractGroupId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    installationDate: row.installationDate?.toISOString() || null,
    neutralizationDate: row.neutralizationDate?.toISOString() || null,
    bookedAt: row.bookedAt?.toISOString() || null,
    holdExpiresAt: row.holdExpiresAt?.toISOString() || null,
    ownerId: row.ownerId,
    sellerUserId: row.sellerUserId || row.ownerId,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  } as ReservationDTO;
}

function normalizeReservationStatus(value?: string | null) {
  return ["HOLD", "RESERVED", "BOOKED", "CANCELLED", "EXPIRED"].includes(String(value || ""))
    ? String(value) as ReservationDTO["status"]
    : null;
}

function clampInteger(value: number | string | null | undefined, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function getReservation(id: string, actor?: AuthSession | null) {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id },
    include: reservationInclude
  });
  assertReservationOwnership(reservation, actor);
  return serializeReservation(reservation);
}

export async function getReservationGroup(id: string, actor?: AuthSession | null) {
  const anchor = await prisma.reservation.findUniqueOrThrow({
    where: { id },
    include: reservationInclude
  });
  assertReservationOwnership(anchor, actor);
  if (!anchor.contractGroupId) return [serializeReservation(anchor)];

  const reservations = await prisma.reservation.findMany({
    where: { contractGroupId: anchor.contractGroupId },
    include: reservationInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  for (const reservation of reservations) assertReservationOwnership(reservation, actor);
  return reservations.map(serializeReservation);
}

export async function listOperationReservations(session: AuthSession) {
  if (session.role === "FIELD_OPERATOR") return [];
  const today = startOfUtcDay(new Date());
  const windowStart = addDays(today, -OPERATION_HISTORY_DAYS);
  const decorationWindowEnd = addDays(today, DECORATION_LOOKAHEAD_DAYS);
  const neutralizationWindowEnd = addDays(today, NEUTRALIZATION_LOOKAHEAD_DAYS);

  const reservations = await prisma.reservation.findMany({
    where: {
      status: { in: [...operationalReservationStatuses] },
      AND: [
        {
          OR: [
            { installationDate: { gte: windowStart, lte: decorationWindowEnd } },
            { neutralizationDate: { gte: windowStart, lte: neutralizationWindowEnd } },
            { installationDate: null, periodStart: { gte: windowStart, lte: decorationWindowEnd } },
            { neutralizationDate: null, periodEnd: { gte: windowStart, lte: neutralizationWindowEnd } },
            { periodStart: { lte: neutralizationWindowEnd }, periodEnd: { gte: windowStart } }
          ]
        },
        ...(session.role === "SALES_AGENT" ? [{
          OR: [
            { ownerId: session.id },
            { sellerUserId: session.id },
            { client: { accountOwnerUserId: session.id } },
            {
              ownerId: null,
              sellerUserId: null,
              salesperson: { in: [session.name, session.email] }
            }
          ]
        } satisfies Prisma.ReservationWhereInput] : [])
      ]
    },
    include: reservationOperationalInclude,
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "desc" }],
    take: 1000
  });

  return reservations.map(serializeReservation);
}

export async function createReservation(input: unknown, actor?: AuthSession | null) {
  const initial = normalizeReservationInput(reservationInputSchema.parse(input));
  assertReservationInitialStatus(initial.status, actor?.role);
  if (initial.contractGroupId) throw new ReservationPermissionError("Grupurile sunt generate de server; nu poti adauga o rezervare unui grup furnizat manual.");
  const seller = await resolveCreateSeller(initial, actor);
  await resolveRentalContext(initial);
  const parsed = initial;
  assertHoldHasClientName(parsed.status, parsed.clientName);
  const locationIds = selectedLocationIds(parsed);
  if (!locationIds.length) {
    throw new Error("Alege cel putin o locatie pentru rezervare.");
  }

  const existingLocations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, code: true }
  });
  if (existingLocations.length !== locationIds.length) {
    throw new Error("Una dintre locatiile selectate nu mai exista.");
  }

  const monthlyRentTotal = parsed.monthlyRentTotal ?? parsed.amount ?? null;
  const monthlyRentShares = monthlyRentTotal == null
    ? locationIds.map(() => parsed.monthlyRentShare ?? null)
    : allocateMoneyAcrossRows(monthlyRentTotal, locationIds.length);
  assertBookedPrice(parsed.status, monthlyRentTotal ?? parsed.monthlyRentShare);
  for (const share of monthlyRentShares) assertBookedPrice(parsed.status, share);
  const contractGroupId = locationIds.length > 1 ? randomUUID() : null;
  const lifecycleData = reservationLifecycleData(parsed.status);

  const reservations = await prisma.$transaction(async (tx) => {
    await lockReservationLocationsForWrite(tx, locationIds);
    const currentContext = parsed.status === "BOOKED" ? await loadAndValidateRentalContext(parsed.clientId!, parsed.campaignId!, tx, actor) : null;
    const currentInput = withValidatedBookingTerms(parsed, currentContext);
    const currentReservationData = baseReservationData(currentInput, currentContext);
    for (const locationId of locationIds) {
      await assertCanonicalReservationAvailabilityForWrite(tx, locationId, parsed.periodStart, parsed.periodEnd, parsed.status);
    }

    const created = [];
    for (const [locationIndex, locationId] of locationIds.entries()) {
      const monthlyRentShare = monthlyRentShares[locationIndex];
      const reservation = await tx.reservation.create({
        data: {
          ...currentReservationData,
          productionNotes: splitDecorationCostForGroup(
            currentReservationData.productionNotes,
            locationIds.length,
            locationIndex
          ),
          locationId,
          clientId: currentContext?.client.id || null,
          campaignId: currentContext?.campaign.id || null,
          amount: monthlyRentShare,
          monthlyRentTotal,
          monthlyRentShare,
          contractGroupId,
          ownerId: seller.ownerId,
          sellerUserId: seller.sellerUserId,
          salesperson: seller.salesperson,
          ...lifecycleData
        },
        include: reservationInclude
      });
      if (parsed.status === "BOOKED") {
        await tx.rentalPriceSegment.create({
          data: {
            rentalId: reservation.id,
            effectiveFrom: parsed.periodStart,
            effectiveTo: parsed.periodEnd,
            monthlyRent: monthlyRentShare ?? monthlyRentTotal ?? 0,
            currency: currentReservationData.currency || "EUR",
            reason: "Segment initial la creare inchiriere.",
            createdByUserId: actor?.id || null
          }
        });
        await tx.rentalChangeLog.create({
          data: {
            rentalId: reservation.id,
            action: "created",
            nextJson: {
              clientId: currentContext?.client.id,
              campaignId: currentContext?.campaign.id,
              periodStart: parsed.periodStart.toISOString(),
              periodEnd: parsed.periodEnd.toISOString(),
              monthlyRent: monthlyRentShare ?? monthlyRentTotal ?? 0
            },
            createdByUserId: actor?.id || null
          }
        });
      }
      created.push(reservation);
    }
    if (parsed.status === "BOOKED" && currentContext?.campaign.id) {
      await syncCampaignCommercialSummary(tx, currentContext.campaign.id);
    }
    await recordTransactionalAudit(tx, { actor, action: "reservation.create.committed", entityType: "reservation", entityId: created[0]?.id, metadata: { reservationIds: created.map((row) => row.id), contractGroupId } });
    return created;
  }, reservationUpdateTransactionOptions);

  return reservations.map(serializeReservation);
}

/**
 * Narrow entry point for an approved agent command. The caller owns the outer
 * ReadCommitted transaction and must atomically consume its payload-bound human
 * approval and persist the command receipt there. This function never opens a
 * transaction, confirms BOOKED, sends a message, or accepts arbitrary columns.
 */
export async function createApprovedAgentHold(
  tx: Prisma.TransactionClient,
  input: {
    locationIds: string[]; periodStart: Date; periodEnd: Date;
    clientId: string; campaignId: string; ownerUserId: string;
    requestKey: string; holdExpiresAt: Date;
    quotedTerms?: { currency: "RON" | "EUR"; companyEntity: string; quoteRevisionId: string; lines: Array<{ locationId: string; monthlyRate: string }> };
  },
  actor: AuthSession
): Promise<ReservationDTO[]> {
  if (!["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(actor.role)) {
    throw new ReservationPermissionError("Hold-ul agentului necesita aprobarea unui manager comercial.");
  }
  const plan = reservationInputSchema.parse({
    locationIds: input.locationIds, periodStart: input.periodStart, periodEnd: input.periodEnd,
    clientId: input.clientId, campaignId: input.campaignId,
    ownerId: input.ownerUserId, sellerUserId: input.ownerUserId, status: "HOLD"
  });
  const locationIds = selectedLocationIds(plan);
  const now = new Date();
  const maximumExpiry = now.getTime() + HOLD_DURATION_DAYS * 86400000;
  if (!locationIds.length || !input.requestKey?.trim() || input.requestKey.length > 191 ||
      !Number.isFinite(input.holdExpiresAt?.getTime()) || input.holdExpiresAt <= now ||
      input.holdExpiresAt.getTime() > maximumExpiry) {
    throw new Error("Intentia hold sau expirarea nu este valida.");
  }
  const seller = await resolveSellerForMutation({ actor, sellerUserId: input.ownerUserId, db: tx });
  const externalIds = locationIds.map((id) => "agent-hold:" + createHash("sha256").update(input.requestKey + ":" + id).digest("hex"));
  await lockReservationLocationsForWrite(tx, locationIds);
  const context = await loadAndValidateRentalContext(input.clientId, input.campaignId, tx);
  if (context.client.accountOwnerUserId !== input.ownerUserId ||
      ![context.campaign.accountOwnerUserId, context.campaign.sellerUserId].includes(input.ownerUserId)) {
    throw new ReservationPermissionError("Clientul si campania nu apartin portofoliului aprobat.");
  }
  const quoted = input.quotedTerms ? z.object({
    currency: z.enum(["RON", "EUR"]), companyEntity: z.string().min(1), quoteRevisionId: z.string().trim().min(1).max(191),
    lines: z.array(z.object({ locationId: z.string().min(1), monthlyRate: z.string().regex(/^\d+\.\d{2}$/).refine((rate) => Number(rate) > 0 && Number.isFinite(Number(rate))) })).min(1).max(500)
  }).strict().parse(input.quotedTerms) : null;
  const quoteRates = new Map(quoted?.lines.map((line) => [line.locationId, Number(line.monthlyRate)]) || []);
  const quoteTotal = quoted ? quoted.lines.reduce((sum, line) => sum.plus(line.monthlyRate), new Prisma.Decimal(0)).toNumber() : null;
  if (quoted && (quoteRates.size !== locationIds.length || quoted.lines.length !== locationIds.length || locationIds.some((id) => !quoteRates.has(id)) ||
      quoted.currency !== context.campaign.currency || companyEntityOrThrow(quoted.companyEntity) !== companyEntityOrThrow(context.campaign.companyEntity || ""))) {
    throw new Error("Termenii ofertei nu corespund locațiilor, monedei sau firmei campaniei aprobate.");
  }
  if (quoted) validatedBookingTerms(quoted, context.campaign);
  const quoteProvenance = quoted ? `Ofertă comercială aprobată · versiune ${quoted.quoteRevisionId}` : null;
  const prior = await tx.reservation.findMany({ where: { externalId: { in: externalIds } }, include: reservationInclude });
  if (prior.length) {
    if (prior.length !== locationIds.length || prior.some((row) =>
      row.status !== "HOLD" || row.ownerId !== input.ownerUserId || row.clientId !== input.clientId ||
      row.campaignId !== input.campaignId || row.periodStart.getTime() !== plan.periodStart.getTime() ||
      row.periodEnd.getTime() !== plan.periodEnd.getTime() || row.holdExpiresAt?.getTime() !== input.holdExpiresAt.getTime() ||
      (quoted ? row.amount !== quoteRates.get(row.locationId) || row.monthlyRentShare !== quoteRates.get(row.locationId) || row.monthlyRentTotal !== quoteTotal || row.currency !== quoted.currency || row.contractCompany !== companyEntityOrThrow(quoted.companyEntity) || row.notes !== quoteProvenance : Boolean(row.notes?.startsWith("Ofertă comercială aprobată")))
    )) throw new Error("Cheia hold-ului a fost deja utilizata pentru un rezultat diferit.");
    return prior.map(serializeReservation);
  }
  for (const locationId of locationIds) {
    await assertCanonicalReservationAvailabilityForWrite(tx, locationId, plan.periodStart, plan.periodEnd, "HOLD");
  }
  const contractGroupId = locationIds.length > 1 ? randomUUID() : null;
  const created = [];
  for (const [index, locationId] of locationIds.entries()) {
    created.push(await tx.reservation.create({ data: {
      locationId, clientId: context.client.id, campaignId: context.campaign.id,
      clientName: context.client.companyName, clientCompany: context.client.companyName,
      campaignName: context.campaign.campaignName, status: "HOLD", contractGroupId,
      periodStart: plan.periodStart, periodEnd: plan.periodEnd,
      holdExpiresAt: input.holdExpiresAt, bookedAt: null,
      ...(quoted ? {
        amount: quoteRates.get(locationId), monthlyRentShare: quoteRates.get(locationId), monthlyRentTotal: quoteTotal,
        currency: quoted.currency, contractCompany: companyEntityOrThrow(quoted.companyEntity), notes: quoteProvenance,
        paymentTermType: context.campaign.paymentTermType, paymentTermDays: context.campaign.paymentTermDays,
        billingRule: context.campaign.billingRule, billingFrequency: context.campaign.billingFrequency
      } : {}),
      ownerId: seller.ownerId, sellerUserId: seller.sellerUserId, salesperson: seller.salesperson,
      externalSource: "approved-sales-agent", externalId: externalIds[index], invoiceGenerationMode: "manual"
    }, include: reservationInclude }));
  }
  await recordTransactionalAudit(tx, { actor, action: "agent.hold.create.committed", entityType: "reservation",
    entityId: created[0]?.id, metadata: { reservationIds: created.map((row) => row.id), requestKey: input.requestKey, ownerUserId: input.ownerUserId } });
  return created.map(serializeReservation);
}

export async function updateReservation(id: string, input: unknown, actor?: AuthSession | null) {
  const parsed = normalizeReservationInput(reservationPatchSchema.parse(input));

  const reservation = await prisma.$transaction(async (tx) => {
    let existing = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { client: true, campaign: true } });
    assertReservationOwnership(existing, actor);
    const originalLocationId = existing.locationId;
    await lockReservationLocationsForWrite(tx, [existing.locationId, parsed.locationId || existing.locationId]);
    await lockReservationRowsForWrite(tx, [id]);
    existing = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { client: true, campaign: true } });
    if (existing.locationId !== originalLocationId) throw concurrentReservationChange();
    assertReservationOwnership(existing, actor);
    assertReservationVersion(existing, parsed.expectedUpdatedAt, Boolean(actor));
    assertGroupIdUnchanged(parsed, existing);
    const ownershipPatch: SellerPatch = await resolveUpdateSeller(parsed, existing, actor, tx);
    const nextStatusForClient = parsed.status || existing.status;
    if (nextStatusForClient === "BOOKED" && existing.status !== "BOOKED") assertReservationInitialStatus("BOOKED", actor?.role);
    const rentalContext = await resolveRentalContextForUpdate(parsed, existing, tx, undefined, actor);
    if (nextStatusForClient !== "BOOKED") {
      assertHoldHasClientName(nextStatusForClient, parsed.clientName === undefined ? existing.clientName : parsed.clientName);
    }
    const next = {
      locationId: parsed.locationId || existing.locationId,
      periodStart: parsed.periodStart || existing.periodStart,
      periodEnd: parsed.periodEnd || existing.periodEnd,
      status: parsed.status || existing.status
    };
    const availabilityChanged =
      (parsed.locationId !== undefined && parsed.locationId !== existing.locationId) ||
      (parsed.periodStart != null && parsed.periodStart.getTime() !== existing.periodStart.getTime()) ||
      (parsed.periodEnd != null && parsed.periodEnd.getTime() !== existing.periodEnd.getTime()) ||
      (parsed.status !== undefined && (parsed.status !== existing.status || parsed.status === "HOLD" || parsed.status === "RESERVED"));

    if (parsed.status && actor) {
      assertReservationTransition(existing.status as ReservationDTO["status"], parsed.status, actor.role);
    }

    if (availabilityChanged) {
      await assertCanonicalReservationAvailabilityForWrite(tx, next.locationId, next.periodStart, next.periodEnd, next.status, id);
    }

    if (existing.status !== "BOOKED" || isCommercialReservationPatch(parsed)) {
      assertBookedPrice(nextStatusForClient, proposedReservationRent(parsed, existing));
    }
    if (existing.status === "BOOKED" && existing.contractGroupId && (["amount", "monthlyRentShare", "monthlyRentTotal", "currency"].some((key) => parsed[key as "amount"] !== undefined && parsed[key as "amount"] !== existing[key as "amount"]))) {
      const members = await tx.reservation.count({ where: { contractGroupId: existing.contractGroupId } });
      if (members > 1) throw new Error("Modifică prețul din editarea întregului contract grupat, păstrând explicit chiriile celorlalte amplasamente.");
    }
    assertConfirmedTermsCorrection(parsed, existing, nextStatusForClient, actor);
    const patchData = reservationPatchData(parsed, rentalContext, nextStatusForClient, existing);
    if (!existing.contractGroupId && ["amount", "monthlyRentShare", "monthlyRentTotal"].some((key) => parsed[key as "amount"] !== undefined)) {
      const rent = proposedReservationRent(parsed, existing);
      patchData.amount = rent ?? null; patchData.monthlyRentShare = rent ?? null; patchData.monthlyRentTotal = rent ?? null;
    }
    if (parsed.status === "CANCELLED" && parsed.cancellationReason) {
      patchData.notes = appendReservationNote(existing.notes, `Anulare: ${parsed.cancellationReason}`);
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        ...patchData,
        updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
        ...(rentalContext && (existing.status !== "BOOKED" || (parsed.clientId !== undefined && parsed.clientId !== existing.clientId) || (parsed.campaignId !== undefined && parsed.campaignId !== existing.campaignId))
          ? {
              clientId: rentalContext.client.id,
              campaignId: rentalContext.campaign.id,
              clientName: rentalContext.client.companyName,
              clientCompany: rentalContext.client.companyName,
              clientEmail: rentalContext.client.generalEmail,
              clientPhone: rentalContext.client.generalPhone,
              campaignName: rentalContext.campaign.campaignName,
              contractCompany: normalizeCompanyEntity(rentalContext.campaign.companyEntity) || existing.contractCompany
            }
          : {}),
        ...ownershipPatch,
        ...(parsed.status ? reservationLifecycleData(parsed.status, existing.bookedAt) : {})
      },
      include: reservationInclude
    });

    if (nextStatusForClient === "BOOKED") {
      await synchronizeReservationPriceHistory(tx, existing, updated, parsed, actor);
    }

    await logRentalCorrection(tx, existing, updated, actor?.id || null);
    await logConfirmedTermsCorrection(tx, parsed, existing, updated, actor);
    if (campaignCommercialSummaryAffected(parsed)) {
      const affectedCampaignIds = new Set(
        [existing.campaignId, updated.campaignId].filter((campaignId): campaignId is string => Boolean(campaignId))
      );
      for (const campaignId of [...affectedCampaignIds].sort()) {
        await syncCampaignCommercialSummary(tx, campaignId);
      }
    }

    await recordTransactionalAudit(tx, { actor, action: "reservation.update.committed", entityType: "reservation", entityId: updated.id });
    return updated;
  }, reservationUpdateTransactionOptions);

  const reservationWithSegments = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservation.id },
    include: reservationInclude
  });

  return serializeReservation(reservationWithSegments);
}

export async function updateReservationGroupStatus(
  id: string,
  inputStatus: unknown,
  actor?: AuthSession | null,
  options: { cancellationReason?: string | null; expectedVersions?: Record<string, string> } = {}
) {
  const status = reservationStatusSchema.parse(inputStatus);
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    assertReservationGroupVersions(reservations, options.expectedVersions, Boolean(actor));
    const validatedIds = reservations.map((reservation) => reservation.id);
    assertNoPlannedReservationConflicts(reservations.map((reservation) => ({ ...reservation, status })));

    const contexts = new Map<string, RentalContext>();
    const rentalContextCache = new Map<string, ReturnType<typeof loadAndValidateRentalContext>>();
    for (const reservation of reservations) {
      if (actor) {
        assertReservationTransition(reservation.status as ReservationDTO["status"], status, actor.role);
      }
      if (status === "BOOKED") {
        if (reservation.status !== "BOOKED") {
          assertReservationInitialStatus("BOOKED", actor?.role);
          assertBookedPrice(status, reservation.amount ?? reservation.monthlyRentShare ?? reservation.monthlyRentTotal);
          const context = await resolveRentalContextForUpdate({ status: "BOOKED" }, reservation, tx, rentalContextCache, actor);
          if (context) { assertConfirmedContractEntity(reservation, context.campaign); validatedBookingTerms(reservation, context.campaign); }
          contexts.set(reservation.id, context);
        }
      }
      await assertCanonicalReservationAvailabilityForWrite(
        tx,
        reservation.locationId,
        reservation.periodStart,
        reservation.periodEnd,
        status,
        reservation.id,
        validatedIds
      );
    }

    for (const reservation of reservations) {
      const context = contexts.get(reservation.id);
      const statusData = {
        status,
        updatedAt: new Date(Math.max(Date.now(), reservation.updatedAt.getTime() + 1)),
        ...(status === "BOOKED" ? {
          ...(reservation.status !== "BOOKED" && context ? validatedBookingTerms(reservation, context.campaign) : {}),
          invoiceGenerationMode: "manual",
          neutralizationDate: reservation.neutralizationDate || reservation.periodEnd,
          ...(context ? {
            clientName: context.client.companyName, clientCompany: context.client.companyName,
            clientEmail: context.client.generalEmail, clientPhone: context.client.generalPhone,
            campaignName: context.campaign.campaignName
          } : {})
        } : ["CANCELLED", "EXPIRED"].includes(status) ? { neutralizationDate: null } : {}),
        ...reservationLifecycleData(status, reservation.bookedAt),
        ...(status === "CANCELLED" && options.cancellationReason ? { notes: appendReservationNote(reservation.notes, `Anulare: ${options.cancellationReason}`) } : {})
      };
      const next = await tx.reservation.update({ where: { id: reservation.id }, data: statusData });
      if (status === "BOOKED" && reservation.status !== "BOOKED") {
        await ensureCurrentPriceSegment(tx, next.id, next.periodStart, next.periodEnd,
          next.amount ?? next.monthlyRentShare ?? next.monthlyRentTotal!, next.currency || "EUR", actor?.id || null);
      }
      await logRentalCorrection(tx, reservation, next, actor?.id || null);
    }
    const affectedCampaignIds = new Set(
      reservations.map((reservation) => reservation.campaignId).filter((campaignId): campaignId is string => Boolean(campaignId))
    );
    for (const campaignId of [...affectedCampaignIds].sort()) {
      await syncCampaignCommercialSummary(tx, campaignId);
    }

    await recordTransactionalAudit(tx, { actor, action: "reservation.group_status.committed", entityType: "reservation", entityId: id, metadata: { reservationIds: validatedIds } });
    return tx.reservation.findMany({
      where: { id: { in: validatedIds } },
      include: reservationInclude,
      orderBy: [{ createdAt: "asc" }]
    });
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function updateReservationGroup(id: string, input: unknown, actor?: AuthSession | null) {
  const parsed = normalizeReservationInput(reservationPatchSchema.parse(input));

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor, parsed.locationId ? [parsed.locationId] : []);
    const validatedIds = reservations.map((reservation) => reservation.id);
    for (const reservation of reservations) assertGroupIdUnchanged(parsed, reservation);
    assertReservationGroupVersions(reservations, parsed.expectedVersions, Boolean(actor));
    let groupShares: number[] | null = null;
    if (parsed.groupRentShares) {
      const shares = new Map(parsed.groupRentShares.map((row) => [row.reservationId, row.monthlyRent]));
      if (shares.size !== reservations.length || parsed.groupRentShares.length !== reservations.length || reservations.some((row) => !shares.has(row.id))) throw new Error("Specifică explicit chiria fiecărui amplasament din contract.");
      groupShares = reservations.map((row) => shares.get(row.id)!);
      const cents = groupShares.reduce((sum, value) => sum + Math.round(value * 100), 0);
      if (parsed.monthlyRentTotal != null && cents !== Math.round(parsed.monthlyRentTotal * 100)) throw new Error("Suma chiriilor pe amplasament trebuie să coincidă cu totalul contractual.");
      parsed.monthlyRentTotal = cents / 100;
    } else if (reservations.length > 1 && ["amount", "monthlyRentShare"].some((key) => parsed[key as "amount" | "monthlyRentShare"] !== undefined)) {
      throw new Error("La editarea unui grup, specifică explicit chiria fiecărui amplasament.");
    } else if (parsed.monthlyRentTotal != null && reservations.some((row) => row.monthlyRentTotal !== parsed.monthlyRentTotal)) {
      throw new Error("Modificarea totalului cere distribuția explicită pe amplasamente. Împărțirea egală nu se aplică automat.");
    }
    assertNoPlannedReservationConflicts(reservations.map((reservation) => ({
      ...reservation,
      locationId: parsed.locationId || reservation.locationId,
      periodStart: parsed.periodStart || reservation.periodStart,
      periodEnd: parsed.periodEnd || reservation.periodEnd,
      status: parsed.status || reservation.status
    })));

    const prepared = [];
    const rentalContextCache = new Map<string, ReturnType<typeof loadAndValidateRentalContext>>();
    for (const reservation of reservations) {
      assertReservationOwnership(reservation, actor);
      const ownershipPatch: SellerPatch = await resolveUpdateSeller(parsed, reservation, actor, tx);
      const nextStatusForClient = parsed.status || reservation.status;
      if (nextStatusForClient === "BOOKED" && reservation.status !== "BOOKED") assertReservationInitialStatus("BOOKED", actor?.role);
      const rentalContext = await resolveRentalContextForUpdate(parsed, reservation, tx, rentalContextCache, actor);
      if (nextStatusForClient !== "BOOKED") {
        assertHoldHasClientName(nextStatusForClient, parsed.clientName === undefined ? reservation.clientName : parsed.clientName);
      }
      if (parsed.status && actor) {
        assertReservationTransition(reservation.status as ReservationDTO["status"], parsed.status, actor.role);
      }

      const next = {
        locationId: parsed.locationId || reservation.locationId,
        periodStart: parsed.periodStart || reservation.periodStart,
        periodEnd: parsed.periodEnd || reservation.periodEnd,
        status: parsed.status || reservation.status
      };
      const capacityChanged = next.locationId !== reservation.locationId || next.periodStart.getTime() !== reservation.periodStart.getTime() || next.periodEnd.getTime() !== reservation.periodEnd.getTime() || next.status !== reservation.status || parsed.status === "HOLD" || parsed.status === "RESERVED";
      if (capacityChanged) await assertCanonicalReservationAvailabilityForWrite(tx, next.locationId, next.periodStart, next.periodEnd, next.status, reservation.id, validatedIds);

      prepared.push({
        reservation,
        rentalContext,
        nextStatusForClient,
        ownershipPatch
      });
    }

    for (const [itemIndex, item] of prepared.entries()) {
      const rowInput = groupShares ? { ...parsed, amount: groupShares[itemIndex], monthlyRentShare: groupShares[itemIndex] } : parsed;
      if (item.reservation.status !== "BOOKED" || isCommercialReservationPatch(rowInput)) {
        assertBookedPrice(item.nextStatusForClient, proposedReservationRent(rowInput, item.reservation));
      }
      assertConfirmedTermsCorrection(rowInput, item.reservation, item.nextStatusForClient, actor);
      const patchData = reservationPatchData(rowInput, item.rentalContext, item.nextStatusForClient, item.reservation);
      if (parsed.productionNotes !== undefined) {
        patchData.productionNotes = splitDecorationCostForGroup(
          parsed.productionNotes,
          prepared.length,
          itemIndex
        );
      }
      const updatedReservation = await tx.reservation.update({
        where: { id: item.reservation.id },
        data: {
          ...patchData,
          updatedAt: new Date(Math.max(Date.now(), item.reservation.updatedAt.getTime() + 1)),
          ...(item.rentalContext && (item.reservation.status !== "BOOKED" || (parsed.clientId !== undefined && parsed.clientId !== item.reservation.clientId) || (parsed.campaignId !== undefined && parsed.campaignId !== item.reservation.campaignId))
            ? {
                clientId: item.rentalContext.client.id,
                campaignId: item.rentalContext.campaign.id,
                clientName: item.rentalContext.client.companyName,
                clientCompany: item.rentalContext.client.companyName,
                clientEmail: item.rentalContext.client.generalEmail,
                clientPhone: item.rentalContext.client.generalPhone,
                campaignName: item.rentalContext.campaign.campaignName,
                contractCompany: normalizeCompanyEntity(item.rentalContext.campaign.companyEntity) || item.reservation.contractCompany
              }
            : {}),
          ...item.ownershipPatch,
          ...(parsed.status ? reservationLifecycleData(parsed.status, item.reservation.bookedAt) : {})
        },
        include: reservationInclude
      });

      if (item.nextStatusForClient === "BOOKED") {
        await synchronizeReservationPriceHistory(tx, item.reservation, updatedReservation, rowInput, actor);
      }

      await logRentalCorrection(tx, item.reservation, updatedReservation, actor?.id || null);
      await logConfirmedTermsCorrection(tx, rowInput, item.reservation, updatedReservation, actor);
    }
    if (campaignCommercialSummaryAffected(parsed)) {
      const affectedCampaignIds = new Set(
        prepared
          .flatMap((item) => [item.reservation.campaignId, item.rentalContext?.campaign.id])
          .filter((campaignId): campaignId is string => Boolean(campaignId))
      );
      for (const campaignId of [...affectedCampaignIds].sort()) {
        await syncCampaignCommercialSummary(tx, campaignId);
      }
    }

    await recordTransactionalAudit(tx, { actor, action: "reservation.group_update.committed", entityType: "reservation", entityId: id, metadata: { reservationIds: validatedIds } });
    return tx.reservation.findMany({
      where: { id: { in: validatedIds } },
      include: reservationInclude,
      orderBy: [{ createdAt: "asc" }]
    });
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function updateReservationProductionNotes(id: string, productionNotes: string, actor?: AuthSession | null): Promise<ReservationDTO> {
  return prisma.$transaction((tx) => updateReservationProductionNotesWithClient(tx, id, productionNotes, actor), reservationUpdateTransactionOptions);
}

export async function updateReservationProductionNotesWithClient(
  client: ReservationDbClient,
  id: string,
  productionNotes: string,
  actor?: AuthSession | null
): Promise<ReservationDTO> {
  if (client === prisma) return updateReservationProductionNotes(id, productionNotes, actor);
  const existing = await client.reservation.findUniqueOrThrow({
    where: { id },
    include: { client: { select: { accountOwnerUserId: true } } }
  });
  assertReservationOwnership(existing, actor);
  const reservation = await client.reservation.update({
    where: { id },
    data: { productionNotes },
    include: reservationInclude
  });
  await recordTransactionalAudit(client, { actor, action: "reservation.production_notes.committed", entityType: "reservation", entityId: id });
  return serializeReservation(reservation);
}

/** Append operational context only; every group member is authorized and audited atomically. */
export async function appendReservationGroupProductionNote(id: string, note: string, actor: AuthSession) {
  const line = z.string().trim().min(1).max(4000).parse(note);
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    for (const reservation of reservations) {
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { productionNotes: appendReservationNote(reservation.productionNotes, line) }
      });
    }
    const ids = reservations.map((reservation) => reservation.id);
    await recordTransactionalAudit(tx, { actor, action: "reservation.group_production_note.committed", entityType: "reservation", entityId: id, metadata: { reservationIds: ids } });
    return refreshedReservationsByIds(tx, ids);
  }, reservationUpdateTransactionOptions);
  return updated.map(serializeReservation);
}

export async function deleteReservation(id: string, actor?: AuthSession | null, expectedUpdatedAt?: string) {
  await prisma.$transaction(async (tx) => {
    const existing = (await loadLockedReservationGroupForCommand(tx, id, actor)).find((row) => row.id === id)!;
    assertReservationVersion(existing, expectedUpdatedAt, Boolean(actor));
    await tx.reservation.update({ where: { id }, data: { status: "CANCELLED", holdExpiresAt: null } });
    if (existing.campaignId) await syncCampaignCommercialSummary(tx, existing.campaignId);
    await recordTransactionalAudit(tx, { actor, action: "reservation.cancel.committed", entityType: "reservation", entityId: id });
  }, reservationUpdateTransactionOptions);
}

export async function extendReservationHold(id: string, days: number, actor?: AuthSession | null) {
  await expireStaleHolds();
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    assertAllStatuses(reservations, ["HOLD", "RESERVED"], "Poti prelungi doar holduri active.");
    assertNoPlannedReservationConflicts(reservations);
    for (const reservation of reservations) {
      await assertCanonicalReservationAvailabilityForWrite(tx, reservation.locationId, reservation.periodStart, reservation.periodEnd, "RESERVED", reservation.id, reservations.map((row) => row.id));
    }
    await tx.reservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: {
        status: "RESERVED",
        bookedAt: null,
        holdExpiresAt: expiresAt
      }
    });
    await recordTransactionalAudit(tx, { actor, action: "reservation.hold_extend.committed", entityType: "reservation", metadata: { reservationIds: reservations.map((row) => row.id) } });
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function releaseReservationHold(id: string, actor?: AuthSession | null) {
  await expireStaleHolds();
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    assertAllStatuses(reservations, ["HOLD", "RESERVED"], "Poti elibera doar holduri active.");
    for (const reservation of reservations) {
      if (actor) assertReservationTransition(reservation.status as ReservationDTO["status"], "CANCELLED", actor.role);
    }
    await tx.reservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: { status: "CANCELLED", holdExpiresAt: null, neutralizationDate: null }
    });
    await recordTransactionalAudit(tx, { actor, action: "reservation.hold_release.committed", entityType: "reservation", metadata: { reservationIds: reservations.map((row) => row.id) } });
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function markReservationHoldLost(id: string, note: string | undefined, actor?: AuthSession | null) {
  await expireStaleHolds();
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    assertAllStatuses(reservations, ["HOLD", "RESERVED"], "Poti marca pierdut doar un hold activ.");
    for (const reservation of reservations) {
      if (actor) assertReservationTransition(reservation.status as ReservationDTO["status"], "CANCELLED", actor.role);
    }
    for (const reservation of reservations) {
      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: "CANCELLED",
          holdExpiresAt: null,
          neutralizationDate: null,
          notes: appendReservationNote(reservation.notes, note || "Marcat ca pierdut din command center.")
        }
      });
    }
    await recordTransactionalAudit(tx, { actor, action: "reservation.hold_lost.committed", entityType: "reservation", metadata: { reservationIds: reservations.map((row) => row.id) } });
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function assignReservationSeller(id: string, sellerUserId: string, actor?: AuthSession | null) {
  assertSellerReassignmentAllowed(actor);
  const seller = await loadAssignableSeller(sellerUserId);

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadLockedReservationGroupForCommand(tx, id, actor);
    const ids = reservations.map((reservation) => reservation.id);
    await assignReservationRowsSeller(tx, ids, seller);
    await recordTransactionalAudit(tx, { actor, action: "reservation.seller_assign.committed", entityType: "reservation", metadata: { reservationIds: reservations.map((row) => row.id) } });
    return refreshedReservationsByIds(tx, ids);
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

export async function assignReservationsSeller(ids: string[], sellerUserId: string, actor?: AuthSession | null) {
  assertSellerReassignmentAllowed(actor);
  const reservationIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!reservationIds.length) throw new Error("Alege cel putin o rezervare pentru realocare.");
  const seller = await loadAssignableSeller(sellerUserId);

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await tx.reservation.findMany({ where: { id: { in: reservationIds } } });
    if (reservations.length !== reservationIds.length) {
      throw new Error("Una dintre rezervarile selectate nu mai exista.");
    }
    for (const reservation of reservations) assertReservationOwnership(reservation, actor);
    await assignReservationRowsSeller(tx, reservationIds, seller);
    await recordTransactionalAudit(tx, { actor, action: "reservation.sellers_assign.committed", entityType: "reservation", metadata: { reservationIds: reservations.map((row) => row.id) } });
    return refreshedReservationsByIds(tx, reservationIds);
  }, reservationUpdateTransactionOptions);

  return updated.map(serializeReservation);
}

function assertSellerReassignmentAllowed(actor?: AuthSession | null) {
  if (!actor || !["COO", "SUPER_ADMIN"].includes(actor.role)) {
    throw new Error("Doar COO sau SUPER_ADMIN pot realoca vanzatorul.");
  }
}

async function loadAssignableSeller(sellerUserId: string) {
  const seller = await prisma.user.findFirst({
    where: { id: sellerUserId, active: true, role: { in: [...SELLER_CAPABLE_ROLES] } },
    select: { id: true, name: true }
  });
  if (!seller) throw new Error("Vanzatorul ales nu este valid.");
  return seller;
}

async function assignReservationRowsSeller(
  tx: Prisma.TransactionClient,
  ids: string[],
  seller: { id: string; name: string | null }
) {
  await tx.reservation.updateMany({
    where: { id: { in: ids } },
    data: { sellerUserId: seller.id, ownerId: seller.id, salesperson: seller.name }
  });
}

async function loadReservationGroupForCommand(tx: Prisma.TransactionClient, id: string, actor?: AuthSession | null) {
  const include = { client: { select: { accountOwnerUserId: true } } } as const;
  const anchor = await tx.reservation.findUniqueOrThrow({ where: { id }, include });
  assertReservationOwnership(anchor, actor);
  const reservations = anchor.contractGroupId
    ? await tx.reservation.findMany({ where: { contractGroupId: anchor.contractGroupId }, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
    : [anchor];
  if (!reservations.length) throw new Error("Rezervarea nu exista.");
  for (const reservation of reservations) assertReservationOwnership(reservation, actor);
  return reservations;
}

function concurrentReservationChange() {
  return new ReservationConflictError();
}

async function lockReservationRowsForWrite(tx: Prisma.TransactionClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return;
  await tx.$queryRaw`
    SELECT id FROM portfolio_reservations
    WHERE id IN (${Prisma.join(uniqueIds)}) ORDER BY id FOR UPDATE
  `;
}

async function loadLockedReservationGroupForCommand(
  tx: Prisma.TransactionClient,
  id: string,
  actor?: AuthSession | null,
  additionalLocationIds: string[] = []
) {
  const before = await loadReservationGroupForCommand(tx, id, actor);
  await lockReservationLocationsForWrite(tx, [...before.map((row) => row.locationId), ...additionalLocationIds]);
  await lockReservationRowsForWrite(tx, before.map((row) => row.id));
  const fresh = await loadReservationGroupForCommand(tx, id, actor);
  const previous = new Map(before.map((row) => [row.id, row]));
  if (fresh.length !== before.length || fresh.some((row) => {
    const old = previous.get(row.id);
    return !old || old.locationId !== row.locationId || old.contractGroupId !== row.contractGroupId;
  })) throw concurrentReservationChange();
  return fresh;
}

function assertGroupIdUnchanged(
  input: { contractGroupId?: string | null },
  existing: { contractGroupId: string | null }
) {
  if (input.contractGroupId !== undefined && input.contractGroupId !== existing.contractGroupId) {
    throw new ReservationPermissionError("Apartenenta la grup nu poate fi modificata prin editarea rezervarii.");
  }
}

function assertBookedPrice(status: string, amount: number | null | undefined) {
  if (status === "BOOKED" && (amount == null || !Number.isFinite(amount) || amount <= 0)) {
    throw new Error("Inchirierea confirmata necesita o chirie lunara mai mare decat zero pentru fiecare amplasament.");
  }
}

function proposedReservationRent(
  input: { amount?: number | null; monthlyRentShare?: number | null; monthlyRentTotal?: number | null },
  existing: { amount: number | null; monthlyRentShare: number | null; monthlyRentTotal: number | null }
) {
  if (input.amount != null) return input.amount;
  if (input.monthlyRentShare != null) return input.monthlyRentShare;
  if (input.monthlyRentTotal != null) return input.monthlyRentTotal;
  if ([input.amount, input.monthlyRentShare, input.monthlyRentTotal].some((value) => value === null)) {
    return (input.amount === undefined ? existing.amount : input.amount)
      ?? (input.monthlyRentShare === undefined ? existing.monthlyRentShare : input.monthlyRentShare)
      ?? (input.monthlyRentTotal === undefined ? existing.monthlyRentTotal : input.monthlyRentTotal);
  }
  return existing.amount ?? existing.monthlyRentShare ?? existing.monthlyRentTotal;
}

function isCommercialReservationPatch(input: ReturnType<typeof reservationPatchSchema.parse>) {
  return ["status", "locationId", "clientId", "campaignId", "periodStart", "periodEnd", "amount", "monthlyRentShare", "monthlyRentTotal", "currency", "paymentTermType", "paymentTermDays", "billingRule", "billingFrequency"]
    .some((key) => input[key as keyof typeof input] !== undefined);
}

function assertNoPlannedReservationConflicts(rows: Array<{
  id: string; locationId: string; periodStart: Date; periodEnd: Date; status: string;
}>) {
  const active = rows.filter((row) => activeReservationStatuses.includes(row.status as never));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].locationId === active[j].locationId && bookingPeriodsConflict(
        active[i].periodStart, active[i].periodEnd, active[j].periodStart, active[j].periodEnd
      )) {
        throw new Error("Modificarile propuse ar crea rezervari suprapuse in acelasi grup si pe aceeasi locatie.");
      }
    }
  }
}

function assertAllStatuses(
  reservations: Array<{ status: string }>,
  allowedStatuses: readonly string[],
  message: string
) {
  if (reservations.some((reservation) => !allowedStatuses.includes(reservation.status))) {
    throw new Error(message);
  }
}

async function refreshedReservationsByIds(tx: Prisma.TransactionClient, ids: string[]) {
  return tx.reservation.findMany({
    where: { id: { in: ids } },
    include: reservationInclude,
    orderBy: [{ createdAt: "asc" }]
  });
}

function appendReservationNote(current: string | null | undefined, note?: string) {
  if (!note) return current || null;
  const line = `[${new Date().toISOString().slice(0, 10)}] ${note}`;
  return current ? `${current}\n${line}` : line;
}

function assertReservationOwnership(
  reservation: {
    ownerId: string | null;
    sellerUserId?: string | null;
    salesperson: string | null;
    clientAccountOwnerUserId?: string | null;
    client?: { accountOwnerUserId: string | null } | null;
  },
  actor?: AuthSession | null
) {
  if (!actor || actor.role !== "SALES_AGENT") return;
  const legacyOwner = [actor.name, actor.email].includes(reservation.salesperson || "");
  const clientOwnerUserId = reservation.clientAccountOwnerUserId ?? reservation.client?.accountOwnerUserId ?? null;
  if (
    reservation.sellerUserId !== actor.id &&
    reservation.ownerId !== actor.id &&
    clientOwnerUserId !== actor.id &&
    !(reservation.ownerId == null && legacyOwner)
  ) {
    throw new ReservationPermissionError("Poti modifica doar rezervarile si inchirierile proprii.");
  }
}

function assertHoldHasClientName(status: string, clientName: string | null | undefined) {
  if (status === "BOOKED") return;
  if (!clientName?.trim()) {
    throw new Error("Pentru hold/rezervare temporara trebuie completat numele clientului.");
  }
}

type RentalContext = Awaited<ReturnType<typeof resolveRentalContext>>;

async function resolveRentalContext(input: ReturnType<typeof reservationInputSchema.parse>) {
  if (input.status !== "BOOKED") return null;
  if (!input.clientId) {
    throw new Error("Inchirierea trebuie legata de un client existent. Nu se accepta client scris manual.");
  }
  if (!input.campaignId) {
    throw new Error("Inchirierea trebuie legata de o campanie existenta.");
  }
  return loadAndValidateRentalContext(input.clientId, input.campaignId);
}

async function resolveRentalContextForUpdate(
  input: ReturnType<typeof reservationPatchSchema.parse>,
  existing: {
    clientId: string | null;
    campaignId: string | null;
    status: string;
  },
  client: ReservationDbClient = prisma,
  cache?: Map<string, ReturnType<typeof loadAndValidateRentalContext>>,
  actor?: AuthSession | null
) {
  const nextStatus = input.status || existing.status;
  if (nextStatus !== "BOOKED") return null;
  if (existing.status === "BOOKED" && !isCommercialReservationPatch(input)) return null;
  const clientId = input.clientId === undefined ? existing.clientId : input.clientId;
  const campaignId = input.campaignId === undefined ? existing.campaignId : input.campaignId;
  if (!clientId || !campaignId) {
    throw new Error("Transformarea in inchiriere cere client si campanie reale.");
  }
  const cacheKey = `${clientId}:${campaignId}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const context = loadAndValidateRentalContext(clientId, campaignId, client, actor);
  cache?.set(cacheKey, context);
  return context;
}

async function loadAndValidateRentalContext(
  clientId: string,
  campaignId: string,
  db: ReservationDbClient = prisma,
  actor?: AuthSession | null
) {
  if (db !== prisma) {
    await db.$queryRaw`SELECT id FROM portfolio_campaigns WHERE id = ${campaignId} FOR UPDATE`;
  }
  const readContext = () => Promise.all([
    db.clientAccount.findUnique({ where: { id: clientId } }),
    db.campaign.findUnique({ where: { id: campaignId } })
  ]);
  // A transaction that loses its connection must fail as a unit. Only retry
  // the standalone validation reads used before creating the reservation.
  const [clientAccount, campaign] = await (db === prisma
    ? retryClosedConnectionRead(readContext)
    : readContext());
  if (actor?.role === "SALES_AGENT" && (
    clientAccount?.accountOwnerUserId !== actor.id ||
    !campaign || ![campaign.accountOwnerUserId, campaign.sellerUserId].includes(actor.id)
  )) {
    throw new ReservationPermissionError("Clientul sau campania nu este disponibil in portofoliul tau.");
  }
  if (!clientAccount || ["archived", "merged"].includes(clientAccount.status)) {
    throw new Error("Clientul selectat nu exista sau este arhivat.");
  }
  if (!campaign || campaign.archivedAt || campaign.status === "archived") {
    throw new Error("Campania selectata nu exista sau este arhivata.");
  }
  if (campaign.clientId !== clientAccount.id) {
    throw new Error("Campania selectata nu apartine clientului ales.");
  }
  return { client: clientAccount, campaign };
}

function matchesActorSeller(value: string | null | undefined, actor?: AuthSession | null) {
  if (!actor || !value) return false;
  return [actor.id, actor.name, actor.email].includes(value);
}

async function resolveCreateSeller(
  input: ReturnType<typeof reservationInputSchema.parse>,
  actor?: AuthSession | null
) {
  const explicitOwner = Boolean(actor && input.ownerId && input.ownerId !== actor.id);
  const explicitSellerId = Boolean(actor && input.sellerUserId && input.sellerUserId !== actor.id);
  const explicitSeller = Boolean(input.salesperson && !matchesActorSeller(input.salesperson, actor));
  return resolveSellerForMutation({
    actor,
    sellerUserId: input.sellerUserId || input.ownerId || null,
    legacySalesperson: explicitOwner || explicitSellerId || explicitSeller ? input.salesperson : null
  });
}

async function resolveUpdateSeller(
  input: ReturnType<typeof reservationPatchSchema.parse>,
  existing: { ownerId: string | null; sellerUserId: string | null; salesperson: string | null },
  actor?: AuthSession | null,
  db: ReservationDbClient = prisma
): Promise<SellerPatch> {
  if (!actor) return {};
  const touchesSeller = input.ownerId !== undefined || input.sellerUserId !== undefined || input.salesperson !== undefined;
  if (!touchesSeller) return {};
  const sellerUnchanged =
    (input.ownerId === undefined || input.ownerId === existing.ownerId) &&
    (input.sellerUserId === undefined || input.sellerUserId === existing.sellerUserId) &&
    (input.salesperson === undefined || input.salesperson === existing.salesperson);
  if (sellerUnchanged) return {};

  return resolveSellerForMutation({
    actor,
    sellerUserId: input.sellerUserId || input.ownerId || null,
    legacySalesperson: input.salesperson || null,
    existingSellerUserId: existing.sellerUserId,
    existingOwnerId: existing.ownerId,
    existingSalesperson: existing.salesperson,
    db
  });
}

export async function lockReservationLocationsForWrite(tx: Prisma.TransactionClient, locationIds: string[]) {
  const uniqueIds = [...new Set(locationIds.filter(Boolean))].sort();
  if (!uniqueIds.length) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM portfolio_locations
    WHERE id IN (${Prisma.join(uniqueIds)})
    ORDER BY id
    FOR UPDATE
  `;
  if (rows.length !== uniqueIds.length) {
    throw new Error("Una dintre locatiile selectate nu mai exista.");
  }
}

export async function assertCanonicalReservationAvailabilityForWrite(
  client: ReservationDbClient,
  locationId: string,
  periodStart: Date,
  periodEnd: Date,
  status: string,
  ignoreId?: string,
  ignoreIds: string[] = []
) {
  if (periodStart > periodEnd) {
    throw new Error("Perioada rezervarii nu este valida.");
  }

  if (!activeReservationStatuses.includes(status as never)) return;

  // Every caller already holds the sorted location locks. Capacity writers use
  // the same location -> profile order, so neither model can race the other.
  const profiles = await client.$queryRaw<Array<{ id: string }>>`SELECT id FROM portfolio_dooh_profiles WHERE locationId = ${locationId} FOR UPDATE`;
  const medium = await client.location.findUnique({ where: { id: locationId }, select: { type: true } });
  if (profiles.length || isDigitalLocationType(medium?.type)) {
    throw Object.assign(new Error("Amplasamentul digital se aloca exclusiv prin capacitatea DOOH; rezervarile statice noi sau modificarile de perioada/status nu sunt permise. Istoricul poate fi adnotat sau anulat."), { code: "DOOH_CAPACITY_MANAGED", status: 409 });
  }

  const batch = await loadAvailabilityDecisions({
    locationIds: [locationId],
    periodStart,
    periodEnd,
    ignoreReservationId: ignoreId,
    ignoreReservationIds: ignoreIds,
    requireOverrideStorage: true,
    db: client
  });
  const location = batch.locationsById.get(locationId);
  if (!location) throw new Error("Locatia selectata nu mai exista.");
  const availability = batch.decisionsByLocationId[locationId];
  if (availability?.isBookable) return;

  emitStructuredLog("warn", "reservation_conflict", {
    operation: "reservation.availability_recheck",
    entityType: "location",
    entityId: locationId,
    errorCode: availability?.lifecycleReason || availability?.reasons[0]?.code || "RESERVATION_CONFLICT",
    metrics: { conflictCount: availability?.conflictingIntervals.length || 0 }
  });

  if (availability?.lifecycleReason === "LOCATION_MAINTENANCE") {
    throw new Error(`Locatia ${location.code} este in mentenanta si nu poate fi rezervata.`);
  }
  if (availability?.lifecycleReason === "LOCATION_INACTIVE") {
    throw new Error(`Locatia ${location.code} este inactiva si nu poate fi rezervata.`);
  }
  if (availability?.lifecycleReason === "LOCATION_ARCHIVED") {
    throw new Error(`Locatia ${location.code} este arhivata si nu poate fi rezervata.`);
  }

  const conflict = availability?.conflictingIntervals[0];
  if (conflict?.source === "RESERVATION") {
    throw new Error(
      `Locatia ${location.code} are deja o rezervare in perioada ${formatDate(conflict.from)} - ${formatDate(conflict.to)}.`
    );
  }
  if (conflict) {
    throw new Error(
      `Locatia ${location.code} este blocata in perioada ${formatDate(conflict.from)} - ${formatDate(conflict.to)}.`
    );
  }
  throw new Error(`Disponibilitatea locatiei ${location.code} nu a putut fi confirmata.`);
}

function normalizeReservationInput<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" && !value.trim() ? null : value])
  ) as T;
}

function campaignCommercialSummaryAffected(input: ReturnType<typeof reservationPatchSchema.parse>) {
  return [
    "campaignId",
    "status",
    "periodStart",
    "periodEnd",
    "amount",
    "monthlyRentShare",
    "monthlyRentTotal",
    "currency"
  ].some((field) => input[field as keyof typeof input] !== undefined);
}

type BookingTerms = { currency?: string | null; paymentTermType?: string | null; paymentTermDays?: number | null; billingRule?: string | null; billingFrequency?: string | null };
function validatedBookingTerms(input: BookingTerms, campaign: BookingTerms) {
  const currency = input.currency || campaign.currency;
  const paymentTermType = input.paymentTermType || campaign.paymentTermType;
  const fixedDays: Record<string, number> = { advance: 0, "7_days": 7, "15_days": 15, "30_days": 30, "45_days": 45 };
  // Choosing a named term explicitly determines its number of days. A changed
  // term must not inherit the previous campaign's contradictory number.
  const inheritedDays = input.paymentTermType && input.paymentTermType !== campaign.paymentTermType ? null : campaign.paymentTermDays;
  const days = input.paymentTermDays ?? inheritedDays ?? fixedDays[paymentTermType || ""];
  const billingRule = input.billingRule || campaign.billingRule;
  const billingFrequency = input.billingFrequency || campaign.billingFrequency;
  if (!["RON", "EUR"].includes(currency || "") || !paymentTermType || !paymentTermOptions.includes(paymentTermType as never) || days == null || !Number.isInteger(days) || days < 0 || days > 3650 ||
      (fixedDays[paymentTermType] !== undefined && days !== fixedDays[paymentTermType]) ||
      !billingRule || !billingRules.includes(billingRule as never) || !billingFrequency || !billingFrequencies.includes(billingFrequency as never)) {
    throw new Error("Confirmarea cere moneda, termenul de plată în zile, regula și frecvența de facturare stabilite explicit în contract sau campanie. Nu se aplică automat 30 de zile ori facturare lunară.");
  }
  return { currency: currency!, paymentTermType, paymentTermDays: days, billingRule, billingFrequency };
}

function withValidatedBookingTerms<T extends ReturnType<typeof reservationInputSchema.parse>>(input: T, rentalContext: RentalContext) {
  if (input.status !== "BOOKED") return input;
  assertConfirmedContractEntity(input, rentalContext?.campaign || {});
  return { ...input, ...validatedBookingTerms(input, rentalContext?.campaign || {}), invoiceGenerationMode: input.invoiceGenerationMode || "manual" };
}

function assertConfirmedContractEntity(input: { contractCompany?: string | null }, campaign: { companyEntity?: string | null }) {
  const entity = normalizeCompanyEntity(campaign.companyEntity);
  if (!entity) throw new Error("Confirmarea cere firma contractantă validată în dosarul campaniei. Completează firma campaniei înainte de închiriere.");
  if (input.contractCompany && normalizeCompanyEntity(input.contractCompany) !== entity) throw new Error("Firma contractului trebuie să corespundă firmei validate în dosarul campaniei. Verifică documentul și campania înainte de confirmare.");
}

function assertConfirmedTermsCorrection(input: ReturnType<typeof reservationPatchSchema.parse>, existing: BookingTerms & { status: string; periodStart: Date }, nextStatus: string, actor?: AuthSession | null) {
  if (existing.status !== "BOOKED" || nextStatus !== "BOOKED" || !["paymentTermType", "paymentTermDays", "billingRule", "billingFrequency"].some((field) => input[field as keyof BookingTerms] !== undefined && input[field as keyof BookingTerms] !== existing[field as keyof BookingTerms])) return;
  assertReservationInitialStatus("BOOKED", actor?.role);
  if (input.amendmentMode !== "correction" || !input.amendmentReference || input.amendmentEffectiveDate?.getTime() !== existing.periodStart.getTime()) {
    throw new Error("Corectarea termenilor de plată sau facturare confirmați cere o corecție documentată de la prima zi a contractului. Pentru termeni noi de la altă dată, folosește o perioadă contractuală distinctă.");
  }
  validatedBookingTerms({ ...existing, ...input }, {});
}

async function logConfirmedTermsCorrection(tx: Prisma.TransactionClient, input: ReturnType<typeof reservationPatchSchema.parse>, previous: BookingTerms & { status: string; id: string }, next: BookingTerms & { status: string }, actor?: AuthSession | null) {
  const fields = ["paymentTermType", "paymentTermDays", "billingRule", "billingFrequency"] as const;
  if (previous.status !== "BOOKED" || next.status !== "BOOKED" || !fields.some((field) => previous[field] !== next[field])) return;
  await recordTransactionalAudit(tx, { actor, action: "reservation.billing_terms.corrected", entityType: "reservation", entityId: previous.id,
    metadata: { reference: input.amendmentReference, effectiveDate: input.amendmentEffectiveDate?.toISOString(), previous: Object.fromEntries(fields.map((field) => [field, previous[field]])), next: Object.fromEntries(fields.map((field) => [field, next[field]])) } });
}

function selectedLocationIds(input: { locationId?: string | null; locationIds?: string[] | null }) {
  const rawIds = input.locationIds?.length ? input.locationIds : input.locationId ? [input.locationId] : [];
  return [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
}

function baseReservationData(input: ReturnType<typeof reservationInputSchema.parse>, rentalContext: RentalContext) {
  const {
    locationId,
    locationIds,
    clientId,
    campaignId,
    amount,
    monthlyRentTotal,
    monthlyRentShare,
    contractGroupId,
    cancellationReason,
    ...reservationData
  } = input;
  void locationId;
  void locationIds;
  void clientId;
  void campaignId;
  void amount;
  void monthlyRentTotal;
  void monthlyRentShare;
  void contractGroupId;
  void cancellationReason;
  if (!rentalContext) {
    const normalizedContractCompany = reservationData.contractCompany ? companyEntityOrThrow(reservationData.contractCompany) : null;
    return {
      ...reservationData,
      contractCompany: normalizedContractCompany,
      clientName: reservationData.clientName || "Client hold",
      clientCompany: reservationData.clientCompany || null,
      campaignName: reservationData.campaignName || null,
      invoiceGenerationMode: "manual"
    };
  }
  return {
    ...reservationData,
    neutralizationDate: reservationData.neutralizationDate || reservationData.periodEnd,
    clientName: rentalContext.client.companyName,
    clientCompany: rentalContext.client.companyName,
    clientEmail: rentalContext.client.generalEmail,
    clientPhone: rentalContext.client.generalPhone,
    campaignName: rentalContext.campaign.campaignName,
    contractCompany: normalizeCompanyEntity(rentalContext.campaign.companyEntity) || null,
    currency: reservationData.currency,
    paymentTermType: reservationData.paymentTermType,
    paymentTermDays: reservationData.paymentTermDays,
    billingRule: reservationData.billingRule,
    billingFrequency: reservationData.billingFrequency,
    invoiceGenerationMode: "manual"
  };
}

function reservationPatchData(
  input: ReturnType<typeof reservationPatchSchema.parse>,
  rentalContext: Awaited<ReturnType<typeof resolveRentalContextForUpdate>>,
  nextStatus: string,
  existing: {
    status: string; periodEnd: Date; neutralizationDate: Date | null; contractCompany: string | null;
    currency: string | null; paymentTermType: string | null; paymentTermDays: number | null;
    billingRule: string | null; billingFrequency: string | null;
  }
) {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  // The cancellation reason is audit context, not a Reservation column.
  // It is appended to notes below and must never reach Prisma's update payload.
  delete data.cancellationReason;
  for (const field of ["expectedUpdatedAt", "expectedVersions", "amendmentEffectiveDate", "amendmentReference", "amendmentMode", "groupRentShares"]) delete data[field];
  // Group membership changes need their own authorized command; never a free-form patch.
  delete data.contractGroupId;
  for (const key of ["locationId", "clientName", "status", "periodStart", "periodEnd"]) {
    if (data[key] == null) delete data[key];
  }
  if (nextStatus === "BOOKED") {
    delete data.contractCompany;
    delete data.clientName;
    delete data.clientCompany;
    delete data.clientEmail;
    delete data.clientPhone;
    delete data.campaignName;
    if (rentalContext && existing.status !== "BOOKED") {
      assertConfirmedContractEntity({ contractCompany: input.contractCompany ?? existing.contractCompany }, rentalContext.campaign);
      Object.assign(data, validatedBookingTerms({
        currency: input.currency ?? existing.currency,
        paymentTermType: input.paymentTermType ?? existing.paymentTermType,
        paymentTermDays: input.paymentTermDays ?? existing.paymentTermDays,
        billingRule: input.billingRule ?? existing.billingRule,
        billingFrequency: input.billingFrequency ?? existing.billingFrequency
      }, rentalContext.campaign));
    }

    if (input.neutralizationDate === undefined && (input.periodEnd !== undefined || !existing.neutralizationDate)) {
      data.neutralizationDate = input.periodEnd || existing.periodEnd;
    }
  } else if (input.contractCompany !== undefined) {
    data.contractCompany = input.contractCompany ? companyEntityOrThrow(input.contractCompany) : null;
  }
  if (["CANCELLED", "EXPIRED"].includes(nextStatus)) {
    data.neutralizationDate = null;
  }
  data.invoiceGenerationMode = "manual";
  return data;
}

type PriceHistoryReservation = {
  id: string; status: string; periodStart: Date; periodEnd: Date; currency: string | null; updatedAt: Date; contractGroupId: string | null;
  amount: number | null; monthlyRentShare: number | null; monthlyRentTotal: number | null;
};

async function synchronizeReservationPriceHistory(
  tx: Prisma.TransactionClient,
  previous: PriceHistoryReservation,
  next: PriceHistoryReservation,
  input: ReturnType<typeof reservationPatchSchema.parse>,
  actor?: AuthSession | null
) {
  const nextRent = proposedReservationRent({}, next) ?? 0;
  if (previous.status !== "BOOKED") {
    await ensureCurrentPriceSegment(tx, next.id, next.periodStart, next.periodEnd, nextRent, next.currency || "EUR", actor?.id || null);
    return;
  }
  const priceChanged = proposedReservationRent({}, previous) !== nextRent || previous.currency !== next.currency;
  const periodChanged = previous.periodStart.getTime() !== next.periodStart.getTime() || previous.periodEnd.getTime() !== next.periodEnd.getTime();
  if (!priceChanged && !periodChanged) return;
  if (!input.amendmentEffectiveDate || !input.amendmentReference || !input.amendmentMode) {
    throw new Error("Modificarea chiriei, monedei sau perioadei confirmate cere data efectivă, referința documentului și tipul modificării.");
  }
  assertReservationInitialStatus("BOOKED", actor?.role);
  const segments = await tx.rentalPriceSegment.findMany({ where: { rentalId: next.id }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  const replacement = amendedPriceIntervals({
    previousStart: previous.periodStart, previousEnd: previous.periodEnd,
    nextStart: next.periodStart, nextEnd: next.periodEnd,
    previousRent: proposedReservationRent({}, previous) ?? 0, previousCurrency: previous.currency || "",
    nextRent, nextCurrency: next.currency || "", segments,
    effectiveFrom: input.amendmentEffectiveDate, reference: input.amendmentReference, mode: input.amendmentMode,
    changePrice: priceChanged
  });
  // Price segments are the active projection. The previous complete projection is retained
  // in the same transaction's change log, so an amendment is reconstructible and auditable.
  await tx.rentalChangeLog.create({ data: {
    rentalId: next.id, action: "contract_amendment",
    previousJson: { periodStart: previous.periodStart.toISOString(), periodEnd: previous.periodEnd.toISOString(), segments: segments.map((s) => ({ ...s, monthlyRent: s.monthlyRent.toString(), effectiveFrom: s.effectiveFrom.toISOString(), effectiveTo: s.effectiveTo?.toISOString() || null, createdAt: s.createdAt.toISOString() })) },
    nextJson: { periodStart: next.periodStart.toISOString(), periodEnd: next.periodEnd.toISOString(), effectiveDate: input.amendmentEffectiveDate.toISOString(), mode: input.amendmentMode, segments: replacement.map((s) => ({ ...s, effectiveFrom: s.effectiveFrom.toISOString(), effectiveTo: s.effectiveTo.toISOString() })) },
    note: input.amendmentReference, createdByUserId: actor?.id || null
  } });
  await tx.rentalPriceSegment.deleteMany({ where: { rentalId: next.id } });
  await tx.rentalPriceSegment.createMany({ data: replacement.map((s) => ({ ...s, rentalId: next.id, createdByUserId: actor?.id || null })) });
  const latest = replacement.at(-1)!;
  await tx.reservation.update({ where: { id: next.id }, data: { amount: latest.monthlyRent, monthlyRentShare: latest.monthlyRent, ...(!next.contractGroupId ? { monthlyRentTotal: latest.monthlyRent } : {}), currency: latest.currency, updatedAt: new Date(Math.max(Date.now(), next.updatedAt.getTime() + 1)) } });
  await recordTransactionalAudit(tx, { actor, action: "reservation.amendment.committed", entityType: "reservation", entityId: next.id, metadata: { reference: input.amendmentReference, effectiveDate: input.amendmentEffectiveDate.toISOString(), mode: input.amendmentMode } });
}

async function ensureCurrentPriceSegment(
  client: ReservationDbClient,
  rentalId: string,
  effectiveFrom: Date,
  effectiveTo: Date,
  monthlyRent: number,
  currency: string,
  actorId: string | null
) {
  const existing = await client.rentalPriceSegment.findFirst({ where: { rentalId }, orderBy: { effectiveFrom: "desc" } });
  const shouldCreate =
    !existing ||
    Number(existing.monthlyRent) !== monthlyRent ||
    existing.currency !== currency ||
    existing.effectiveFrom.getTime() !== effectiveFrom.getTime() ||
    (existing.effectiveTo?.getTime() || 0) !== effectiveTo.getTime();
  if (!shouldCreate) return;
  await client.rentalPriceSegment.create({
    data: {
      rentalId,
      effectiveFrom,
      effectiveTo,
      monthlyRent,
      currency,
      reason: "Actualizare pret/perioada inchiriere.",
      createdByUserId: actorId
    }
  });
  await client.rentalChangeLog.create({
    data: {
      rentalId,
      action: "price_or_period_update",
      nextJson: {
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: effectiveTo.toISOString(),
        monthlyRent,
        currency
      },
      createdByUserId: actorId
    }
  });
}

async function logRentalCorrection(
  client: ReservationDbClient,
  previous: {
    id: string;
    status: string;
    clientId: string | null;
    campaignId: string | null;
    clientName: string;
    campaignName: string | null;
    contractNumber: string | null;
    amount: number | null;
    monthlyRentTotal: number | null;
    monthlyRentShare: number | null;
    currency: string | null;
    periodStart: Date;
    periodEnd: Date;
    installationDate: Date | null;
    neutralizationDate: Date | null;
  },
  next: {
    id: string;
    status: string;
    clientId: string | null;
    campaignId: string | null;
    clientName: string;
    campaignName: string | null;
    contractNumber: string | null;
    amount: number | null;
    monthlyRentTotal: number | null;
    monthlyRentShare: number | null;
    currency: string | null;
    periodStart: Date;
    periodEnd: Date;
    installationDate: Date | null;
    neutralizationDate: Date | null;
  },
  actorId: string | null
) {
  if (next.status !== "BOOKED") return;
  const previousSnapshot = rentalCorrectionSnapshot(previous);
  const nextSnapshot = rentalCorrectionSnapshot(next);
  if (JSON.stringify(previousSnapshot) === JSON.stringify(nextSnapshot)) return;
  await client.rentalChangeLog.create({
    data: {
      rentalId: next.id,
      action: "rental_correction",
      previousJson: previousSnapshot,
      nextJson: nextSnapshot,
      note: "Corectie inchiriere activa din admin.",
      createdByUserId: actorId
    }
  });
}

function rentalCorrectionSnapshot(reservation: {
  clientId: string | null;
  campaignId: string | null;
  clientName: string;
  campaignName: string | null;
  contractNumber: string | null;
  amount: number | null;
  monthlyRentTotal: number | null;
  monthlyRentShare: number | null;
  currency: string | null;
  periodStart: Date;
  periodEnd: Date;
  installationDate: Date | null;
  neutralizationDate: Date | null;
}) {
  return {
    clientId: reservation.clientId,
    campaignId: reservation.campaignId,
    clientName: reservation.clientName,
    campaignName: reservation.campaignName,
    contractNumber: reservation.contractNumber,
    amount: reservation.amount,
    monthlyRentTotal: reservation.monthlyRentTotal,
    monthlyRentShare: reservation.monthlyRentShare,
    currency: reservation.currency,
    periodStart: reservation.periodStart.toISOString(),
    periodEnd: reservation.periodEnd.toISOString(),
    installationDate: reservation.installationDate?.toISOString() || null,
    neutralizationDate: reservation.neutralizationDate?.toISOString() || null
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function splitDecorationCostForGroup(
  notes: string | null | undefined,
  locationCount: number,
  locationIndex: number
) {
  const count = Math.max(1, Math.trunc(locationCount));
  const cost = operationCost(notes, "decoration");
  if (cost.cost == null || count === 1) return notes ?? null;

  const totalCents = Math.round(cost.cost * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  const share = (baseCents + (locationIndex < remainder ? 1 : 0)) / 100;
  return withOperationCost(notes, "decoration", share, cost.currency);
}

function serializeReservation(
  reservation: {
    id: string;
    locationId: string;
    clientId: string | null;
    campaignId: string | null;
    status: string;
    clientName: string;
    clientCompany: string | null;
    contractCompany: string | null;
    clientEmail: string | null;
    clientPhone: string | null;
    campaignName: string | null;
    contractNumber: string | null;
    salesperson: string | null;
    notes: string | null;
    productionNotes: string | null;
    amount: number | null;
    monthlyRentTotal: number | null;
    monthlyRentShare: number | null;
    contractGroupId: string | null;
    periodStart: Date;
    periodEnd: Date;
    installationDate: Date | null;
    neutralizationDate: Date | null;
    externalSource: string | null;
    externalId: string | null;
    bookedAt: Date | null;
    holdExpiresAt: Date | null;
    ownerId: string | null;
    sellerUserId: string | null;
    client?: { accountOwnerUserId: string | null } | null;
    currency: string | null;
    paymentTermType: string | null;
    paymentTermDays: number | null;
    customPaymentTermNote: string | null;
    billingRule: string | null;
    billingDayOfMonth: number | null;
    customBillingDate: Date | null;
    billingFrequency: string | null;
    invoiceGenerationMode: string | null;
    nextInvoiceDate: Date | null;
    billingNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    location?: { code: string; address: string | null };
    priceSegments?: Array<{
      id: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      monthlyRent: unknown;
      currency: string;
      reason: string | null;
    }>;
    changeLogs?: Array<{
      id: string;
      action: string;
      note: string | null;
      previousJson: unknown;
      nextJson: unknown;
      createdByUserId: string | null;
      createdAt: Date;
      createdBy?: { name: string } | null;
    }>;
    billingItems?: Array<{
      id: string;
      invoiceDate: Date;
      invoiceNumber: string | null;
      receivables: Array<{ id: string }>;
    }>;
    documents?: Array<{
      id: string;
      fileName: string;
      fileType: string | null;
      fileSize: number | null;
      uploadedAt: Date;
      expiryDate: Date | null;
      notes: string | null;
      status: string | null;
      uploadedBy?: { name: string } | null;
    }>;
  }
): ReservationDTO {
  const neutralizationDate =
    reservation.neutralizationDate || (reservation.status === "BOOKED" ? reservation.periodEnd : null);

  return {
    id: reservation.id,
    locationId: reservation.locationId,
    clientId: reservation.clientId,
    campaignId: reservation.campaignId,
    locationCode: reservation.location?.code,
    locationName: reservation.location?.address,
    status: reservation.status as ReservationDTO["status"],
    clientName: reservation.clientName,
    clientCompany: reservation.clientCompany,
    contractCompany: reservation.contractCompany,
    clientEmail: reservation.clientEmail,
    clientPhone: reservation.clientPhone,
    campaignName: reservation.campaignName,
    contractNumber: reservation.contractNumber,
    salesperson: reservation.salesperson,
    notes: reservation.notes,
    productionNotes: reservation.productionNotes,
    amount: reservation.amount,
    monthlyRentTotal: reservation.monthlyRentTotal,
    monthlyRentShare: reservation.monthlyRentShare,
    contractGroupId: reservation.contractGroupId,
    periodStart: reservation.periodStart.toISOString(),
    periodEnd: reservation.periodEnd.toISOString(),
    installationDate: reservation.installationDate?.toISOString() || null,
    neutralizationDate: neutralizationDate?.toISOString() || null,
    externalSource: reservation.externalSource,
    externalId: reservation.externalId,
    bookedAt: reservation.bookedAt?.toISOString() || null,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() || null,
    ownerId: reservation.ownerId,
    sellerUserId: reservation.sellerUserId || reservation.ownerId,
    clientAccountOwnerUserId: reservation.client?.accountOwnerUserId || null,
    currency: reservation.currency,
    paymentTermType: reservation.paymentTermType,
    paymentTermDays: reservation.paymentTermDays,
    customPaymentTermNote: reservation.customPaymentTermNote,
    billingRule: reservation.billingRule,
    billingDayOfMonth: reservation.billingDayOfMonth,
    customBillingDate: reservation.customBillingDate?.toISOString() || null,
    billingFrequency: reservation.billingFrequency,
    invoiceGenerationMode: reservation.invoiceGenerationMode,
    nextInvoiceDate: reservation.nextInvoiceDate?.toISOString() || null,
    billingNotes: reservation.billingNotes,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    priceSegments: reservation.priceSegments?.map((segment) => ({
      id: segment.id,
      effectiveFrom: segment.effectiveFrom.toISOString(),
      effectiveTo: segment.effectiveTo?.toISOString() || null,
      monthlyRent: Number(segment.monthlyRent || 0),
      currency: segment.currency,
      reason: segment.reason
    })),
    changeLogs: reservation.changeLogs?.map((log) => ({
      id: log.id,
      action: log.action,
      note: log.note,
      previousJson: log.previousJson,
      nextJson: log.nextJson,
      createdByUserId: log.createdByUserId,
      createdByName: log.createdBy?.name || null,
      createdAt: log.createdAt.toISOString()
    })),
    billingSummary: reservation.billingItems?.length
      ? {
          billingItemCount: reservation.billingItems.length,
          receivableCount: reservation.billingItems.reduce((total, item) => total + item.receivables.length, 0),
          latestInvoiceDate: reservation.billingItems[0]?.invoiceDate.toISOString() || null,
          latestInvoiceNumber: reservation.billingItems.find((item) => item.invoiceNumber)?.invoiceNumber || null
        }
      : undefined,
    operationProofPhotos: reservation.documents
      ?.filter(isOperationalProofActive)
      .map((document) => {
        const notes = parseOperationalProofNotes(document.notes);
        return {
          id: document.id,
          fileName: document.fileName,
          fileType: document.fileType,
          fileSize: document.fileSize,
          uploadedAt: document.uploadedAt.toISOString(),
          expiresAt: document.expiryDate?.toISOString() || null,
          uploadedByName: document.uploadedBy?.name || null,
          kind: notes?.kind || "decoration",
          taskId: notes?.taskId || null,
          downloadUrl: operationalProofDownloadPath(document.id)
        };
      })
  };
}

function parseDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const date = new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
    return date.toISOString().slice(0, 10) === text ? date : null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
