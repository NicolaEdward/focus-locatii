import type { LocationDTO } from "@/types/location";

export function mediaPlanMessage(locations: LocationDTO[]) {
  if (!locations.length) {
    return "Buna ziua, doresc mai multe informatii despre portofoliul Focus Media.";
  }

  return [
    "Buna ziua, sunt interesat de urmatoarele locatii Focus Media:",
    ...locations.map((location) => `- ${location.address || location.code} (${location.code}) - ${location.categoryName}`)
  ].join("\n");
}

export function selectedSqm(locations: LocationDTO[]) {
  return locations.reduce((sum, location) => sum + (location.sqm || 0), 0);
}
