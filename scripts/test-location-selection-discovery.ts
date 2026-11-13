import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "../src/lib/auth";
import type { LocationSelectionLocationDTO } from "../src/lib/location-selection-dto";
import { matchesLocationSelectionFilters, sortSelectionLocations } from "../src/lib/location-selection-filters";

const sample: LocationSelectionLocationDTO = { id: "sample", code: "SIM-BUC-001-A", name: "Intrarea lungă spre aeroport", city: "București", area: "Băneasa", address: "Aleea Exemplului", mediaType: "Mesh", category: "Aeroport", dimensions: "12 x 8", surface: 96, thumbnail: "/samples/location-placeholder.svg", productionSketchUrl: null, hasProductionSketch: false, displayLat: null, displayLng: null, status: "UNKNOWN", visibility: "HIDDEN", isPremium: false, isFeatured: false, hasImage: true, publicDescription: null, suggestedBasePrice: 1200, rateCard: null, currency: "EUR", updatedAt: "2026-11-13T00:00:00Z" };
let checks = 0;
function check(name: string) { checks++; console.log("✓ " + name); }
assert.equal(matchesLocationSelectionFilters(sample, { search: "BANEASA aeroport", city: "Bucuresti", mediaTypes: ["Mesh"], minSurface: 96, maxPrice: 1200 }), true);
assert.equal(matchesLocationSelectionFilters(sample, { search: "Baneasa gara" }), false);
assert.equal(matchesLocationSelectionFilters(sample, { area: "Centru" }), false);
check("composable city, zone, format, surface, price and multiword accent-insensitive search");
assert.equal(matchesLocationSelectionFilters({ ...sample, suggestedBasePrice: null }, { maxPrice: 1200 }), false);
assert.equal(matchesLocationSelectionFilters({ ...sample, currency: null }, { maxPrice: 1200 }), false);
assert.equal(matchesLocationSelectionFilters({ ...sample, surface: null }, { minSurface: 1 }), false);
assert.equal(matchesLocationSelectionFilters(sample, { minPrice: 1300, maxPrice: 1200 }), false);
check("unknown economics and invalid numeric ranges never look like zero or match a ceiling");
const prices = [null, 100, 0, 200].map((price, i) => ({ ...sample, id: String(i), suggestedBasePrice: price }));
assert.deepEqual(sortSelectionLocations(prices, "price_asc").map((x) => x.suggestedBasePrice), [0, 100, 200, null]);
assert.deepEqual(sortSelectionLocations(prices, "price_desc").map((x) => x.suggestedBasePrice), [200, 100, 0, null]);
check("price ordering preserves zero and places unknown prices last");
if (process.argv.includes("--pure")) { console.log(JSON.stringify({ ok: true, groups: checks, database: "not accessed" })); process.exit(0); }

