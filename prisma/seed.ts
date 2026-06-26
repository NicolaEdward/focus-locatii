import { PrismaClient } from "@prisma/client";
import { spreadOverlappingLocations } from "../src/lib/gps";
import { loadLocalEnv } from "../scripts/load-env";

loadLocalEnv();
const prisma = new PrismaClient();

const categoryName = "Aeroportul Henri Coanda";

const samples = [
  {
    code: "EPZP7A",
    address: "Departures Extension - Public Area - Entrance Doors D",
    type: "Vinyl sticker",
    size: "Dual door-panel",
    sqm: 19.1,
    image: "/samples/EPZP7A.svg",
    availabilityText: "Available",
    status: "AVAILABLE" as const,
    latReal: 44.57125,
    lngReal: 26.08508,
    benefits: [
      "Dual door-panel advertising placement",
      "Strong passenger visibility at the departures extension",
      "Exposure from both inside and outside approaches"
    ],
    mediaDetails: ["Format: Vinyl sticker", "Surface area: 19.10 sqm", "Airport code: OTP"],
    campaignDetails: ["Installation & Removal available", "Production on request"]
  },
  {
    code: "EPZP8A",
    address: "Departures E - Public Area - Entrance Doors E",
    type: "Vinyl sticker",
    size: "Door-panel advertising",
    sqm: 19.1,
    image: "/samples/EPZP8A.svg",
    availabilityText: "Available",
    status: "AVAILABLE" as const,
    latReal: 44.57125,
    lngReal: 26.08508,
    benefits: [
      "Dual door-panel advertising placement",
      "Strong passenger visibility in the departures area",
      "Exposure from both inside and outside approaches"
    ],
    mediaDetails: ["Format: Vinyl sticker", "Placement: Door-panel advertising", "Airport code: OTP"],
    campaignDetails: ["Installation & Removal available", "Production on request"]
  },
  {
    code: "SZPP7",
    address: "Arrivals - Public Area - Ground Floor - Carrefour",
    type: "Vinyl sticker",
    size: "Entrance doors",
    sqm: 24.12,
    image: "/samples/SZPP7.svg",
    availabilityText: "From 01.07.2026",
    status: "AVAILABLE_FROM" as const,
    latReal: 44.57125,
    lngReal: 26.08508,
    benefits: ["High dwell time", "Strong pedestrian exposure", "Premium airport environment"],
    mediaDetails: ["Format: Vinyl sticker", "Environment: Arrivals public area", "Airport code: OTP"],
    campaignDetails: ["Installation & Removal available", "Production on request"]
  },
  {
    code: "SZPP8",
    address: "Arrivals - Public Area - Ground Floor - STB Ticket Desk",
    type: "Vinyl sticker",
    size: "Entrance doors",
    sqm: 24.12,
    image: "/samples/SZPP8.svg",
    availabilityText: "From 01.07.2026",
    status: "AVAILABLE_FROM" as const,
    latReal: 44.57125,
    lngReal: 26.08508,
    benefits: ["High dwell time", "Strong pedestrian exposure", "Premium airport environment"],
    mediaDetails: ["Format: Vinyl sticker", "Environment: Arrivals public area", "Airport code: OTP"],
    campaignDetails: ["Installation & Removal available", "Production on request"]
  },
  {
    code: "SBB1L",
    address: "Baggage Belt 1 - Base Sticker",
    type: "Base sticker",
    size: "Continuous wrap-around sticker",
    sqm: 25.21,
    image: "/samples/SBB1L.svg",
    availabilityText: "Available",
    status: "AVAILABLE" as const,
    latReal: 44.57125,
    lngReal: 26.08508,
    benefits: [
      "Continuous wrap-around sticker placement",
      "Excellent dwell time in the arrivals area",
      "Visible from multiple passenger angles"
    ],
    mediaDetails: ["Format: Base sticker", "Environment: Arrivals baggage area", "Airport code: OTP"],
    campaignDetails: ["Installation & Removal available", "Production on request"]
  }
];

async function main() {
  const category = await prisma.category.upsert({
    where: { slug: "aeroportul-henri-coanda" },
    update: { name: categoryName, sortOrder: 0 },
    create: {
      name: categoryName,
      slug: "aeroportul-henri-coanda",
      description: "Premium airport media locations",
      sortOrder: 0
    }
  });

  const spread = spreadOverlappingLocations(samples.map((sample) => ({ ...sample, latDisplay: sample.latReal, lngDisplay: sample.lngReal })));

  for (const sample of spread) {
    const location = await prisma.location.upsert({
      where: { code: sample.code },
      update: {
        categoryId: category.id,
        city: "Otopeni",
        county: "Ilfov",
        address: sample.address,
        type: sample.type,
        size: sample.size,
        sqm: sample.sqm,
        illum: true,
        availabilityText: sample.availabilityText,
        status: sample.status,
        latReal: sample.latReal,
        lngReal: sample.lngReal,
        latDisplay: sample.latDisplay,
        lngDisplay: sample.lngDisplay,
        mainPhotoUrl: sample.image,
        showPricePublic: false,
        showInstallationCostPublic: false,
        showInPublic: true,
        isPremium: true,
        isFeatured: true,
        coordinateSource: "seed",
        gpsAuditStatus: "OK",
        benefits: sample.benefits,
        mediaDetails: sample.mediaDetails,
        campaignDetails: sample.campaignDetails
      },
      create: {
        nr: sample.code,
        code: sample.code,
        categoryId: category.id,
        city: "Otopeni",
        county: "Ilfov",
        address: sample.address,
        type: sample.type,
        size: sample.size,
        sqm: sample.sqm,
        illum: true,
        availabilityText: sample.availabilityText,
        status: sample.status,
        latReal: sample.latReal,
        lngReal: sample.lngReal,
        latDisplay: sample.latDisplay,
        lngDisplay: sample.lngDisplay,
        mainPhotoUrl: sample.image,
        showPricePublic: false,
        showInstallationCostPublic: false,
        showInPublic: true,
        isPremium: true,
        isFeatured: true,
        coordinateSource: "seed",
        gpsAuditStatus: "OK",
        benefits: sample.benefits,
        mediaDetails: sample.mediaDetails,
        campaignDetails: sample.campaignDetails
      }
    });

    await prisma.image.upsert({
      where: { id: `${location.id}-main` },
      update: {
        url: sample.image,
        alt: sample.code,
        isMain: true
      },
      create: {
        id: `${location.id}-main`,
        locationId: location.id,
        url: sample.image,
        alt: sample.code,
        sortOrder: 0,
        isMain: true
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
