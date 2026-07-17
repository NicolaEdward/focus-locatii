import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveBlockingReservationWhere, expireStaleHolds, reservationLifecycleData } from "@/lib/reservation-lifecycle";
import type { ReservationDTO } from "@/types/location";
import type { AuthSession } from "@/lib/auth";
import { assertReservationTransition } from "@/lib/reservation-workflow";
import { resolveSellerForMutation } from "@/lib/seller-users";
import { paymentTermDays } from "@/lib/billing";
import { companyEntityOrThrow, normalizeCompanyEntity } from "@/lib/company-entities";
import { DECORATION_LOOKAHEAD_DAYS, NEUTRALIZATION_LOOKAHEAD_DAYS, OPERATION_HISTORY_DAYS } from "@/lib/operation-schedule";
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
  return Number.isInteger(parsed) ? parsed : null;
}, z.number().int().nullable().optional());

export const reservationInputSchema = z.object({
  locationId: z.string().trim().min(1).nullable().optional(),
  locationIds: z.array(z.string().trim().min(1)).nullable().optional(),
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
  locationId: z.string().trim().min(1).nullable().optional(),
  clientId: optionalText,
  campaignId: optionalText,
  status: reservationStatusSchema.optional(),
  clientName: optionalText,
  clientCompany: optionalText,
  contractCompany: optionalText,
  clientEmail: z.preprocess((value) => value === "" || value == null ? null : String(value).trim(), z.string().email("Emailul clientului nu este valid.").max(254).nullable().optional()),
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
  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  const where: Prisma.ReservationWhereInput = {
    ...(actor?.role === "SALES_AGENT"
      ? {
          OR: [
            { sellerUserId: actor.id },
            { ownerId: actor.id },
            { ownerId: null, salesperson: { in: [actor.name, actor.email] } }
          ]
        }
      : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.client
      ? {
          OR: [
            { clientName: { contains: filters.client } },
            { clientCompany: { contains: filters.client } },
            { campaignName: { contains: filters.client } }
          ]
        }
      : {}),
    ...(from || to
      ? {
          AND: [
            from ? { periodEnd: { gte: from } } : {},
            to ? { periodStart: { lte: to } } : {}
          ]
        }
      : {})
  };

  const reservationsWithSegments = await prisma.reservation.findMany({
    where,
    include: options.includeDetails === false ? reservationSummaryInclude : reservationInclude,
    orderBy: [{ bookedAt: "desc" }, { createdAt: "desc" }, { periodStart: "desc" }],
    take: 500
  });

  return reservationsWithSegments.map(serializeReservation);
}

export async function getReservation(id: string, actor?: AuthSession | null) {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id },
    include: reservationInclude
  });
  assertReservationOwnership(reservation, actor);
  return serializeReservation(reservation);
}

export async function listOperationReservations() {
  const today = startOfUtcDay(new Date());
  const windowStart = addDays(today, -OPERATION_HISTORY_DAYS);
  const decorationWindowEnd = addDays(today, DECORATION_LOOKAHEAD_DAYS);
  const neutralizationWindowEnd = addDays(today, NEUTRALIZATION_LOOKAHEAD_DAYS);

  const reservations = await prisma.reservation.findMany({
    where: {
      status: { in: [...operationalReservationStatuses] },
      OR: [
        { installationDate: { gte: windowStart, lte: decorationWindowEnd } },
        { neutralizationDate: { gte: windowStart, lte: neutralizationWindowEnd } },
        { installationDate: null, periodStart: { gte: windowStart, lte: decorationWindowEnd } },
        { neutralizationDate: null, periodEnd: { gte: windowStart, lte: neutralizationWindowEnd } },
        { periodStart: { lte: neutralizationWindowEnd }, periodEnd: { gte: windowStart } }
      ]
    },
    include: reservationOperationalInclude,
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "desc" }],
    take: 1000
  });

  return reservations.map(serializeReservation);
}

