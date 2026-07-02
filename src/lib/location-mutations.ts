import { prisma } from "@/lib/prisma";
import { auditCoordinates, extractCoordinatesFromMapsUrl, spreadOverlappingLocations } from "@/lib/gps";
import { normalizeMediaType } from "@/lib/format";
import { PRODUCTION_SKETCH_ALT } from "@/lib/location-images";
import { getOrCreateCategory, listAdminLocations } from "@/lib/locations";
import { locationInputSchema, locationPatchSchema } from "@/lib/validation";

export async function createLocation(input: unknown) {
  const parsed = locationInputSchema.parse(input);
  const category = await getOrCreateCategory(parsed.categoryName);
  const { imageUrls, productionSketchUrl, data } = withoutCategoryNameAndImages(parsed);
  const normalizedData = normalizeLocationData(data);

  return prisma.$transaction(async (tx) => {
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
  });
}

export async function updateLocation(id: string, input: unknown) {
  const parsed = locationPatchSchema.parse(input);
  const category = parsed.categoryName ? await getOrCreateCategory(parsed.categoryName) : null;
  const { imageUrls, productionSketchUrl, data } = withoutCategoryNameAndImages(parsed);
  const normalizedData = normalizeLocationData(data);

  return prisma.$transaction(async (tx) => {
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
  });
}

export async function duplicateLocation(id: string) {
  const original = await prisma.location.findUnique({
    where: { id },
    include: { images: true }
  });
  if (!original) throw new Error("Location not found");

  const duplicate = await prisma.location.create({
    data: {
      nr: original.nr,
      code: `${original.code}-COPY-${Date.now().toString().slice(-5)}`,
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
      availabilityText: original.availabilityText,
      availableFrom: original.availableFrom,
      availableUntil: original.availableUntil,
      bookedFrom: original.bookedFrom,
      bookedUntil: original.bookedUntil,
      status: original.status,
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
      blockedReason: original.blockedReason,
      blockedByUserId: original.blockedByUserId,
      blockedFrom: original.blockedFrom,
      blockedUntil: original.blockedUntil,
      blockedNotes: original.blockedNotes,
      coordinateSource: original.coordinateSource,
      gpsAuditStatus: original.gpsAuditStatus,
      benefits: original.benefits ?? undefined,
      mediaDetails: original.mediaDetails ?? undefined,
      campaignDetails: original.campaignDetails ?? undefined,
      internalNotes: original.internalNotes
    }
  });

  if (original.images.length) {
    await prisma.image.createMany({
      data: original.images.map((image, index) => ({
        locationId: duplicate.id,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder || index,
        isMain: image.isMain
      }))
    });
  }

  return duplicate;
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

function normalizeLocationData<T extends { type?: string | null; categoryName?: string; address?: string | null; code?: string }>(data: T) {
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
