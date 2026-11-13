import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import type { AuthSession } from "@/lib/auth";
import { hasAnyPermission, type Permission } from "@/lib/rbac";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { auditCoordinates, extractCoordinatesFromMapsUrl, spreadOverlappingLocations } from "@/lib/gps";
import { normalizeMediaType } from "@/lib/format";
import { PRODUCTION_SKETCH_ALT } from "@/lib/location-images";
import { getOrCreateCategory, listAdminLocations } from "@/lib/locations";
import { locationInputSchema, locationPatchSchema } from "@/lib/validation";

export type LocationMutationActor = Pick<AuthSession, "id" | "role" | "tokenVersion"> & Partial<Pick<AuthSession, "email" | "sessionId" | "exp">>;
export class LocationMutationError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const mutationTransaction = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 20_000 };

// The route's permission check precedes the transaction. Lock and recheck here
// so disabling a user, changing their role or revoking credentials cannot race
// the actual inventory write. Lock order is actor, session, then location.
async function authorizeInventoryMutation(tx: Prisma.TransactionClient, actor: LocationMutationActor, permissions: Permission[]) {
  if (!actor?.id || !Number.isInteger(actor.tokenVersion)) throw new LocationMutationError("Autentificarea nu mai este validă.", 401);
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${actor.id} FOR UPDATE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, role: true, active: true, tokenVersion: true } });
  if (!current?.active || current.tokenVersion !== actor.tokenVersion || current.role !== actor.role || (actor.exp !== undefined && actor.exp <= Math.floor(Date.now() / 1000))) {
    throw new LocationMutationError("Sesiunea sau drepturile s-au schimbat. Autentifică-te din nou.", 401);
  }
  if (actor.sessionId) {
    await tx.$queryRaw`SELECT id FROM portfolio_auth_sessions WHERE id = ${actor.sessionId} FOR UPDATE`;
    const session = await tx.authSessionRecord.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
    if (!session || session.userId !== current.id || session.revokedAt || session.expiresAt <= new Date()) throw new LocationMutationError("Sesiunea a fost închisă sau a expirat.", 401);
  }
  if (!hasAnyPermission(current.role, permissions)) throw new LocationMutationError("Nu ai permisiunea de a modifica inventarul.", 403);
  return current;
}