export async function createReservation(input: unknown, actor?: AuthSession | null) {
  await expireStaleHolds();
  const parsed = withBillingDefaults(normalizeReservationInput(reservationInputSchema.parse(input)));
  const seller = await resolveCreateSeller(parsed, actor);
  const rentalContext = await resolveRentalContext(parsed);
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
  const monthlyRentShare =
    monthlyRentTotal == null ? parsed.monthlyRentShare ?? null : roundMoney(monthlyRentTotal / locationIds.length);
  const contractGroupId = parsed.contractGroupId || (locationIds.length > 1 ? randomUUID() : null);
  const reservationData = baseReservationData(parsed, rentalContext);
  const lifecycleData = reservationLifecycleData(parsed.status);

  const reservations = await prisma.$transaction(async (tx) => {
    await lockReservationLocations(tx, locationIds);
    for (const locationId of locationIds) {
      await assertNoReservationConflict(tx, locationId, parsed.periodStart, parsed.periodEnd, parsed.status);
    }

    const created = [];
    for (const locationId of locationIds) {
      const reservation = await tx.reservation.create({
        data: {
          ...reservationData,
          locationId,
          clientId: rentalContext?.client.id || null,
          campaignId: rentalContext?.campaign.id || null,
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
            currency: parsed.currency || rentalContext?.campaign.currency || "EUR",
            reason: "Segment initial la creare inchiriere.",
            createdByUserId: actor?.id || null
          }
        });
        await tx.rentalChangeLog.create({
          data: {
            rentalId: reservation.id,
            action: "created",
            nextJson: {
              clientId: rentalContext?.client.id,
              campaignId: rentalContext?.campaign.id,
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
    return created;
  });

  return reservations.map(serializeReservation);
}

export async function updateReservation(id: string, input: unknown, actor?: AuthSession | null) {
  await expireStaleHolds();
  const parsed = normalizeReservationInput(reservationPatchSchema.parse(input));

  const reservation = await prisma.$transaction(async (tx) => {
    const existing = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { client: true, campaign: true } });
    assertReservationOwnership(existing, actor);
    const ownershipPatch: SellerPatch = await resolveUpdateSeller(parsed, existing, actor);
    const nextStatusForClient = parsed.status || existing.status;
    const rentalContext = await resolveRentalContextForUpdate(parsed, existing);
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
      (parsed.status !== undefined && parsed.status !== existing.status);

    if (parsed.status && actor) {
      assertReservationTransition(existing.status as ReservationDTO["status"], parsed.status, actor.role);
    }

    if (availabilityChanged) {
      await lockReservationLocations(tx, [existing.locationId, next.locationId]);
      await assertNoReservationConflict(tx, next.locationId, next.periodStart, next.periodEnd, next.status, id);
    }

    const patchData = reservationPatchData(parsed, rentalContext, nextStatusForClient, existing);
    if (parsed.status === "CANCELLED" && parsed.cancellationReason) {
      patchData.notes = appendReservationNote(existing.notes, `Anulare: ${parsed.cancellationReason}`);
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        ...patchData,
        ...(rentalContext
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

    if (nextStatusForClient === "BOOKED" && (parsed.amount !== undefined || parsed.monthlyRentShare !== undefined || parsed.monthlyRentTotal !== undefined)) {
      await ensureCurrentPriceSegment(
        tx,
        updated.id,
        updated.periodStart,
        updated.periodEnd,
        updated.amount ?? updated.monthlyRentShare ?? updated.monthlyRentTotal ?? 0,
        updated.currency || "EUR",
        actor?.id || null
      );
    }

    await logRentalCorrection(tx, existing, updated, actor?.id || null);

    return updated;
  });

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
  options: { cancellationReason?: string | null } = {}
) {
  await expireStaleHolds();
  const status = reservationStatusSchema.parse(inputStatus);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.reservation.findUniqueOrThrow({ where: { id } });
    assertReservationOwnership(existing, actor);
    const reservations = existing.contractGroupId
      ? await tx.reservation.findMany({ where: { contractGroupId: existing.contractGroupId } })
      : [existing];

    await lockReservationLocations(tx, reservations.map((reservation) => reservation.locationId));

    for (const reservation of reservations) {
      if (actor) {
        assertReservationTransition(reservation.status as ReservationDTO["status"], status, actor.role);
      }
      if (status === "BOOKED") {
        await assertExistingBookedLink(reservation.clientId, reservation.campaignId);
      }
      await assertNoReservationConflict(
        tx,
        reservation.locationId,
        reservation.periodStart,
        reservation.periodEnd,
        status,
        reservation.id
      );
    }

    const statusData = {
        status,
        ...(status === "BOOKED" ? {
          currency: existing.currency || "EUR",
          paymentTermType: existing.paymentTermType || "30_days",
          paymentTermDays: existing.paymentTermDays ?? 30,
          billingRule: existing.billingRule || "month_start",
          billingFrequency: existing.billingFrequency || "monthly",
          invoiceGenerationMode: existing.invoiceGenerationMode || "manual",
          neutralizationDate: existing.neutralizationDate || existing.periodEnd
        } : ["CANCELLED", "EXPIRED"].includes(status) ? {
          neutralizationDate: null
        } : {}),
        ...reservationLifecycleData(status, existing.bookedAt)
      };

    if (status === "CANCELLED" && options.cancellationReason) {
      for (const reservation of reservations) {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            ...statusData,
            notes: appendReservationNote(reservation.notes, `Anulare: ${options.cancellationReason}`)
          }
        });
      }
    } else {
      await tx.reservation.updateMany({
        where: existing.contractGroupId ? { contractGroupId: existing.contractGroupId } : { id },
        data: statusData
      });
    }

    return tx.reservation.findMany({
      where: existing.contractGroupId ? { contractGroupId: existing.contractGroupId } : { id },
      include: reservationInclude,
      orderBy: [{ createdAt: "asc" }]
    });
  });

  return updated.map(serializeReservation);
}

