import type { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { publicAvailability } from "@/lib/availability";
import { arrayFromJson, makeSlug, normalizeMediaType, statusFromAvailabilityText } from "@/lib/format";
import { isInsideRomania } from "@/lib/gps";
import { isProductionSketchImage } from "@/lib/location-images";
import { displayPhotoUrl, samplePhotoForCode } from "@/lib/photos";
import { effectiveBlockingReservationWhere, isEffectiveBlockingReservation } from "@/lib/reservation-lifecycle";
import { sortOperationalLocations } from "@/lib/location-order";
import type {
  AdminLocationListItemDTO,
  AdminLocationPageDTO,
  CategoryDTO,
  LocationDTO,
  LocationLifecycleStatus
} from "@/types/location";

const blockingReservationStatuses = ["BOOKED", "HOLD", "RESERVED"] as const;

const adminLocationInclude = {
  category: true,
  images: {
    orderBy: [{ isMain: "desc" as const }, { sortOrder: "asc" as const }]
  },
  reservations: {
    orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
  },
  availabilityOverrides: {
    where: { clearedAt: null },
    orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
  }
};

function adminLocationListInclude(now: Date) {
  const today = startOfUtcDay(now);
  return {
    category: true,
    images: {
      orderBy: [{ isMain: "desc" as const }, { sortOrder: "asc" as const }]
    },
    reservations: {
      where: {
        periodEnd: { gte: today },
        ...effectiveBlockingReservationWhere(now)
      },
      select: {
        status: true,
        periodStart: true,
        periodEnd: true,
        holdExpiresAt: true,
        createdAt: true
      },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    },
    availabilityOverrides: {
      where: { clearedAt: null },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    }
  };
}

function adminLocationSummarySelect(now: Date) {
  const today = startOfUtcDay(now);
  return {
    id: true,
    code: true,
    categoryId: true,
    city: true,
    county: true,
    address: true,
    type: true,
    size: true,
    sqm: true,
    rateCard: true,
    rateCardValue: true,
    installationRemoval: true,
    installationRemovalValue: true,
    status: true,
    lifecycleStatus: true,
    availabilityText: true,
    availableFrom: true,
    availableUntil: true,
    bookedFrom: true,
    bookedUntil: true,
    blockedReason: true,
    blockedFrom: true,
    blockedUntil: true,
    latDisplay: true,
    lngDisplay: true,
    mapsUrl: true,
    showPricePublic: true,
    showInstallationCostPublic: true,
    showInPublic: true,
    mainPhotoUrl: true,
    updatedAt: true,
    category: {
      select: { name: true, slug: true }
    },
    reservations: {
      where: {
        periodEnd: { gte: today },
        ...effectiveBlockingReservationWhere(now)
      },
      select: {
        id: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        holdExpiresAt: true,
        createdAt: true
      },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    },
    availabilityOverrides: {
      where: { clearedAt: null },
      select: {
        id: true,
        type: true,
        reason: true,
        periodStart: true,
        periodEnd: true,
        clearedAt: true
      },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    }
  } satisfies Prisma.LocationSelect;
}

type AdminLocationSummaryRow = Prisma.LocationGetPayload<{
  select: ReturnType<typeof adminLocationSummarySelect>;
}>;

export type AdminLocationListFilters = {
  query?: string | null;
  category?: string | null;
  lifecycleStatus?: string | null;
  page?: number | string | null;
  pageSize?: number | string | null;
};

function publicLocationInclude(now: Date) {
  const today = startOfUtcDay(now);
  return {
    category: true,
    images: {
      select: {
        id: true,
        url: true,
        alt: true,
        sortOrder: true,
        isMain: true
      },
      orderBy: [{ isMain: "desc" as const }, { sortOrder: "asc" as const }]
    },
    reservations: {
      where: {
        ...effectiveBlockingReservationWhere(now),
        periodEnd: { gte: today }
      },
      select: {
        status: true,
        periodStart: true,
        periodEnd: true,
        holdExpiresAt: true,
        createdAt: true
      },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    },
    availabilityOverrides: {
      where: { clearedAt: null },
      select: {
        id: true,
        type: true,
        reason: true,
        periodStart: true,
        periodEnd: true,
        clearedAt: true
      },
      orderBy: [{ periodStart: "asc" as const }, { periodEnd: "asc" as const }]
    }
  };
}

type AdminLocationWithRelations = Prisma.LocationGetPayload<{
  include: typeof adminLocationInclude;
}>;

type PublicLocationWithRelations = Prisma.LocationGetPayload<{
  include: { category: true };
}> & {
  images: Array<{
    id: string;
    url: string;
    alt: string | null;
    sortOrder: number;
    isMain: boolean;
  }>;
  reservations: Array<{
    status: string;
    periodStart: Date;
    periodEnd: Date;
    holdExpiresAt: Date | null;
    createdAt: Date;
  }>;
  availabilityOverrides?: Array<{
    id: string;
    type: "COMMERCIAL_BLOCK" | "MAINTENANCE" | "INTERNAL_HOLD";
    reason: string;
    periodStart: Date;
    periodEnd: Date | null;
    clearedAt: Date | null;
  }>;
};

type LocationWithRelations = AdminLocationWithRelations | PublicLocationWithRelations;

type SerializeLocationOptions = {
  includeHiddenCommercials?: boolean;
  includePrivateFields?: boolean;
  includeReservationDetails?: boolean;
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
    blockingReservationStatuses.includes(reservation.status as (typeof blockingReservationStatuses)[number]) &&
    isEffectiveBlockingReservation(reservation)
  );
  const availability = publicAvailability({
    status: normalizedStatus,
    lifecycleStatus: location.lifecycleStatus,
    availabilityText: location.availabilityText,
    availableFrom: location.availableFrom,
    availableUntil: location.availableUntil,
    bookedFrom: location.bookedFrom,
    bookedUntil: location.bookedUntil,
    blockedReason: location.blockedReason,
    blockedFrom: location.blockedFrom,
    blockedUntil: location.blockedUntil,
    availabilityOverrides: location.availabilityOverrides || [],
    reservations: availabilityReservations.map((reservation) => ({
      status: reservation.status,
      periodStart: reservation.periodStart,
      periodEnd: reservation.periodEnd,
      holdExpiresAt: reservation.holdExpiresAt,
      createdAt: reservation.createdAt
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
    lifecycleStatus: location.lifecycleStatus,
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
    availabilityOverrides: exposePrivateFields
      ? (location.availabilityOverrides || []).map((override) => ({
          id: override.id,
          type: override.type,
          reason: override.reason,
          periodStart: override.periodStart.toISOString(),
          periodEnd: override.periodEnd?.toISOString() || null,
          clearedAt: override.clearedAt?.toISOString() || null
        }))
      : undefined,
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
    reservations: exposePrivateFields && options.includeReservationDetails !== false
      ? (location.reservations as AdminLocationWithRelations["reservations"]).map((reservation) => ({
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
  "lifecycleStatus",
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
  "availabilityOverrides",
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
  const now = new Date();
  const locations = await prisma.location.findMany({
    where: { showInPublic: true, lifecycleStatus: "ACTIVE" },
    include: publicLocationInclude(now),
    orderBy: [{ isFeatured: "desc" }, { category: { sortOrder: "asc" } }, { code: "asc" }]
  });

  return locations.map((location) => serializeLocation(location)).sort(sortOperationalLocations);
}

export const listCachedPublicLocations = unstable_cache(
  async () => listPublicLocations(),
  ["public-locations-v3"],
  { revalidate: 60 }
);

export async function listAdminLocations() {
  const now = new Date();
  const locations = await prisma.location.findMany({
    include: adminLocationListInclude(now),
    orderBy: [{ updatedAt: "desc" }]
  });

  return locations.map((location) =>
    serializeLocation(location, { includeHiddenCommercials: true, includePrivateFields: true, includeReservationDetails: false })
  ).sort(sortOperationalLocations);
}

export async function listAdminLocationPage(filters: AdminLocationListFilters = {}): Promise<AdminLocationPageDTO> {
  const now = new Date();
  const pageSize = clampInteger(filters.pageSize, 15, 10, 50);
  const requestedPage = clampInteger(filters.page, 1, 1, 100_000);
  const where = adminLocationListWhere(filters);
  const total = await prisma.location.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await prisma.location.findMany({
    where,
    select: adminLocationSummarySelect(now),
    orderBy: [{ updatedAt: "desc" }, { code: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize
  });

  return {
    items: rows.map((row) => serializeAdminLocationListItem(row, now)),
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}

export async function getAdminLocationListItem(idOrCode: string): Promise<AdminLocationListItemDTO | null> {
  const value = idOrCode.trim();
  if (!value) return null;
  const now = new Date();
  const row = await prisma.location.findFirst({
    where: { OR: [{ id: value }, { code: value }] },
    select: adminLocationSummarySelect(now)
  });
  return row ? serializeAdminLocationListItem(row, now) : null;
}

export async function getPublicLocation(id: string) {
  const now = new Date();
  const location = await prisma.location.findFirst({
    where: { id, showInPublic: true, lifecycleStatus: "ACTIVE" },
    include: publicLocationInclude(now)
  });

  return location ? serializeLocation(location) : null;
}

export async function getAdminLocation(id: string) {
  const location = await prisma.location.findUnique({
    where: { id },
    include: adminLocationInclude
  });

  return location ? serializeLocation(location, { includeHiddenCommercials: true, includePrivateFields: true }) : null;
}

function adminLocationListWhere(filters: AdminLocationListFilters): Prisma.LocationWhereInput {
  const query = String(filters.query || "").trim();
  const category = String(filters.category || "").trim();
  const lifecycleStatus = normalizeLifecycleFilter(filters.lifecycleStatus);
  const and: Prisma.LocationWhereInput[] = [];

  if (query) {
    and.push({
      OR: [
        { code: { contains: query } },
        { address: { contains: query } },
        { city: { contains: query } },
        { county: { contains: query } },
        { type: { contains: query } },
        { category: { name: { contains: query } } }
      ]
    });
  }
  if (category) and.push({ category: { slug: category } });
  if (lifecycleStatus) and.push({ lifecycleStatus });

  return and.length ? { AND: and } : {};
}

function serializeAdminLocationListItem(row: AdminLocationSummaryRow, now: Date): AdminLocationListItemDTO {
  const availability = publicAvailability(row, now);
  return {
    id: row.id,
    code: row.code,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    city: row.city,
    county: row.county,
    address: row.address,
    type: normalizeMediaType(row.type, row.category.name, row.address, row.code),
    size: row.size,
    sqm: row.sqm,
    rateCard: row.rateCard,
    rateCardValue: row.rateCardValue,
    installationRemoval: row.installationRemoval,
    installationRemovalValue: row.installationRemovalValue,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus as LocationLifecycleStatus,
    publicStatus: availability.publicStatus,
    availabilityText: row.availabilityText,
    availabilityLabel: availability.label,
    availabilityDetail: availability.detail,
    latDisplay: row.latDisplay,
    lngDisplay: row.lngDisplay,
    mapsUrl: row.mapsUrl,
    showPricePublic: row.showPricePublic,
    showInstallationCostPublic: row.showInstallationCostPublic,
    showInPublic: row.showInPublic,
    mainPhotoUrl: displayPhotoUrl(row.mainPhotoUrl) || samplePhotoForCode(row.code),
    updatedAt: row.updatedAt.toISOString()
  };
}

function normalizeLifecycleFilter(value?: string | null): LocationLifecycleStatus | null {
  return ["ACTIVE", "INACTIVE", "ARCHIVED", "MAINTENANCE"].includes(String(value || ""))
    ? String(value) as LocationLifecycleStatus
    : null;
}

function clampInteger(value: number | string | null | undefined, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

export const listCachedCategories = unstable_cache(
  async () => listCategories(),
  ["public-categories-v1"],
  { revalidate: 300 }
);