async function lockLocation(tx: Prisma.TransactionClient, id: string) {
  const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM portfolio_locations WHERE id = ${id} FOR UPDATE`;
  if (!found.length) throw new LocationMutationError("Locația nu există.", 404);
}

function fullLocation(tx: Prisma.TransactionClient, id: string) {
  return tx.location.findUniqueOrThrow({ where: { id }, include: {
    category: true,
    images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }] },
    reservations: { orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }] }
  } });
}

export function locationMutationFailure(error: unknown) {
  if (error instanceof LocationMutationError) return { status: error.status, error: error.message };
  if (error instanceof SyntaxError) return { status: 400, error: "Corpul JSON nu este valid." };
  if (error instanceof ZodError) return { status: 400, error: "Datele locației nu sunt valide. Verifică valorile introduse." };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { status: 409, error: "Codul locației există deja. Folosește un cod unic." };
    if (error.code === "P2003") return { status: 409, error: "Locația are referințe și nu poate fi ștearsă." };
    if (error.code === "P2025") return { status: 404, error: "Locația nu există." };
  }
  return { status: 503, error: "Operația asupra inventarului nu a putut fi finalizată. Reîncarcă datele înainte de a reîncerca." };
}

export async function createLocation(input: unknown, actor: LocationMutationActor) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeInventoryMutation(tx, actor, ["inventory.create", "inventory.manage"]);
    const location = await createLocationInTransaction(tx, input);
    await recordTransactionalAudit(tx, { actor: current, action: "location.create", entityType: "location", entityId: location.id,
      metadata: { code: location.code, showInPublic: location.showInPublic, showPricePublic: location.showPricePublic, showInstallationCostPublic: location.showInstallationCostPublic } });
    return fullLocation(tx, location.id);
  }, mutationTransaction);
}

export async function createLocationInTransaction(tx: PrismaTransaction, input: unknown) {
  const parsed = locationInputSchema.parse(input);
  const category = await getOrCreateCategory(parsed.categoryName, 0, tx);
  const { imageUrls, productionSketchUrl, data } = withoutCategoryNameAndImages(parsed);
  const normalizedData = normalizeLocationData(withoutLegacyAvailabilityState(data));

  const location = await tx.location.create({
    data: {
      ...normalizedData,
      categoryId: category.id,
      latDisplay: parsed.latDisplay ?? parsed.latReal,
      lngDisplay: parsed.lngDisplay ?? parsed.lngReal
    }
  });

  await syncLocationImages(tx, location.id, imageUrls, parsed.mainPhotoUrl, productionSketchUrl);
  return location;
}

export async function updateLocation(id: string, input: unknown, actor: LocationMutationActor) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeInventoryMutation(tx, actor, ["inventory.manage"]);
    await lockLocation(tx, id);
    const before = await tx.location.findUniqueOrThrow({ where: { id } });
    const location = await updateLocationInTransaction(tx, id, input);
    await recordTransactionalAudit(tx, { actor: current, action: "location.update", entityType: "location", entityId: id,
      metadata: { code: location.code, fields: Object.keys(locationPatchSchema.parse(input)), before: { showInPublic: before.showInPublic, showPricePublic: before.showPricePublic, showInstallationCostPublic: before.showInstallationCostPublic },
        after: { showInPublic: location.showInPublic, showPricePublic: location.showPricePublic, showInstallationCostPublic: location.showInstallationCostPublic } } });
    return fullLocation(tx, id);
  }, mutationTransaction);
}

export async function updateLocationInTransaction(tx: PrismaTransaction, id: string, input: unknown) {
  const parsed = locationPatchSchema.parse(input);
  const category = parsed.categoryName ? await getOrCreateCategory(parsed.categoryName, 0, tx) : null;
  const { imageUrls, productionSketchUrl, data } = withoutCategoryNameAndImages(parsed);
  const normalizedData = normalizeLocationData(withoutLegacyAvailabilityState(data));

  const location = await tx.location.update({
    where: { id },
    data: {
      ...normalizedData,
      ...(category ? { categoryId: category.id } : {})
    }
  });

  if (imageUrls || productionSketchUrl !== undefined) {
    await syncLocationImages(tx, id, imageUrls, parsed.mainPhotoUrl, productionSketchUrl);
  }

  return location;
}

export async function duplicateLocation(id: string, actor: LocationMutationActor) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeInventoryMutation(tx, actor, ["inventory.manage"]);
    await lockLocation(tx, id);
    const original = await tx.location.findUnique({
      where: { id },
      include: { images: true }
    });
    if (!original) throw new LocationMutationError("Locația nu există.", 404);
    const suffix = `-COPY-${randomUUID().replace(/-/g, "")}`;

    const duplicate = await tx.location.create({
      data: {
        nr: original.nr,
        code: `${original.code.slice(0, 191 - suffix.length)}${suffix}`,
        categoryId: original.categoryId,
        city: original.city,
        county: original.county,
        address: original.address,
        type: original.type,
        size: original.size,
        sqm: original.sqm,
        illum: original.illum,
        rateCard: original.rateCard,
        rateCardValue: original.rateCardValue,
        installationRemoval: original.installationRemoval,
        installationRemovalValue: original.installationRemovalValue,
        availabilityText: null,
        availableFrom: null,
        availableUntil: null,
        bookedFrom: null,
        bookedUntil: null,
        status: "UNKNOWN",
        lifecycleStatus: original.lifecycleStatus,
        latReal: original.latReal,
        lngReal: original.lngReal,
        latDisplay: original.latDisplay,
        lngDisplay: original.lngDisplay,
        mapsUrl: original.mapsUrl,
        mainPhotoUrl: original.mainPhotoUrl,
        photoOriginalUrl: original.photoOriginalUrl,
        showPricePublic: original.showPricePublic,
        showInstallationCostPublic: original.showInstallationCostPublic,
        showInPublic: false,
        isPremium: original.isPremium,
        isFeatured: false,
        normalizedLocationName: original.normalizedLocationName,
        reportingGroupName: original.reportingGroupName,
        displayOrder: original.displayOrder,
        locationGroupOrder: original.locationGroupOrder,
        faceOrder: original.faceOrder,
        directionOrder: original.directionOrder,
        monthlyCost: original.monthlyCost,
        costCurrency: original.costCurrency,
        costType: original.costType,
        costSupplier: original.costSupplier,
        costNotes: original.costNotes,
        blockedReason: null,
        blockedByUserId: null,
        blockedFrom: null,
        blockedUntil: null,
        blockedNotes: null,
        coordinateSource: original.coordinateSource,
        gpsAuditStatus: original.gpsAuditStatus,
        benefits: original.benefits ?? undefined,
        mediaDetails: original.mediaDetails ?? undefined,
        campaignDetails: original.campaignDetails ?? undefined,
        internalNotes: original.internalNotes
      }
    });

    if (original.images.length) {
      await tx.image.createMany({
        data: original.images.map((image) => ({
          locationId: duplicate.id,
          url: image.url,
          alt: image.alt,
          sortOrder: image.sortOrder,
          isMain: image.isMain
        }))
      });
    }

    await recordTransactionalAudit(tx, { actor: current, action: "location.duplicate", entityType: "location", entityId: duplicate.id,
      metadata: { sourceLocationId: original.id, code: duplicate.code, imageCount: original.images.length, showInPublic: false } });
    return fullLocation(tx, duplicate.id);
  }, mutationTransaction);
}

export async function deleteLocation(id: string, actor: LocationMutationActor) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeInventoryMutation(tx, actor, ["inventory.manage"]);
    await lockLocation(tx, id);
    // InnoDB's parent lock serializes FK-backed history inserts. Read current
    // counts only after that lock under READ COMMITTED, never an old snapshot.
    const existing = await tx.location.findUniqueOrThrow({ where: { id }, select: {
      id: true, code: true, _count: { select: { reservations: true, operationTasks: true,
        financialImportRows: true, financialAllocations: true, financialCosts: true,
        availabilityOverrides: true, audits: true, images: true } }
    } });
    const { images: imageCount, ...history } = existing._count;
    if (Object.values(history).some((count) => count > 0)) throw new LocationMutationError("Locația are istoric comercial sau operațional și nu poate fi ștearsă. Ascunde-o din portalul public.", 409);
    const digitalProfile = await tx.doohProfile.count({ where: { locationId: id } });
    const quoted = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM portfolio_quote_revisions WHERE JSON_CONTAINS(JSON_EXTRACT(payload, '$.lines[*].locationId'), ${JSON.stringify(id)}) = 1 LIMIT 1`;
    if (digitalProfile || quoted.length) throw new LocationMutationError("Locația are istoric de ofertă sau capacitate DOOH și nu poate fi ștearsă. Ascunde-o din portalul public.", 409);
    await tx.location.delete({ where: { id } });
    await recordTransactionalAudit(tx, { actor: current, action: "location.delete", entityType: "location", entityId: id,
      metadata: { code: existing.code, imageCount } });
    return { id };
  }, mutationTransaction);
}

