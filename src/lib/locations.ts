import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicAvailability } from "@/lib/availability";
import { arrayFromJson, makeSlug, normalizeMediaType, statusFromAvailabilityText } from "@/lib/format";
import { isInsideRomania } from "@/lib/gps";
import { isProductionSketchImage } from "@/lib/location-images";
import { displayPhotoUrl, samplePhotoForCode } from "@/lib/photos";
import { expireStaleHolds } from "@/lib/reservation-lifecycle";
import { sortOperationalLocations } from "@/lib/location-order";
import type { CategoryDTO, LocationDTO } from "@/types/location";

const locationInclude = {
  category: true,
  images: {
    orderBy: [{ isMain: "desc" as const }, { sortOrder: "asc" as const }]
  },
  reservations: {
    orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
  }
};

type LocationWithRelations = Prisma.LocationGetPayload<{
  include: typeof locationInclude;
}>;

type SerializeLocationOptions = {
  includeHiddenCommercials?: boolean;
  includePrivateFields?: boolean;
};

export function serializeLocation(location: LocationWithRelations, options: SerializeLocationOptions = {}): LocationDTO {
  const regularImages = location.images.filter((image) => !isProductionSketchImage(image));
  const productionSketch = location.images.find(isProductionSketchImage);
  const mainPhoto =
    location.mainPhotoUrl || regularImages.find((image) => image.isMain)?.url || samplePhotoForCode(location.code);
  const latReal = validCoordinate(location.latReal, location.lngReal) ? location.latReal : null;
  const lngReal = validCoordinate(location.latReal, location.lngReal) ? location.lngReal : null;
  const displayLat = location.latDisplay ?? location.latReal;
  const displayLng = location.lngDisplay ?? location.lngReal;
  const latDisplay = validCoordinate(displayLat, displayLng) ? displayLat : null;
  const lngDisplay = validCoordinate(displayLat, displayLng) ? displayLng : null;
  const type = normalizeMediaType(location.type, location.category.name, location.address, location.code);
  const exposePrice = options.includeHiddenCommercials || location.showPricePublic;
  const exposeInstallationCost = Boolean(options.includePrivateFields || location.showInstallationCostPublic);
  const exposePrivateFields = Boolean(options.includePrivateFields);
  const normalizedStatus = statusFromAvailabilityText(location.status, location.availabilityText);
  const availabilityReservations = location.reservations.filter((reservation) =>
    ["BOOKED", "HOLD", "RESERVED"].includes(reservation.status)
  );
  const availability = publicAvailability({
    status: normalizedStatus,
    availabilityText: location.availabilityText,
    availableFrom: location.availableFrom,
    availableUntil: location.availableUntil,
    bookedFrom: location.bookedFrom,
    bookedUntil: location.bookedUntil,
    reservations: availabilityReservations.map((reservation) => ({
      status: reservation.status,
      periodStart: reservation.periodStart,
      periodEnd: reservation.periodEnd
    }))
  });

  const dto: LocationDTO = {
    id: location.id,
    nr: location.nr,
    code: location.code,
    categoryId: location.categoryId,
    categoryName: location.category.name,
    categorySlug: location.category.slug,
    city: location.city,
    county: location.county,
    address: location.address,
    type,
    size: location.size,
    sqm: location.sqm,
    illum: location.illum,
    rateCard: exposePrice ? location.rateCard : null,
    rateCardValue: exposePrice ? location.rateCardValue : null,
    installationRemoval: exposeInstallationCost ? location.installationRemoval : null,
    installationRemovalValue: exposeInstallationCost ? location.installationRemovalValue : null,
    availabilityText: location.availabilityText,
    availableFrom: toIso(location.availableFrom),
    availableUntil: toIso(location.availableUntil),
    bookedFrom: toIso(location.bookedFrom),
    bookedUntil: toIso(location.bookedUntil),
    status: normalizedStatus,
    publicStatus: availability.publicStatus,
    availabilityLabel: availability.label,
    availabilityDetail: availability.detail,
    latReal: exposePrivateFields ? latReal : null,
    lngReal: exposePrivateFields ? lngReal : null,
    latDisplay,
    lngDisplay,
    mapsUrl: exposePrivateFields ? location.mapsUrl : null,
    mainPhotoUrl: displayPhotoUrl(mainPhoto),
    photoOriginalUrl: exposePrivateFields ? location.photoOriginalUrl : null,
    productionSketchUrl: displayPhotoUrl(productionSketch?.url) || null,
    showPricePublic: location.showPricePublic,
    showInstallationCostPublic: location.showInstallationCostPublic,
    showInPublic: location.showInPublic,
    isPremium: location.isPremium,
    isFeatured: location.isFeatured,
    normalizedLocationName: location.normalizedLocationName,
    reportingGroupName: location.reportingGroupName,
    displayOrder: location.displayOrder,
    locationGroupOrder: location.locationGroupOrder,
    faceOrder: location.faceOrder,
    directionOrder: location.directionOrder,
    monthlyCost: exposePrivateFields ? location.monthlyCost : null,
    costCurrency: exposePrivateFields ? location.costCurrency : null,
    costType: exposePrivateFields ? location.costType : null,
    costSupplier: exposePrivateFields ? location.costSupplier : null,
    costNotes: exposePrivateFields ? location.costNotes : null,
    blockedReason: exposePrivateFields ? location.blockedReason : null,
    blockedByUserId: exposePrivateFields ? location.blockedByUserId : null,
    blockedFrom: exposePrivateFields ? toIso(location.blockedFrom) : null,
    blockedUntil: exposePrivateFields ? toIso(location.blockedUntil) : null,
    blockedNotes: exposePrivateFields ? location.blockedNotes : null,
    coordinateSource: exposePrivateFields ? location.coordinateSource : null,
    gpsAuditStatus: location.gpsAuditStatus,
    benefits: arrayFromJson(location.benefits, defaultBenefits(location)),
    mediaDetails: arrayFromJson(location.mediaDetails, defaultMediaDetails({ ...location, type })),
    campaignDetails: arrayFromJson(
      location.campaignDetails,
      defaultCampaignDetails({ installationRemoval: exposeInstallationCost ? location.installationRemoval : null })
    ),
    internalNotes: exposePrivateFields ? location.internalNotes : null,
    images: regularImages.map((image) => ({
      id: image.id,
      url: displayPhotoUrl(image.url) || samplePhotoForCode(location.code),
      alt: image.alt,
      sortOrder: image.sortOrder,
      isMain: image.isMain
    })),
    reservations: exposePrivateFields
      ? location.reservations.map((reservation) => ({
          id: reservation.id,
          locationId: reservation.locationId,
          clientId: reservation.clientId,
          campaignId: reservation.campaignId,
          locationCode: location.code,
          locationName: location.address,
          status: reservation.status,
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
          neutralizationDate: reservation.neutralizationDate?.toISOString() || null,
          externalSource: reservation.externalSource,
          externalId: reservation.externalId,
          bookedAt: reservation.bookedAt?.toISOString() || null,
          holdExpiresAt: reservation.holdExpiresAt?.toISOString() || null,
          ownerId: reservation.ownerId,
          sellerUserId: reservation.sellerUserId || reservation.ownerId,
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
          updatedAt: reservation.updatedAt.toISOString()
        }))
      : [],
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString()
  };

  if (!exposePrice) {
    deleteLocationKeys(dto, ["rateCard", "rateCardValue"]);
  }

  if (!exposeInstallationCost) {
    deleteLocationKeys(dto, ["installationRemoval", "installationRemovalValue"]);
  }

  if (!exposePrivateFields) {
    deletePublicPrivateKeys(dto);
  }

  return dto;
}

