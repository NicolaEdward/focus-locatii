const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const { serializeLocation } = loadTsModule(path.join(process.cwd(), "src", "lib", "locations.ts"), {
  "@/lib/prisma": { prisma: {} }
});
const fs = require("node:fs");

const visible = serializeLocation(location({
  showPricePublic: true,
  showInstallationCostPublic: true
}));
assert.equal(visible.rateCard, "1200 EUR/luna", "Public price text should be visible when enabled.");
assert.equal(visible.rateCardValue, 1200, "Public price value should be visible when enabled.");
assert.equal(visible.installationRemoval, "Montare 250 EUR", "Installation text should be visible when enabled.");
assert.equal(visible.installationRemovalValue, 250, "Installation value should be visible when enabled.");
assert.equal(visible.latDisplay, 44.43, "Display latitude should be exposed.");
assert.equal(visible.lngDisplay, 26.1, "Display longitude should be exposed.");
assert.equal("latReal" in visible, false, "Internal latitude key must not be exposed publicly.");
assert.equal("lngReal" in visible, false, "Internal longitude key must not be exposed publicly.");
assert.equal("mapsUrl" in visible, false, "Stored maps URL key may contain private coordinates and must not be exposed publicly.");
assert.equal("reservations" in visible, false, "Reservation details key must not be exposed publicly.");
assert.equal("internalNotes" in visible, false, "Internal notes key must not be exposed publicly.");
assert.equal("monthlyCost" in visible, false, "Internal cost key must not be exposed publicly.");
assert.equal("showPricePublic" in visible, false, "Internal price visibility flag must not be exposed publicly.");
assert.equal("showInstallationCostPublic" in visible, false, "Internal installation visibility flag must not be exposed publicly.");
assert.equal("lifecycleStatus" in visible, false, "Internal lifecycle status key must not be exposed publicly.");

const hidden = serializeLocation(location({
  showPricePublic: false,
  showInstallationCostPublic: false
}));
assert.equal("rateCard" in hidden, false, "Public price text key should be absent when disabled.");
assert.equal("rateCardValue" in hidden, false, "Public price value key should be absent when disabled.");
assert.equal("installationRemoval" in hidden, false, "Installation text key should be absent when disabled.");
assert.equal("installationRemovalValue" in hidden, false, "Installation value key should be absent when disabled.");
assert.equal(hidden.latDisplay, 44.43, "Display coordinates should remain public even when commercial fields are hidden.");
assert.equal("latReal" in hidden, false, "Hidden public DTO should not expose real latitude key.");
assert.equal("lngReal" in hidden, false, "Hidden public DTO should not expose real longitude key.");

const withSketch = serializeLocation(location({
  images: [
    image({ url: "https://cdn.example/gallery.jpg", alt: null, isMain: true }),
    image({ url: "https://cdn.example/sketch.pdf", alt: "PRODUCTION_SKETCH", sortOrder: 9999 })
  ]
}));
assert.equal(withSketch.productionSketchUrl, "https://cdn.example/sketch.pdf", "Public/commercial production sketch URL should be exposed deliberately.");
assert.equal(withSketch.images.length, 1, "Production sketch should not be mixed into the public gallery.");
assert.equal(withSketch.images[0].url, "https://cdn.example/gallery.jpg", "Regular gallery image should remain visible.");

const admin = serializeLocation(location({
  showPricePublic: false,
  showInstallationCostPublic: false
}), { includeHiddenCommercials: true, includePrivateFields: true });
assert.equal(admin.rateCardValue, 1200, "Admin DTO should still expose hidden price.");
assert.equal(admin.installationRemovalValue, 250, "Admin DTO should still expose hidden installation cost.");
assert.equal(admin.latReal, 44.44, "Admin DTO should expose real latitude.");
assert.equal(admin.lngReal, 26.11, "Admin DTO should expose real longitude.");
assert.equal(admin.mapsUrl, "https://maps.example/private", "Admin DTO should expose stored maps URL.");

const linkedBooked = serializeLocation(location({
  reservations: [reservation({ status: "BOOKED", clientId: "client-1", campaignId: "campaign-1" })]
}));
assert.equal(linkedBooked.publicStatus, "BOOKED", "BOOKED with client/campaign must block public availability.");

const legacyBooked = serializeLocation(location({
  reservations: [reservation({ status: "BOOKED", clientId: null, campaignId: null })]
}));
assert.equal(legacyBooked.publicStatus, "BOOKED", "Legacy BOOKED without client/campaign must still block public availability.");

