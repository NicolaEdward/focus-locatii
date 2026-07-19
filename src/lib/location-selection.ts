import type { Prisma } from "@prisma/client";
import { companyEntities } from "@/lib/company-entities";
import { normalizeMediaType } from "@/lib/format";
import { isProductionSketchImage } from "@/lib/location-images";
import { displayPhotoUrl, samplePhotoForCode } from "@/lib/photos";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import type { AuthSession } from "@/lib/auth";
import type {
  LocationSelectionFilters,
  LocationSelectionLocationDTO,
  LocationSelectionOptionSets,
  LocationSelectionResponse
} from "@/lib/location-selection-dto";

export {
  buildMediaPlanSeedFromSelection,
  selectionQualityWarnings,
  toSelectionSnapshot
} from "@/lib/location-selection-client";

const selectionLocationSelect = {
  id: true,
  code: true,
  address: true,
  city: true,
  county: true,
  type: true,
  size: true,
  sqm: true,
  rateCard: true,
  rateCardValue: true,
  status: true,
  lifecycleStatus: true,
  showInPublic: true,
  showPricePublic: true,
  isPremium: true,
  isFeatured: true,
  mainPhotoUrl: true,
  reportingGroupName: true,
  normalizedLocationName: true,
  benefits: true,
  mediaDetails: true,
  campaignDetails: true,
  latDisplay: true,
  lngDisplay: true,
  updatedAt: true,
  category: { select: { name: true, slug: true } },
  images: {
    select: { url: true, alt: true, isMain: true, sortOrder: true },
    orderBy: [{ isMain: "desc" as const }, { sortOrder: "asc" as const }]
  }
} satisfies Prisma.LocationSelect;

type SelectionLocationRow = Prisma.LocationGetPayload<{ select: typeof selectionLocationSelect }>;

export async function listLocationSelectionLocations(
  filters: LocationSelectionFilters,
  session: AuthSession
): Promise<LocationSelectionResponse> {
  const where = selectionWhere(filters);
  const rows = await prisma.location.findMany({
    where,
    select: selectionLocationSelect,
    orderBy: selectionOrderBy(filters.sort),
    take: 500
  });
  const locations = rows.map((row) => serializeSelectionLocation(row, session));
  const filtered = applyClientSafeFilters(locations, filters);

  return {
    locations: filtered,
    options: optionSets(locations),
    permissions: {
      role: session.role,
      canSeeCommercialPrices: canSeeCommercialPrices(session)
    }
  };
}

export function companyEntityOptions() {
  return companyEntities.map((entity) => ({ value: entity.value, label: entity.label }));
}

