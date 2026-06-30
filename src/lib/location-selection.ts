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
  LocationSelectionItem,
  LocationSelectionLocationDTO,
  LocationSelectionOptionSets,
  LocationSelectionPayload,
  LocationSelectionResponse,
  LocationSelectionSnapshot,
  MediaPlanSeed
} from "@/lib/location-selection-dto";

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

export function toSelectionSnapshot(location: LocationSelectionLocationDTO): LocationSelectionSnapshot {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    city: location.city,
    area: location.area,
    address: location.address,
    mediaType: location.mediaType,
    category: location.category,
    dimensions: location.dimensions,
    surface: location.surface,
    mainImage: location.thumbnail,
    productionSketchUrl: location.productionSketchUrl,
    displayLat: location.displayLat,
    displayLng: location.displayLng,
    publicDescription: location.publicDescription
  };
}

export function buildMediaPlanSeedFromSelection(selection: LocationSelectionPayload): MediaPlanSeed {
  return {
    source: "ADMIN_LOCATION_SELECTOR",
    generatedAt: new Date().toISOString(),
    companyEntity: selection.companyEntity,
    periodStart: selection.periodStart,
    periodEnd: selection.periodEnd,
    selectedLocations: selection.selectedLocations.map((item, index) => sanitizeSelectionItem(item, index))
  };
}

export function selectionQualityWarnings(selection: LocationSelectionPayload) {
  const warnings: string[] = [];
  if (!selection.periodStart) warnings.push("Alege perioada pentru verificare exacta.");
  else if (!selection.periodEnd) warnings.push("Completeaza finalul campaniei cand perioada este confirmata.");
  if (!selection.selectedLocations.length) warnings.push("Nu ai selectat locatii.");
  const conflicts = selection.selectedLocations.filter((item) => item.availabilityState === "CONFLICT").length;
  if (conflicts) warnings.push(`${conflicts} locatii selectate au conflict in perioada aleasa.`);
  const missingImages = selection.selectedLocations.filter((item) => !item.snapshot.mainImage).length;
  if (missingImages) warnings.push(`${missingImages} locatii nu au imagine.`);
  const missingPrices = selection.selectedLocations.filter((item) => item.suggestedBasePrice == null).length;
  if (missingPrices) warnings.push(`${missingPrices} locatii nu au pret setat.`);
  const byArea = new Map<string, number>();
  for (const item of selection.selectedLocations) {
    const area = item.snapshot.area || item.snapshot.city || "";
    if (!area) continue;
    byArea.set(area, (byArea.get(area) || 0) + 1);
  }
  const denseArea = [...byArea.entries()].find(([, count]) => count >= 5);
  if (denseArea) warnings.push(`Ai selectat multe locatii din zona ${denseArea[0]}.`);
  if (selection.selectedLocations.length && selection.selectedLocations.some((item) => item.availabilityState === "UNKNOWN")) {
    warnings.push("Verifica disponibilitatea inainte de ofertare.");
  }
  return warnings;
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

function sanitizeSelectionItem(item: LocationSelectionItem, index: number): LocationSelectionItem {
  return {
    locationId: item.locationId,
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
    snapshot: {
      id: item.snapshot.id,
      code: item.snapshot.code,
      name: item.snapshot.name || null,
      city: item.snapshot.city || null,
      area: item.snapshot.area || null,
      address: item.snapshot.address || null,
      mediaType: item.snapshot.mediaType || null,
      category: item.snapshot.category || null,
      dimensions: item.snapshot.dimensions || null,
      surface: item.snapshot.surface ?? null,
      mainImage: item.snapshot.mainImage || null,
      productionSketchUrl: item.snapshot.productionSketchUrl || null,
      displayLat: item.snapshot.displayLat ?? null,
      displayLng: item.snapshot.displayLng ?? null,
      publicDescription: item.snapshot.publicDescription || null
    },
    availabilityState: item.availabilityState,
    availabilityWarnings: item.availabilityWarnings.slice(0, 10),
    suggestedBasePrice: item.suggestedBasePrice ?? null,
    currency: item.currency || null,
    notes: item.notes || null
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
