export type LocationStatus =
  | "AVAILABLE"
  | "AVAILABLE_FROM"
  | "BOOKED"
  | "RESERVED"
  | "UNKNOWN";

export type LocationLifecycleStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "ARCHIVED"
  | "MAINTENANCE";

export type PublicAvailabilityStatus =
  | "AVAILABLE"
  | "BOOKED"
  | "RESERVED"
  | "UNKNOWN";

export type GpsAuditStatus =
  | "OK"
  | "CORRECTED"
  | "MISSING"
  | "NEEDS_CONFIRMATION"
  | "SUSPECT";

export type ReservationStatus =
  | "HOLD"
  | "RESERVED"
  | "BOOKED"
  | "CANCELLED"
  | "EXPIRED";

export type OfferRequestStatus =
  | "NEW"
  | "CONTACTED"
  | "QUOTED"
  | "WON"
  | "LOST"
  | "ARCHIVED";

export type CrmLeadStatus =
  | "NEW"
  | "CONTACTED"
  | "OFFER_SENT"
  | "NEGOTIATION"
  | "RESERVATION_CREATED"
  | "WON"
  | "LOST";

export type LocationImage = {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isMain: boolean;
};

export type ReservationDTO = {
  id: string;
  locationId: string;
  clientId: string | null;
  campaignId: string | null;
  locationCode?: string;
  locationName?: string | null;
  status: ReservationStatus;
  clientName: string;
  clientCompany: string | null;
  contractCompany: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  campaignName: string | null;
  contractNumber: string | null;
  salesperson: string | null;
  notes: string | null;
  productionNotes: string | null;
  amount: number | null;
  monthlyRentTotal: number | null;
  monthlyRentShare: number | null;
  contractGroupId: string | null;
  periodStart: string;
  periodEnd: string;
  installationDate: string | null;
  neutralizationDate: string | null;
  externalSource: string | null;
  externalId: string | null;
  bookedAt: string | null;
  holdExpiresAt: string | null;
  ownerId: string | null;
  sellerUserId: string | null;
  currency: string | null;
  paymentTermType: string | null;
  paymentTermDays: number | null;
  customPaymentTermNote: string | null;
  billingRule: string | null;
  billingDayOfMonth: number | null;
  customBillingDate: string | null;
  billingFrequency: string | null;
  invoiceGenerationMode: string | null;
  nextInvoiceDate: string | null;
  billingNotes: string | null;
  createdAt: string;
  updatedAt: string;
  priceSegments?: Array<{
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    monthlyRent: number;
    currency: string;
    reason: string | null;
  }>;
  changeLogs?: Array<{
    id: string;
    action: string;
    note: string | null;
    previousJson: unknown;
    nextJson: unknown;
    createdByUserId: string | null;
    createdByName: string | null;
    createdAt: string;
  }>;
  billingSummary?: {
    billingItemCount: number;
    receivableCount: number;
    latestInvoiceDate: string | null;
    latestInvoiceNumber: string | null;
  };
};

export type OfferRequestDTO = {
  id: string;
  status: OfferRequestStatus;
  clientName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  selectedLocationIds: string[];
  selectedCodes: string | null;
  source: string | null;
  salesperson: string | null;
  crmStatus: CrmLeadStatus;
  estimatedValue: number | null;
  nextFollowUpAt: string | null;
  internalNotes: string | null;
  lastActivityAt: string | null;
  deletedAt: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationDTO = {
  id: string;
  nr: string | null;
  code: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  city: string | null;
  county: string | null;
  address: string | null;
  type: string | null;
  size: string | null;
  sqm: number | null;
  illum: boolean | null;
  rateCard: string | null;
  rateCardValue: number | null;
  installationRemoval: string | null;
  installationRemovalValue: number | null;
  availabilityText: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  bookedFrom: string | null;
  bookedUntil: string | null;
  status: LocationStatus;
  lifecycleStatus: LocationLifecycleStatus;
  publicStatus: PublicAvailabilityStatus;
  availabilityLabel: string;
  availabilityDetail: string | null;
  latReal: number | null;
  lngReal: number | null;
  latDisplay: number | null;
  lngDisplay: number | null;
  mapsUrl: string | null;
  mainPhotoUrl: string | null;
  photoOriginalUrl: string | null;
  productionSketchUrl: string | null;
  showPricePublic: boolean;
  showInstallationCostPublic: boolean;
  showInPublic: boolean;
  isPremium: boolean;
  isFeatured: boolean;
  normalizedLocationName: string | null;
  reportingGroupName: string | null;
  displayOrder: number | null;
  locationGroupOrder: number | null;
  faceOrder: number | null;
  directionOrder: number | null;
  monthlyCost: number | null;
  costCurrency: string | null;
  costType: string | null;
  costSupplier: string | null;
  costNotes: string | null;
  blockedReason: string | null;
  blockedByUserId: string | null;
  blockedFrom: string | null;
  blockedUntil: string | null;
  blockedNotes: string | null;
  coordinateSource: string | null;
  gpsAuditStatus: GpsAuditStatus;
  benefits: string[];
  mediaDetails: string[];
  campaignDetails: string[];
  internalNotes: string | null;
  images: LocationImage[];
  reservations: ReservationDTO[];
  createdAt: string;
  updatedAt: string;
};

export type CategoryDTO = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
};

export type ImportSummary = {
  batchId: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  missingGpsCount: number;
  suspectGpsCount: number;
  okGpsCount: number;
};