export async function updateReservationGroup(id: string, input: unknown, actor?: AuthSession | null) {
  await expireStaleHolds();
  const parsed = normalizeReservationInput(reservationPatchSchema.parse(input));

  const updated = await prisma.$transaction(async (tx) => {
    const anchor = await tx.reservation.findUniqueOrThrow({ where: { id } });
    assertReservationOwnership(anchor, actor);
    const reservations = anchor.contractGroupId
      ? await tx.reservation.findMany({ where: { contractGroupId: anchor.contractGroupId }, orderBy: [{ createdAt: "asc" }] })
      : [anchor];
    if (!reservations.length) throw new Error("Contractul nu mai exista.");

    const locationIdsToLock = reservations.flatMap((reservation) => [
      reservation.locationId,
      parsed.locationId || reservation.locationId
    ]);
    await lockReservationLocations(tx, locationIdsToLock);

    const prepared = [];
    for (const reservation of reservations) {
      assertReservationOwnership(reservation, actor);
      const ownershipPatch: SellerPatch = await resolveUpdateSeller(parsed, reservation, actor);
      const nextStatusForClient = parsed.status || reservation.status;
      const rentalContext = await resolveRentalContextForUpdate(parsed, reservation);
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
      await assertNoReservationConflict(tx, next.locationId, next.periodStart, next.periodEnd, next.status, reservation.id);

      prepared.push({
        reservation,
        rentalContext,
        nextStatusForClient,
        ownershipPatch
      });
    }

    for (const item of prepared) {
      const patchData = reservationPatchData(parsed, item.rentalContext, item.nextStatusForClient, item.reservation);
      const updatedReservation = await tx.reservation.update({
        where: { id: item.reservation.id },
        data: {
          ...patchData,
          ...(item.rentalContext
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

      if (
        item.nextStatusForClient === "BOOKED" &&
        (parsed.amount !== undefined || parsed.monthlyRentShare !== undefined || parsed.monthlyRentTotal !== undefined)
      ) {
        await ensureCurrentPriceSegment(
          tx,
          updatedReservation.id,
          updatedReservation.periodStart,
          updatedReservation.periodEnd,
          updatedReservation.amount ?? updatedReservation.monthlyRentShare ?? updatedReservation.monthlyRentTotal ?? 0,
          updatedReservation.currency || "EUR",
          actor?.id || null
        );
      }
      await logRentalCorrection(tx, item.reservation, updatedReservation, actor?.id || null);
    }

    return tx.reservation.findMany({
      where: anchor.contractGroupId ? { contractGroupId: anchor.contractGroupId } : { id },
      include: reservationInclude,
      orderBy: [{ createdAt: "asc" }]
    });
  });

  return updated.map(serializeReservation);
}

export async function updateReservationProductionNotes(id: string, productionNotes: string, actor?: AuthSession | null) {
  return updateReservationProductionNotesWithClient(prisma, id, productionNotes, actor);
}

export async function updateReservationProductionNotesWithClient(
  client: ReservationDbClient,
  id: string,
  productionNotes: string,
  actor?: AuthSession | null
) {
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
  return serializeReservation(reservation);
}

export async function deleteReservation(id: string) {
  await prisma.reservation.update({ where: { id }, data: { status: "CANCELLED", holdExpiresAt: null } });
}

export async function extendReservationHold(id: string, days: number, actor?: AuthSession | null) {
  await expireStaleHolds();
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadReservationGroupForCommand(tx, id, actor);
    assertAllStatuses(reservations, ["HOLD", "RESERVED"], "Poti prelungi doar holduri active.");
    await lockReservationLocations(tx, reservations.map((reservation) => reservation.locationId));
    for (const reservation of reservations) {
      await assertNoReservationConflict(tx, reservation.locationId, reservation.periodStart, reservation.periodEnd, "RESERVED", reservation.id);
    }
    await tx.reservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: {
        status: "RESERVED",
        bookedAt: null,
        holdExpiresAt: expiresAt
      }
    });
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  });

  return updated.map(serializeReservation);
}