function serializeSelectionLocation(row: SelectionLocationRow, session: AuthSession): LocationSelectionLocationDTO {
  const type = normalizeMediaType(row.type, row.category.name, row.address, row.code);
  const regularImages = row.images.filter((image) => !isProductionSketchImage(image));
  const productionSketch = row.images.find(isProductionSketchImage);
  const mainImage = row.mainPhotoUrl || regularImages.find((image) => image.isMain)?.url || regularImages[0]?.url || samplePhotoForCode(row.code);
  const canSeePrices = canSeeCommercialPrices(session);

  return {
    id: row.id,
    code: row.code,
    name: row.normalizedLocationName || row.address || row.code,
    city: row.city,
    area: row.reportingGroupName || row.county || row.city,
    address: row.address,
    mediaType: type,
    category: row.category.name,
    dimensions: row.size,
    surface: row.sqm,
    thumbnail: displayPhotoUrl(mainImage),
    productionSketchUrl: displayPhotoUrl(productionSketch?.url) || null,
    hasProductionSketch: Boolean(productionSketch?.url),
    displayLat: validCoordinate(row.latDisplay, row.lngDisplay) ? row.latDisplay : null,
    displayLng: validCoordinate(row.latDisplay, row.lngDisplay) ? row.lngDisplay : null,
    status: row.status,
    visibility: row.showInPublic ? "PUBLIC" : "HIDDEN",
    isPremium: row.isPremium,
    isFeatured: row.isFeatured,
    hasImage: Boolean(row.mainPhotoUrl || regularImages.length),
    publicDescription: selectionDescription(row),
    suggestedBasePrice: canSeePrices ? row.rateCardValue : null,
    rateCard: canSeePrices ? row.rateCard : null,
    currency: canSeePrices && row.rateCardValue != null ? "EUR" : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

function selectionDescription(row: SelectionLocationRow) {
  const values = [jsonStringList(row.benefits)[0], jsonStringList(row.campaignDetails)[0], jsonStringList(row.mediaDetails)[0]]
    .filter(Boolean)
    .slice(0, 2);
  return values.length ? values.join(" | ") : null;
}

function selectionWhere(filters: LocationSelectionFilters): Prisma.LocationWhereInput {
  const search = filters.search?.trim();
  return {
    lifecycleStatus: "ACTIVE",
    ...(search
      ? {
          OR: [
            { code: { contains: search } },
            { address: { contains: search } },
            { city: { contains: search } },
            { county: { contains: search } },
            { type: { contains: search } },
            { normalizedLocationName: { contains: search } },
            { reportingGroupName: { contains: search } }
          ]
        }
      : {}),
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.area ? { reportingGroupName: filters.area } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.hasImage === true ? { OR: [{ mainPhotoUrl: { not: null } }, { images: { some: {} } }] } : {}),
    ...(filters.hasPublicPrice === true ? { showPricePublic: true } : {})
  };
}

function applyClientSafeFilters(locations: LocationSelectionLocationDTO[], filters: LocationSelectionFilters) {
  const mediaTypes = filters.mediaTypes?.map((value) => value.trim()).filter(Boolean) || [];
  return locations.filter((location) => {
    if (filters.mediaType && location.mediaType !== filters.mediaType && location.category !== filters.mediaType) return false;
    if (mediaTypes.length && !mediaTypes.includes(location.mediaType || "") && !mediaTypes.includes(location.category || "")) return false;
    if (filters.minSurface != null && (location.surface == null || location.surface < filters.minSurface)) return false;
    if (filters.maxSurface != null && (location.surface == null || location.surface > filters.maxSurface)) return false;
    if (filters.minPrice != null && (location.suggestedBasePrice == null || location.suggestedBasePrice < filters.minPrice)) return false;
    if (filters.maxPrice != null && (location.suggestedBasePrice == null || location.suggestedBasePrice > filters.maxPrice)) return false;
    return true;
  });
}

function selectionOrderBy(sort: LocationSelectionFilters["sort"]): Prisma.LocationOrderByWithRelationInput[] {
  if (sort === "city") return [{ city: "asc" }, { code: "asc" }];
  if (sort === "surface_desc") return [{ sqm: "desc" }, { code: "asc" }];
  if (sort === "price_asc") return [{ rateCardValue: "asc" }, { code: "asc" }];
  if (sort === "price_desc") return [{ rateCardValue: "desc" }, { code: "asc" }];
  if (sort === "updated_desc") return [{ updatedAt: "desc" }];
  return [{ isFeatured: "desc" }, { isPremium: "desc" }, { code: "asc" }];
}

function optionSets(locations: LocationSelectionLocationDTO[]): LocationSelectionOptionSets {
  return {
    cities: uniqueSorted(locations.map((location) => location.city)),
    areas: uniqueSorted(locations.map((location) => location.area)),
    mediaTypes: uniqueSorted(locations.flatMap((location) => [location.mediaType, location.category])),
    categories: uniqueSorted(locations.map((location) => location.category)),
    statuses: uniqueSorted(locations.map((location) => location.status))
  };
}

function canSeeCommercialPrices(session: AuthSession) {
  return hasPermission(session.role, "inventory.view");
}

function jsonStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function validCoordinate(lat?: number | null, lng?: number | null) {
  return lat != null && lng != null && lat >= 43 && lat <= 49 && lng >= 20 && lng <= 30;
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ro")
  );
}