const cancelledAndArchived = serializeLocation(location({
  reservations: [
    reservation({ status: "CANCELLED", clientId: null, campaignId: null }),
    reservation({ status: "ARCHIVED", clientId: null, campaignId: null })
  ]
}));
assert.equal(cancelledAndArchived.publicStatus, "AVAILABLE", "Cancelled/archived reservations must not block public availability.");

const portfolioHero = fs.readFileSync(path.join(process.cwd(), "src", "components", "public", "PortfolioHero.tsx"), "utf8");
assert(portfolioHero.includes('label: "Locatii libere"'), "Public hero should show free locations count.");
assert(!portfolioHero.includes('{ label: "Locatii",'), "Public hero must not expose total location count label.");
assert(!portfolioHero.includes('{ label: "Inchiriate",'), "Public hero must not expose rented/reserved count label.");
assert(!portfolioHero.includes("locations.length.toString()"), "Public hero must not expose total location count value.");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "price visible/hidden",
    "installation cost visible/hidden",
    "display coordinates exposed",
    "production sketch exposed as a deliberate public/commercial asset",
    "public hero shows only free locations count",
    "private coordinates hidden",
    "BOOKED blocks with or without client/campaign",
    "CANCELLED/ARCHIVED ignored"
  ]
}, null, 2));

function location(overrides = {}) {
  return {
    id: "loc-1",
    nr: "1",
    code: "FM-001",
    categoryId: "cat-1",
    category: { id: "cat-1", name: "Billboard", slug: "billboard", description: null, sortOrder: 1 },
    city: "Bucuresti",
    county: "Bucuresti",
    address: "Piata Test",
    type: "backlit",
    size: "4x3",
    sqm: 12,
    illum: true,
    rateCard: "1200 EUR/luna",
    rateCardValue: 1200,
    installationRemoval: "Montare 250 EUR",
    installationRemovalValue: 250,
    availabilityText: null,
    availableFrom: null,
    availableUntil: null,
    bookedFrom: null,
    bookedUntil: null,
    status: "AVAILABLE",
    lifecycleStatus: "ACTIVE",
    latReal: 44.44,
    lngReal: 26.11,
    latDisplay: 44.43,
    lngDisplay: 26.1,
    mapsUrl: "https://maps.example/private",
    mainPhotoUrl: null,
    photoOriginalUrl: "https://cdn.example/original.jpg",
    showPricePublic: false,
    showInstallationCostPublic: false,
    showInPublic: true,
    isPremium: false,
    isFeatured: false,
    normalizedLocationName: "piata test",
    reportingGroupName: null,
    displayOrder: null,
    locationGroupOrder: null,
    faceOrder: null,
    directionOrder: null,
    monthlyCost: 500,
    costCurrency: "EUR",
    costType: "rent",
    costSupplier: "Supplier",
    costNotes: "private",
    blockedReason: null,
    blockedByUserId: null,
    blockedFrom: null,
    blockedUntil: null,
    blockedNotes: null,
    coordinateSource: "manual",
    gpsAuditStatus: "OK",
    benefits: null,
    mediaDetails: null,
    campaignDetails: null,
    internalNotes: "private",
    images: [],
    reservations: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function image(overrides = {}) {
  return {
    id: `img-${Math.random().toString(36).slice(2)}`,
    locationId: "loc-1",
    url: "https://cdn.example/image.jpg",
    alt: null,
    sortOrder: 0,
    isMain: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function reservation(overrides = {}) {
  return {
    id: `res-${Math.random().toString(36).slice(2)}`,
    locationId: "loc-1",
    clientId: "client-1",
    campaignId: "campaign-1",
    status: "BOOKED",
    clientName: "Client",
    clientCompany: null,
    contractCompany: null,
    clientEmail: null,
    clientPhone: null,
    campaignName: null,
    contractNumber: null,
    salesperson: null,
    notes: null,
    productionNotes: null,
    amount: null,
    monthlyRentTotal: null,
    monthlyRentShare: null,
    contractGroupId: null,
    periodStart: new Date("2000-01-01T00:00:00.000Z"),
    periodEnd: new Date("2999-12-31T00:00:00.000Z"),
    installationDate: null,
    neutralizationDate: null,
    externalSource: null,
    externalId: null,
    bookedAt: new Date("2026-01-01T00:00:00.000Z"),
    holdExpiresAt: null,
    ownerId: "agent-1",
    sellerUserId: "agent-1",
    currency: "EUR",
    paymentTermType: null,
    paymentTermDays: null,
    customPaymentTermNote: null,
    billingRule: null,
    billingDayOfMonth: null,
    customBillingDate: null,
    billingFrequency: null,
    invoiceGenerationMode: null,
    nextInvoiceDate: null,
    billingNotes: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}
