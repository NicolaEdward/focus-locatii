import type { CompanyEntity } from "@/lib/company-entities";
import type { UserRole } from "@/lib/rbac";

export type LocationSelectionAvailabilityState = "AVAILABLE" | "CONFLICT" | "PARTIAL" | "UNKNOWN";
export type LocationSelectionAvailabilityTone = "green" | "red" | "yellow" | "gray";

export type LocationSelectionSnapshot = {
  id: string;
  code: string;
  name?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  mediaType?: string | null;
  category?: string | null;
  dimensions?: string | null;
  surface?: number | null;
  mainImage?: string | null;
  productionSketchUrl?: string | null;
  displayLat?: number | null;
  displayLng?: number | null;
  publicDescription?: string | null;
};

export type LocationSelectionItem = {
  locationId: string;
  sortOrder: number;
  snapshot: LocationSelectionSnapshot;
  availabilityState: LocationSelectionAvailabilityState;
  availabilityWarnings: string[];
  suggestedBasePrice?: number | null;
  currency?: string | null;
  notes?: string | null;
};

export type LocationSelectionPayload = {
  companyEntity?: CompanyEntity | string;
  periodStart?: string;
  periodEnd?: string;
  selectedLocations: LocationSelectionItem[];
};

export type LocationSelectionLocationDTO = {
  id: string;
  code: string;
  name: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  mediaType: string | null;
  category: string | null;
  dimensions: string | null;
  surface: number | null;
  thumbnail: string | null;
  productionSketchUrl: string | null;
  hasProductionSketch: boolean;
  displayLat: number | null;
  displayLng: number | null;
  status: string;
  visibility: "PUBLIC" | "HIDDEN";
  isPremium: boolean;
  isFeatured: boolean;
  hasImage: boolean;
  publicDescription: string | null;
  suggestedBasePrice: number | null;
  rateCard: string | null;
  currency: string | null;
  updatedAt: string;
};

export type LocationSelectionFilters = {
  search?: string | null;
  city?: string | null;
  area?: string | null;
  mediaType?: string | null;
  mediaTypes?: string[] | null;
  availability?: LocationSelectionAvailabilityState | "ALL" | "PROPOSABLE" | "CURRENT_AVAILABLE" | "FUTURE_BOOKINGS" | "CURRENT_CONFLICT" | null;
  status?: string | null;
  minSurface?: number | null;
  maxSurface?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  hasImage?: boolean | null;
  hasPublicPrice?: boolean | null;
  selectedIds?: string[];
  sort?: "selected" | "availability" | "code" | "city" | "surface_desc" | "price_asc" | "price_desc" | "updated_desc";
};

export type LocationSelectionOptionSets = {
  cities: string[];
  areas: string[];
  mediaTypes: string[];
  categories: string[];
  statuses: string[];
};

export type LocationSelectionConflict = {
  reservationId: string;
  locationId: string;
  status: "HOLD" | "RESERVED" | "BOOKED" | string;
  periodStart: string;
  periodEnd: string;
  clientName: string | null;
  campaignName: string | null;
  sellerName: string | null;
};

export type LocationSelectionBlockingInterval = {
  status: "HOLD" | "RESERVED" | "BOOKED" | string;
  start: string;
  end: string;
};

export type LocationSelectionAvailability = {
  locationId: string;
  state: LocationSelectionAvailabilityState;
  label: string;
  tone: LocationSelectionAvailabilityTone;
  explanation: string;
  warnings: string[];
  conflicts: LocationSelectionConflict[];
  blockingIntervals: LocationSelectionBlockingInterval[];
  availableUntil?: string | null;
  availableFrom?: string | null;
};

export type LocationSelectionResponse = {
  locations: LocationSelectionLocationDTO[];
  options: LocationSelectionOptionSets;
  permissions: {
    role: UserRole;
    canSeeCommercialPrices: boolean;
  };
};

export type MediaPlanSeed = LocationSelectionPayload & {
  source: "ADMIN_LOCATION_SELECTOR";
  generatedAt: string;
};