export async function runGpsAudit() {
  const locations = await prisma.location.findMany();
  let ok = 0;
  let missing = 0;
  let suspect = 0;

  for (const location of locations) {
    const audit = auditCoordinates({
      city: location.city,
      lat: location.latReal,
      lng: location.lngReal
    });

    if (audit.status === "OK") ok += 1;
    if (audit.status === "MISSING") missing += 1;
    if (audit.status === "SUSPECT") suspect += 1;

    await prisma.location.update({
      where: { id: location.id },
      data: { gpsAuditStatus: audit.status }
    });

    await prisma.gpsAuditLog.create({
      data: {
        locationId: location.id,
        status: audit.status,
        message: audit.message,
        oldLat: location.latReal,
        oldLng: location.lngReal,
        newLat: location.latReal,
        newLng: location.lngReal
      }
    });
  }

  return { total: locations.length, ok, missing, suspect };
}

export async function spreadOverlappingMarkers() {
  const locations = await listAdminLocations();
  const spread = spreadOverlappingLocations(locations);

  for (const location of spread) {
    await prisma.location.update({
      where: { id: location.id },
      data: {
        latDisplay: location.latDisplay,
        lngDisplay: location.lngDisplay
      }
    });
  }

  return { updated: spread.length };
}

export async function resetDisplayCoordinatesToReal() {
  const locations = await prisma.location.findMany({
    where: {
      latReal: { not: null },
      lngReal: { not: null }
    },
    select: {
      id: true,
      city: true,
      latReal: true,
      lngReal: true,
      latDisplay: true,
      lngDisplay: true
    }
  });

  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const location of locations) {
      if (location.latReal == null || location.lngReal == null) {
        skipped += 1;
        continue;
      }

      const changed = location.latDisplay !== location.latReal || location.lngDisplay !== location.lngReal;
      if (!changed) {
        skipped += 1;
        continue;
      }

      const audit = auditCoordinates({
        city: location.city,
        lat: location.latReal,
        lng: location.lngReal
      });

      await tx.location.update({
        where: { id: location.id },
        data: {
          latDisplay: location.latReal,
          lngDisplay: location.lngReal,
          gpsAuditStatus: audit.status
        }
      });

      await tx.gpsAuditLog.create({
        data: {
          locationId: location.id,
          status: audit.status,
          message: "Bulk reset display coordinates to real coordinates.",
          oldLat: location.latDisplay,
          oldLng: location.lngDisplay,
          newLat: location.latReal,
          newLng: location.lngReal
        }
      });

      updated += 1;
    }
  });

  return { updated, skipped, total: locations.length };
}