const PUBLIC_PRIVATE_LOCATION_KEYS: Array<keyof LocationDTO> = [
  "latReal",
  "lngReal",
  "mapsUrl",
  "photoOriginalUrl",
  "showPricePublic",
  "showInstallationCostPublic",
  "showInPublic",
  "normalizedLocationName",
  "reportingGroupName",
  "displayOrder",
  "locationGroupOrder",
  "faceOrder",
  "directionOrder",
  "monthlyCost",
  "costCurrency",
  "costType",
  "costSupplier",
  "costNotes",
  "blockedReason",
  "blockedByUserId",
  "blockedFrom",
  "blockedUntil",
  "blockedNotes",
  "coordinateSource",
  "gpsAuditStatus",
  "internalNotes",
  "reservations"
];

function deletePublicPrivateKeys(dto: LocationDTO) {
  deleteLocationKeys(dto, PUBLIC_PRIVATE_LOCATION_KEYS);
}

function deleteLocationKeys(dto: LocationDTO, keys: Array<keyof LocationDTO>) {
  const mutable = dto as Partial<LocationDTO>;
  for (const key of keys) {
    delete mutable[key];
  }
}

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function validCoordinate(lat?: number | null, lng?: number | null) {
  return lat != null && lng != null && isInsideRomania(lat, lng);
}

