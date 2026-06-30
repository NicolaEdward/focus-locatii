import { z } from "zod";

export const locationStatusSchema = z.enum([
  "AVAILABLE",
  "AVAILABLE_FROM",
  "BOOKED",
  "RESERVED",
  "UNKNOWN"
]);

export const gpsAuditStatusSchema = z.enum([
  "OK",
  "CORRECTED",
  "MISSING",
  "NEEDS_CONFIRMATION",
  "SUSPECT"
]);

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}, z.number().nullable().optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "da"].includes(String(value).toLowerCase());
}, z.boolean().nullable().optional());

const optionalDate = z.preprocess((value) => {
  if (value === "" || value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}, z.date().nullable().optional());

export const locationInputSchema = z.object({
  nr: z.string().nullable().optional(),
  code: z.string().min(1),
  categoryName: z.string().min(1),
  city: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  sqm: optionalNumber,
  illum: optionalBoolean,
  rateCard: z.string().nullable().optional(),
  rateCardValue: optionalNumber,
  installationRemoval: z.string().nullable().optional(),
  installationRemovalValue: optionalNumber,
  availabilityText: z.string().nullable().optional(),
  availableFrom: optionalDate,
  availableUntil: optionalDate,
  bookedFrom: optionalDate,
  bookedUntil: optionalDate,
  status: locationStatusSchema.default("UNKNOWN"),
  latReal: optionalNumber,
  lngReal: optionalNumber,
  latDisplay: optionalNumber,
  lngDisplay: optionalNumber,
  mapsUrl: z.string().nullable().optional(),
  mainPhotoUrl: z.string().nullable().optional(),
  photoOriginalUrl: z.string().nullable().optional(),
  productionSketchUrl: z.string().nullable().optional(),
  showPricePublic: z.boolean().default(false),
  showInstallationCostPublic: z.boolean().default(false),
  showInPublic: z.boolean().default(true),
  isPremium: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  normalizedLocationName: z.string().nullable().optional(),
  reportingGroupName: z.string().nullable().optional(),
  displayOrder: optionalNumber,
  locationGroupOrder: optionalNumber,
  faceOrder: optionalNumber,
  directionOrder: optionalNumber,
  monthlyCost: optionalNumber,
  costCurrency: z.enum(["RON", "EUR"]).nullable().optional(),
  costType: z.string().nullable().optional(),
  costSupplier: z.string().nullable().optional(),
  costNotes: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
  blockedByUserId: z.string().nullable().optional(),
  blockedFrom: optionalDate,
  blockedUntil: optionalDate,
  blockedNotes: z.string().nullable().optional(),
  coordinateSource: z.string().nullable().optional(),
  gpsAuditStatus: gpsAuditStatusSchema.default("NEEDS_CONFIRMATION"),
  benefits: z.array(z.string()).default([]),
  mediaDetails: z.array(z.string()).default([]),
  campaignDetails: z.array(z.string()).default([]),
  imageUrls: z.array(z.string()).optional(),
  internalNotes: z.string().nullable().optional()
});

export const locationPatchSchema = locationInputSchema.partial().extend({
  categoryName: z.string().min(1).optional()
});