async function main() {
  const { assertSyntheticEnvironment } = await import("./release/env-utils");
  assertSyntheticEnvironment();
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/focus_(preview|test)_/.test(url.pathname) || [process.env.NODE_ENV, process.env.APP_ENV, process.env.VERCEL_ENV].includes("production")) throw Error("Local isolated synthetic database required");
  const { prisma } = await import("../src/lib/prisma");
  const { listLocationSelectionLocations } = await import("../src/lib/location-selection");
  const { getLocationSelectionAvailability } = await import("../src/lib/location-selection-availability");
  const tag = "SIM-discovery-" + randomUUID();
  const locationIds = Array.from({ length: 620 }, (_, index) => tag + "-" + String(index).padStart(4, "0"));
  let categoryId = "", actorId = "", policyCreated = false;
  const before = await prisma.location.count();
  try {
    const actorRow = await prisma.user.create({ data: { name: tag, email: tag + "@example.invalid", role: "SALES_AGENT", passwordHash: "synthetic-no-login" } }); actorId = actorRow.id;
    const actor: AuthSession = { id: actorId, role: "SALES_AGENT", name: tag, email: actorRow.email, tokenVersion: actorRow.tokenVersion, iat: 1, exp: 9999999999 };
    if (!(await prisma.commercialPolicy.findUnique({ where: { id: "default" } }))) {
      await prisma.commercialPolicy.create({ data: { id: "default", vatRateBps: 2100, vatTreatment: "exclusive", rateCardCurrency: "EUR", approvedByUserId: actorId } }); policyCreated = true;
    }
    const category = await prisma.category.create({ data: { name: tag, slug: tag.toLowerCase() } }); categoryId = category.id;
    for (let offset = 0; offset < 620; offset += 250) await prisma.location.createMany({ data: locationIds.slice(offset, offset + 250).map((id, i) => {
      const n = offset + i;
      return { id, code: id, categoryId, city: n % 2 ? "SIM-Cluj" : "SIM-Bucuresti", reportingGroupName: n % 3 ? "SIM-Nord" : "SIM-Centru", address: tag + " Aleea " + n, type: n === 619 ? "Pasarela" : "Panou", sqm: n % 2 ? 36 : 12, rateCardValue: n === 0 ? null : n + 100, lifecycleStatus: "ACTIVE" as const, showInPublic: false, mainPhotoUrl: n % 2 ? "/samples/location-placeholder.svg" : null };
    }) });
    const page1 = await listLocationSelectionLocations({ search: tag, pageSize: 500, sort: "code" }, actor);
    assert.equal(page1.locations.length, 500); assert.equal(page1.page.total, 620); assert.equal(page1.page.hasMore, true);
    const page2 = await listLocationSelectionLocations({ search: tag, offset: 500, pageSize: 500, sort: "code" }, actor);
    assert.equal(page2.locations.length, 120); assert.equal(page2.page.hasMore, false);
    assert.equal(new Set([...page1.locations, ...page2.locations].map((x) => x.id)).size, 620);
    check("all 620 synthetic faces remain pageable with explicit total and no silent truncation");
    const exact = await listLocationSelectionLocations({ search: locationIds[619] }, actor);
    assert.deepEqual(exact.locations.map((x) => x.id), [locationIds[619]]);
    const normalized = await listLocationSelectionLocations({ search: tag, mediaTypes: ["Pasarela"] }, actor);
    assert.deepEqual(normalized.locations.map((x) => x.id), [locationIds[619]]);
    const selected = await listLocationSelectionLocations({ selectedIds: [locationIds[619]] }, actor);
    assert.deepEqual(selected.locations.map((x) => x.id), [locationIds[619]]);
    check("exact code, normalized format and selected-ID hydration find records beyond row 500");
    const composed = await listLocationSelectionLocations({ search: tag, city: "SIM-Cluj", area: "SIM-Nord", maxPrice: 150, minSurface: 36, hasImage: true, sort: "price_asc", pageSize: 500 }, actor);
    const expected = locationIds.filter((_, index) => index % 2 && index % 3 && index + 100 <= 150);
    assert.deepEqual(new Set(composed.locations.map((x) => x.id)), new Set(expected));
    const wrongPhotoSearch = await listLocationSelectionLocations({ search: "SIM-no-such-location", hasImage: true }, actor);
    assert.equal(wrongPhotoSearch.page.total, 0, "photo OR must not replace text search");
    check("composed filters run before pagination and photo requirement never overwrites search");
    await prisma.reservation.create({ data: { locationId: locationIds[619], status: "BOOKED", clientName: tag, ownerId: actorId, sellerUserId: actorId, periodStart: new Date("2093-02-01"), periodEnd: new Date("2093-02-28"), currency: "EUR", monthlyRentShare: 700 } });
    const info = (await getLocationSelectionAvailability({ locationIds: [locationIds[619]], periodStart: "2093-01-01", periodEnd: "2093-03-31", session: actor }))[locationIds[619]];
    assert.equal(info.state, "PARTIAL");
    assert.deepEqual(info.availableWindows?.map((x) => [x.start.slice(0, 10), x.end.slice(0, 10)]), [["2093-01-01", "2093-01-31"], ["2093-03-01", "2093-03-31"]]);
    check("partial availability carries both exact free windows from the canonical decision engine");
    console.log(JSON.stringify({ ok: true, groups: checks, inventory_fixture: 620, database: "isolated local synthetic", production_writes: 0 }));
  } finally {
    await prisma.reservation.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (policyCreated) await prisma.commercialPolicy.delete({ where: { id: "default" } });
    if (actorId) await prisma.user.delete({ where: { id: actorId } });
    assert.equal(await prisma.location.count(), before, "temporary discovery fixture is fully removed");
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
