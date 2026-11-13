import type { Prisma } from "@prisma/client";
import { companyEntities } from "@/lib/company-entities";
import { matchesLocationSelectionFilters, sortSelectionLocations } from "@/lib/location-selection-filters";
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
  const commercialPolicy = canSeeCommercialPrices(session)
    ? await prisma.commercialPolicy.findUnique({ where: { id: "default" }, select: { rateCardCurrency: true } }) : null;
  const verifiedCurrency = commercialPolicy && ["RON", "EUR"].includes(commercialPolicy.rateCardCurrency) ? commercialPolicy.rateCardCurrency : null;
  // Normalized formats depend on more than the raw type column. Walk bounded
  // database chunks, then filter before applying the public page boundary. A
  // matching face after the first 500 must remain discoverable.
  const matching: LocationSelectionLocationDTO[] = [];
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.location.findMany({ where, select: selectionLocationSelect,
      orderBy: { id: "asc" }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      const location = serializeSelectionLocation(row, session, verifiedCurrency);
      if (matchesLocationSelectionFilters(location, filters)) matching.push(location);
    }
    if (rows.length < 250) break;
    cursor = rows[rows.length - 1].id;
  }
  const ordered = sortSelectionLocations(matching, filters.sort);
  const offset = Math.max(0, Math.trunc(filters.offset || 0));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(filters.pageSize || 100)));
  const locations = ordered.slice(offset, offset + pageSize);
  return {
    locations,
    page: { offset, pageSize, total: ordered.length, hasMore: offset + locations.length < ordered.length },
    priceCurrency: verifiedCurrency,
    options: optionSets(ordered),
    permissions: { role: session.role, canSeeCommercialPrices: canSeeCommercialPrices(session) }
  };
}

export function companyEntityOptions() {
  return companyEntities.map((entity) => ({ value: entity.value, label: entity.label }));
}

function serializeSelectionLocation(row: SelectionLocationRow, session: AuthSession, verifiedCurrency: string | null): LocationSelectionLocationDTO {
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
    currency: canSeePrices && row.rateCardValue != null ? verifiedCurrency : null,
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
  const clauses: Prisma.LocationWhereInput[] = [{ lifecycleStatus: "ACTIVE" }];
  if (filters.selectedIds?.length) clauses.push({ id: { in: [...new Set(filters.selectedIds)].slice(0, 50) } });
  // Keep OR clauses inside AND: a photo requirement must not overwrite search.
  for (const search of (filters.search || "").trim().split(/\s+/).filter(Boolean).slice(0, 12)) clauses.push({ OR: [
    { code: { contains: search } }, { address: { contains: search } }, { city: { contains: search } },
    { county: { contains: search } }, { type: { contains: search } },
    { normalizedLocationName: { contains: search } }, { reportingGroupName: { contains: search } },
    { category: { name: { contains: search } } }
  ] });
  if (filters.city) clauses.push({ city: filters.city });
  if (filters.area) clauses.push({ OR: [{ reportingGroupName: filters.area }, { county: filters.area }, { city: filters.area }] });
  if (filters.status) clauses.push({ status: filters.status as never });
  if (filters.minSurface != null || filters.maxSurface != null) clauses.push({ sqm: {
    ...(filters.minSurface != null ? { gte: filters.minSurface } : {}), ...(filters.maxSurface != null ? { lte: filters.maxSurface } : {})
  } });
  if (filters.minPrice != null || filters.maxPrice != null) clauses.push({ rateCardValue: {
    ...(filters.minPrice != null ? { gte: filters.minPrice } : {}), ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {})
  } });
  if (filters.hasImage === true) clauses.push({ OR: [{ mainPhotoUrl: { not: null } }, { images: { some: {} } }] });
  if (filters.hasPublicPrice === true) clauses.push({ showPricePublic: true });
  return { AND: clauses };
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