export async function releaseReservationHold(id: string, actor?: AuthSession | null) {
  await expireStaleHolds();
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadReservationGroupForCommand(tx, id, actor);
    assertAllStatuses(reservations, ["HOLD", "RESERVED"], "Poti elibera doar holduri active.");
    for (const reservation of reservations) {
      if (actor) assertReservationTransition(reservation.status as ReservationDTO["status"], "CANCELLED", actor.role);
    }
    await tx.reservation.updateMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } },
      data: { status: "CANCELLED", holdExpiresAt: null, neutralizationDate: null }
    });
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  });

  return updated.map(serializeReservation);
}

export async function markReservationHoldLost(id: string, note: string | undefined, actor?: AuthSession | null) {
  await expireStaleHolds();
  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadReservationGroupForCommand(tx, id, actor);
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
    return refreshedReservationsByIds(tx, reservations.map((reservation) => reservation.id));
  });

  return updated.map(serializeReservation);
}

export async function assignReservationSeller(id: string, sellerUserId: string, actor?: AuthSession | null) {
  assertSellerReassignmentAllowed(actor);
  const seller = await loadAssignableSeller(sellerUserId);

  const updated = await prisma.$transaction(async (tx) => {
    const reservations = await loadReservationGroupForCommand(tx, id, actor);
    const ids = reservations.map((reservation) => reservation.id);
    await assignReservationRowsSeller(tx, ids, seller);
    return refreshedReservationsByIds(tx, ids);
  });

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
    return refreshedReservationsByIds(tx, reservationIds);
  });

  return updated.map(serializeReservation);
}

function assertSellerReassignmentAllowed(actor?: AuthSession | null) {
  if (!actor || !["COO", "SUPER_ADMIN"].includes(actor.role)) {
    throw new Error("Doar COO sau SUPER_ADMIN pot realoca vanzatorul.");
  }
}

