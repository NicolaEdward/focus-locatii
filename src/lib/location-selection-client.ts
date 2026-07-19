import type {
  LocationSelectionItem,
  LocationSelectionLocationDTO,
  LocationSelectionPayload,
  LocationSelectionSnapshot,
  MediaPlanSeed
} from "@/lib/location-selection-dto";

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
