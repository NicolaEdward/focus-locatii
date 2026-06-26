import type { GpsAuditStatus, LocationDTO } from "@/types/location";

type Coords = {
  lat: number;
  lng: number;
};

const ROMANIA_BOUNDS = {
  minLat: 43.4,
  maxLat: 48.4,
  minLng: 20.1,
  maxLng: 29.9
};

const CITY_CENTERS: Record<string, Coords> = {
  bucuresti: { lat: 44.4268, lng: 26.1025 },
  bucharest: { lat: 44.4268, lng: 26.1025 },
  otopeni: { lat: 44.5711, lng: 26.085 },
  giurgiu: { lat: 43.9037, lng: 25.9699 },
  ploiesti: { lat: 44.9367, lng: 26.0129 },
  brasov: { lat: 45.6579, lng: 25.6012 },
  constanta: { lat: 44.1598, lng: 28.6348 }
};

export function extractCoordinatesFromMapsUrl(url?: string | null): Coords | null {
  if (!url) return null;
  const decoded = decodeURIComponent(url);

  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

export function mapsHref(url?: string | null, lat?: number | null, lng?: number | null) {
  const trimmed = String(url || "").trim();

  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    const coords = extractCoordinatesFromMapsUrl(trimmed);
    if (coords && isInsideRomania(coords.lat, coords.lng)) return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  }

  if (lat != null && lng != null && isInsideRomania(lat, lng)) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  return "#";
}

export function isInsideRomania(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return false;
  return (
    lat >= ROMANIA_BOUNDS.minLat &&
    lat <= ROMANIA_BOUNDS.maxLat &&
    lng >= ROMANIA_BOUNDS.minLng &&
    lng <= ROMANIA_BOUNDS.maxLng
  );
}

function haversineKm(a: Coords, b: Coords) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function auditCoordinates(input: {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}): { status: GpsAuditStatus; message: string } {
  if (input.lat == null || input.lng == null) {
    return { status: "MISSING", message: "Coordinates are missing." };
  }

  if (!isInsideRomania(input.lat, input.lng)) {
    return { status: "SUSPECT", message: "Coordinates are outside Romania bounds." };
  }

  const cityKey = String(input.city || "").trim().toLowerCase();
  const center = CITY_CENTERS[cityKey];

  if (center) {
    const distance = haversineKm(center, { lat: input.lat, lng: input.lng });
    if (distance > 75) {
      return {
        status: "SUSPECT",
        message: `Coordinates are about ${Math.round(distance)} km away from ${input.city}.`
      };
    }
  }

  return { status: "OK", message: "Coordinates look valid." };
}

export function spreadOverlappingLocations<T extends Pick<LocationDTO, "latReal" | "lngReal" | "latDisplay" | "lngDisplay">>(
  locations: T[],
  radiusMeters = 18
) {
  const groups = new Map<string, T[]>();

  for (const location of locations) {
    const lat = location.latReal;
    const lng = location.lngReal;
    if (lat == null || lng == null) continue;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    groups.set(key, [...(groups.get(key) || []), location]);
  }

  const earthMetersPerDegree = 111_320;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const baseLat = group[0].latReal;
    const baseLng = group[0].lngReal;
    if (baseLat == null || baseLng == null) continue;

    group.forEach((location, index) => {
      const angle = (Math.PI * 2 * index) / group.length;
      const meters = radiusMeters + Math.floor(index / 8) * 12;
      const dLat = (Math.sin(angle) * meters) / earthMetersPerDegree;
      const dLng = (Math.cos(angle) * meters) / (earthMetersPerDegree * Math.cos((baseLat * Math.PI) / 180));
      location.latDisplay = baseLat + dLat;
      location.lngDisplay = baseLng + dLng;
    });
  }

  return locations;
}
