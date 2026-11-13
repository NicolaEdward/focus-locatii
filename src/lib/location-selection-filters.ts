import type { LocationSelectionFilters, LocationSelectionLocationDTO } from "@/lib/location-selection-dto";

export function normalizeSelectionSearch(value?: string | null) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("ro").trim();
}

/** Shared by server discovery and the visible shortlist. Unknown prices/sizes do
 * not satisfy numeric constraints, and a budget here is monthly per face. */
export function matchesLocationSelectionFilters(location: LocationSelectionLocationDTO, filters: LocationSelectionFilters) {
  const words = normalizeSelectionSearch(filters.search).split(/\s+/).filter(Boolean);
  const searchable = normalizeSelectionSearch([location.code, location.name, location.address, location.city, location.area, location.mediaType, location.category].join(" "));
  if (words.some((word) => !searchable.includes(word))) return false;
  if (filters.city && normalizeSelectionSearch(location.city) !== normalizeSelectionSearch(filters.city)) return false;
  if (filters.area && normalizeSelectionSearch(location.area) !== normalizeSelectionSearch(filters.area)) return false;
  const formats = filters.mediaTypes?.length ? filters.mediaTypes : filters.mediaType ? [filters.mediaType] : [];
  if (formats.length && !formats.includes(location.mediaType || "") && !formats.includes(location.category || "")) return false;
  if (filters.status && location.status !== filters.status) return false;
  if (filters.minSurface != null && (location.surface == null || location.surface < filters.minSurface)) return false;
  if (filters.maxSurface != null && (location.surface == null || location.surface > filters.maxSurface)) return false;
  if (filters.minPrice != null && (location.suggestedBasePrice == null || !location.currency || location.suggestedBasePrice < filters.minPrice)) return false;
  if (filters.maxPrice != null && (location.suggestedBasePrice == null || !location.currency || location.suggestedBasePrice > filters.maxPrice)) return false;
  if (filters.hasImage === true && !location.hasImage) return false;
  return true;
}

export function sortSelectionLocations(locations: LocationSelectionLocationDTO[], sort: LocationSelectionFilters["sort"]) {
  const compare = (a: string, b: string) => a.localeCompare(b, "ro");
  return [...locations].sort((left, right) => {
    if (sort === "city") return compare(left.city || "", right.city || "") || compare(left.code, right.code);
    if (sort === "surface_desc") return (right.surface ?? -1) - (left.surface ?? -1) || compare(left.code, right.code);
    if (sort === "price_asc" || sort === "price_desc") {
      if (left.suggestedBasePrice == null) return right.suggestedBasePrice == null ? compare(left.code, right.code) : 1;
      if (right.suggestedBasePrice == null) return -1;
      return (sort === "price_asc" ? left.suggestedBasePrice - right.suggestedBasePrice : right.suggestedBasePrice - left.suggestedBasePrice) || compare(left.code, right.code);
    }
    if (sort === "updated_desc") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || compare(left.code, right.code);
    return compare(left.code, right.code);
  });
}