export async function restoreCoordinatesFromMapsUrls() {
  const locations = await prisma.location.findMany({
    select: {
      id: true,
      city: true,
      mapsUrl: true,
      latReal: true,
      lngReal: true
    }
  });

  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const location of locations) {
      const coords = extractCoordinatesFromMapsUrl(location.mapsUrl);
      if (!coords) {
        skipped += 1;
        continue;
      }

      const changed = location.latReal !== coords.lat || location.lngReal !== coords.lng;
      if (!changed) {
        skipped += 1;
        continue;
      }

      const audit = auditCoordinates({
        city: location.city,
        lat: coords.lat,
        lng: coords.lng
      });

      await tx.location.update({
        where: { id: location.id },
        data: {
          latReal: coords.lat,
          lngReal: coords.lng,
          latDisplay: coords.lat,
          lngDisplay: coords.lng,
          coordinateSource: "maps_url_bulk_reset",
          gpsAuditStatus: audit.status
        }
      });

      await tx.gpsAuditLog.create({
        data: {
          locationId: location.id,
          status: audit.status,
          message: "Bulk restored real and display coordinates from Google Maps URL.",
          oldLat: location.latReal,
          oldLng: location.lngReal,
          newLat: coords.lat,
          newLng: coords.lng
        }
      });

      updated += 1;
    }
  });

  return { updated, skipped, total: locations.length };
}

function withoutCategoryNameAndImages<T extends { categoryName?: string; imageUrls?: string[]; productionSketchUrl?: string | null }>(input: T) {
  const { categoryName, imageUrls, productionSketchUrl, ...data } = input;
  return { imageUrls, productionSketchUrl, data };
}

export function withoutLegacyAvailabilityState<T extends {
  status?: unknown;
  availableFrom?: unknown;
  availableUntil?: unknown;
  bookedFrom?: unknown;
  bookedUntil?: unknown;
  blockedReason?: unknown;
  blockedByUserId?: unknown;
  blockedFrom?: unknown;
  blockedUntil?: unknown;
  blockedNotes?: unknown;
}>(data: T) {
  const {
    status: _status,
    availableFrom: _availableFrom,
    availableUntil: _availableUntil,
    bookedFrom: _bookedFrom,
    bookedUntil: _bookedUntil,
    blockedReason: _blockedReason,
    blockedByUserId: _blockedByUserId,
    blockedFrom: _blockedFrom,
    blockedUntil: _blockedUntil,
    blockedNotes: _blockedNotes,
    ...canonicalData
  } = data;
  return canonicalData;
}

export function normalizeLocationData<T extends { type?: string | null; categoryName?: string; address?: string | null; code?: string }>(data: T) {
  if (!("type" in data)) return data;
  return {
    ...data,
    type: normalizeMediaType(data.type, data.categoryName, data.address, data.code)
  };
}

async function syncLocationImages(
  tx: PrismaTransaction,
  locationId: string,
  imageUrls: string[] | undefined,
  mainPhotoUrl?: string | null,
  productionSketchUrl?: string | null
) {
  if (!imageUrls && productionSketchUrl === undefined) return;

  if (imageUrls) {
    const urls = Array.from(new Set(imageUrls.map((url) => url.trim()).filter(Boolean)));
    await tx.image.deleteMany({ where: { locationId, NOT: { alt: PRODUCTION_SKETCH_ALT } } });

    if (urls.length) {
      await tx.image.createMany({
        data: urls.map((url, index) => ({
          locationId,
          url,
          alt: null,
          sortOrder: index,
          isMain: index === 0 || Boolean(mainPhotoUrl && url === mainPhotoUrl)
        }))
      });
    }
  }

  if (productionSketchUrl !== undefined) {
    const sketchUrl = productionSketchUrl?.trim();
    await tx.image.deleteMany({ where: { locationId, alt: PRODUCTION_SKETCH_ALT } });
    if (sketchUrl) {
      await tx.image.create({
        data: {
          locationId,
          url: sketchUrl,
          alt: PRODUCTION_SKETCH_ALT,
          sortOrder: 9999,
          isMain: false
        }
      });
    }
  }
}

type PrismaTransaction = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