export function serializeCategory(category: CategoryDTO): CategoryDTO {
  return category;
}

function defaultBenefits(location: { category?: { name?: string }; illum?: boolean | null; sqm?: number | null }) {
  return [
    "Timp bun de expunere",
    "Vizibilitate puternica pentru trafic pietonal si auto",
    location.category?.name?.toLowerCase().includes("aeroport")
      ? "Context premium in aeroport"
      : "Pozitionare potrivita pentru impact de brand"
  ].filter(Boolean);
}

function defaultMediaDetails(location: { type?: string | null; size?: string | null; sqm?: number | null }) {
  return [
    location.type ? `Format: ${location.type}` : "Format: OOH",
    location.size ? `Dimensiune: ${location.size}` : null,
    location.sqm ? `Suprafata: ${location.sqm} sqm` : null
  ].filter(Boolean) as string[];
}

function defaultCampaignDetails(location: { installationRemoval?: string | null }) {
  return [location.installationRemoval || "Montare/neutralizare disponibile", "Productie la cerere"];
}

export async function getOrCreateCategory(name: string, sortOrder = 0) {
  const cleanName = name.trim() || "General";
  const slug = makeSlug(cleanName);

  return prisma.category.upsert({
    where: { slug },
    update: { name: cleanName, sortOrder },
    create: { name: cleanName, slug, sortOrder }
  });
}

export async function listPublicLocations() {
  await expireStaleHolds();
  const locations = await prisma.location.findMany({
    where: { showInPublic: true },
    include: locationInclude,
    orderBy: [{ isFeatured: "desc" }, { category: { sortOrder: "asc" } }, { code: "asc" }]
  });

  return locations.map((location) => serializeLocation(location)).sort(sortOperationalLocations);
}

export async function listAdminLocations() {
  await expireStaleHolds();
  const locations = await prisma.location.findMany({
    include: locationInclude,
    orderBy: [{ updatedAt: "desc" }]
  });

  return locations.map((location) =>
    serializeLocation(location, { includeHiddenCommercials: true, includePrivateFields: true })
  ).sort(sortOperationalLocations);
}

export async function getPublicLocation(id: string) {
  await expireStaleHolds();
  const location = await prisma.location.findFirst({
    where: { id, showInPublic: true },
    include: locationInclude
  });

  return location ? serializeLocation(location) : null;
}

export async function getAdminLocation(id: string) {
  await expireStaleHolds();
  const location = await prisma.location.findUnique({
    where: { id },
    include: locationInclude
  });

  return location ? serializeLocation(location, { includeHiddenCommercials: true, includePrivateFields: true }) : null;
}

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    sortOrder: category.sortOrder
  }));
}