async function loadAssignableSeller(sellerUserId: string) {
  const seller = await prisma.user.findFirst({
    where: { id: sellerUserId, active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
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
  const anchor = await tx.reservation.findUniqueOrThrow({ where: { id } });
  assertReservationOwnership(anchor, actor);
  const reservations = anchor.contractGroupId
    ? await tx.reservation.findMany({ where: { contractGroupId: anchor.contractGroupId }, orderBy: [{ createdAt: "asc" }] })
    : [anchor];
  if (!reservations.length) throw new Error("Rezervarea nu exista.");
  for (const reservation of reservations) assertReservationOwnership(reservation, actor);
  return reservations;
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
    throw new Error("Poti modifica doar rezervarile si inchirierile proprii.");
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
  }
) {
  const nextStatus = input.status || existing.status;
  if (nextStatus !== "BOOKED") return null;
  const clientId = input.clientId === undefined ? existing.clientId : input.clientId;
  const campaignId = input.campaignId === undefined ? existing.campaignId : input.campaignId;
  if (!clientId || !campaignId) {
    throw new Error("Transformarea in inchiriere cere client si campanie reale.");
  }
  return loadAndValidateRentalContext(clientId, campaignId);
}

async function loadAndValidateRentalContext(clientId: string, campaignId: string) {
  const [client, campaign] = await Promise.all([
    prisma.clientAccount.findUnique({ where: { id: clientId } }),
    prisma.campaign.findUnique({ where: { id: campaignId } })
  ]);
  if (!client || ["archived", "merged"].includes(client.status)) {
    throw new Error("Clientul selectat nu exista sau este arhivat.");
  }
  if (!campaign || campaign.archivedAt || campaign.status === "archived") {
    throw new Error("Campania selectata nu exista sau este arhivata.");
  }
  if (campaign.clientId !== client.id) {
    throw new Error("Campania selectata nu apartine clientului ales.");
  }
  return { client, campaign };
}

async function assertExistingBookedLink(clientId: string | null, campaignId: string | null) {
  if (!clientId || !campaignId) {
    throw new Error("Nu poti confirma hold-ul ca inchiriere fara client si campanie reale. Foloseste conversia hold -> inchiriere.");
  }
  await loadAndValidateRentalContext(clientId, campaignId);
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
  actor?: AuthSession | null
): Promise<SellerPatch> {
  if (!actor) return {};
  const touchesSeller = input.ownerId !== undefined || input.sellerUserId !== undefined || input.salesperson !== undefined;
  if (!touchesSeller) return {};

  return resolveSellerForMutation({
    actor,
    sellerUserId: input.sellerUserId || input.ownerId || null,
    legacySalesperson: input.salesperson || null,
    existingSellerUserId: existing.sellerUserId,
    existingOwnerId: existing.ownerId,
    existingSalesperson: existing.salesperson
  });
}

async function lockReservationLocations(tx: Prisma.TransactionClient, locationIds: string[]) {
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

async function assertNoReservationConflict(
  client: ReservationDbClient,
  locationId: string,
  periodStart: Date,
  periodEnd: Date,
  status: string,
  ignoreId?: string
) {
  if (periodStart > periodEnd) {
    throw new Error("Perioada rezervarii nu este valida.");
  }

  if (!activeReservationStatuses.includes(status as never)) return;

  const conflict = await client.reservation.findFirst({
    where: {
      locationId,
      ...effectiveBlockingReservationWhere(new Date()),
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart }
    },
    include: { location: { select: { code: true } } }
  });

  if (conflict) {
    throw new Error(
      `Locatia ${conflict.location.code} are deja o rezervare in perioada ${formatDate(conflict.periodStart)} - ${formatDate(conflict.periodEnd)}.`
    );
  }
}

function normalizeReservationInput<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" && !value.trim() ? null : value])
  ) as T;
}

function withBillingDefaults<T extends ReturnType<typeof reservationInputSchema.parse>>(input: T) {
  if (input.status !== "BOOKED") return input;
  return {
    ...input,
    currency: input.currency || "EUR",
    paymentTermType: input.paymentTermType || "30_days",
    paymentTermDays: paymentTermDays(input.paymentTermType || "30_days", input.paymentTermDays),
    billingRule: input.billingRule || "month_start",
    billingFrequency: input.billingFrequency || "monthly",
    invoiceGenerationMode: input.invoiceGenerationMode || "manual"
  };
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
    currency: normalizeCurrency(reservationData.currency || rentalContext.campaign.currency),
    paymentTermType: reservationData.paymentTermType || rentalContext.campaign.paymentTermType || "30_days",
    paymentTermDays: reservationData.paymentTermDays ?? rentalContext.campaign.paymentTermDays ?? 30,
    billingRule: reservationData.billingRule || rentalContext.campaign.billingRule || "manual_per_contract",
    billingFrequency: reservationData.billingFrequency || rentalContext.campaign.billingFrequency || "monthly",
    invoiceGenerationMode: "manual"
  };
}

function reservationPatchData(
  input: ReturnType<typeof reservationPatchSchema.parse>,
  rentalContext: Awaited<ReturnType<typeof resolveRentalContextForUpdate>>,
  nextStatus: string,
  existing: { status: string; periodEnd: Date; neutralizationDate: Date | null; contractCompany: string | null }
) {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
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
    if (rentalContext) {
      data.currency = data.currency || rentalContext.campaign.currency || "EUR";
      data.paymentTermType = data.paymentTermType || rentalContext.campaign.paymentTermType || "30_days";
      data.paymentTermDays = data.paymentTermDays ?? rentalContext.campaign.paymentTermDays ?? 30;
      data.billingRule = data.billingRule || rentalContext.campaign.billingRule || "manual_per_contract";
      data.billingFrequency = data.billingFrequency || rentalContext.campaign.billingFrequency || "monthly";
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

function normalizeCurrency(value?: string | null): "RON" | "EUR" {
  return value === "RON" ? "RON" : "EUR";
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
