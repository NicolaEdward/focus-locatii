import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getInventoryAvailabilitySummary, inventoryAvailabilityBucket } from "../src/lib/inventory-availability-summary";
import { buildInventoryPartition, queryExecutiveOverview } from "../src/lib/dashboard/executive/overview";
import { executiveScopeForSession } from "../src/lib/dashboard/executive/scope";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile(); assertSyntheticEnvironment();
assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
const tag = `inventory-free-${randomUUID()}`;
const now = new Date("2090-01-14T22:30:00.000Z"); // 15 January in Bucharest.
const day = new Date("2090-01-15T00:00:00.000Z");
const noon = new Date("2090-01-15T12:00:00.000Z");
const tomorrow = new Date("2090-01-16T00:00:00.000Z");
const locations: string[] = [], users: string[] = [];
const expected: Record<string, number> = { activeLocations: 0, maintenanceLocations: 0, staticLocations: 0, digitalLocations: 0, freeToday: 0, occupiedToday: 0, heldToday: 0, blockedToday: 0, unknownToday: 0 };
let categoryId: string;

async function location(name: string, bucket: keyof typeof expected | "digital" | "inactive" | "archived" | "maintenance", extra: Record<string, unknown> = {}) {
  const row = await prisma.location.create({ data: { code: `${tag}-${name}`, city: "Synthetic", address: `${tag}-${name}`, type: "Panou", categoryId, status: "UNKNOWN", showInPublic: false, ...extra } });
  locations.push(row.id);
  if (bucket === "maintenance") expected.maintenanceLocations++;
  else if (!["inactive", "archived"].includes(bucket)) {
    expected.activeLocations++;
    if (bucket === "digital") expected.digitalLocations++;
    else { expected.staticLocations++; expected[bucket]++; }
  }
  return row;
}
async function reservation(locationId: string, status: "BOOKED" | "HOLD" | "RESERVED", start = day, end = day, expiry: Date | null = null) {
  return prisma.reservation.create({ data: { locationId, status, clientName: `${tag}-PRIVATE-CUSTOMER`, ownerId: users[1], sellerUserId: users[1], periodStart: start, periodEnd: end, holdExpiresAt: expiry, createdAt: new Date("2090-01-14T00:00:00Z") } });
}
function assertDelta(before: Awaited<ReturnType<typeof getInventoryAvailabilitySummary>>, after: Awaited<ReturnType<typeof getInventoryAvailabilitySummary>>) {
  for (const [key, delta] of Object.entries(expected)) assert.equal(after[key as keyof typeof after], Number(before[key as keyof typeof before]) + delta, key);
}

async function main() {
  const baseline = await getInventoryAvailabilitySummary({ now });
  assert.equal(baseline.dateKey, "2090-01-15"); assert.equal(baseline.timeZone, "Europe/Bucharest");
  categoryId = (await prisma.category.create({ data: { name: tag, slug: tag } })).id;
  for (const suffix of ["a", "b"]) users.push((await prisma.user.create({ data: { name: tag + suffix, email: `${tag}-${suffix}@example.invalid`, role: suffix === "a" ? "COO" : "SALES_AGENT", passwordHash: "unused-synthetic-hash" } })).id);
  try {
    await location("free-unknown-legacy-label", "freeToday");
    const future = await location("multiple-future-bookings", "freeToday");
    await reservation(future.id, "BOOKED", tomorrow, tomorrow);
    await reservation(future.id, "BOOKED", new Date("2090-02-01"), new Date("2090-02-28"));
    const futureHold = await location("future-hold", "freeToday");
    await reservation(futureHold.id, "HOLD", tomorrow, tomorrow, new Date(now.getTime() + 3 * 86400000));
    const expired = await location("expired-hold", "freeToday");
    await reservation(expired.id, "HOLD", day, day, new Date(now.getTime() - 1));
    const exactExpiry = await location("expiry-exactly-now", "freeToday");
    await reservation(exactExpiry.id, "RESERVED", day, day, now);
    const overlapping = await location("two-overlapping-rows-one-location", "occupiedToday");
    await reservation(overlapping.id, "BOOKED"); await reservation(overlapping.id, "BOOKED");
    const noonStart = await location("noon-stored-start", "occupiedToday");
    await reservation(noonStart.id, "BOOKED", noon, new Date("2090-01-20T12:00:00Z"));
    const noonEnd = await location("inclusive-last-day", "occupiedToday");
    await reservation(noonEnd.id, "BOOKED", new Date("2090-01-01T12:00:00Z"), noon);
    const held = await location("current-hold", "heldToday");
    await reservation(held.id, "RESERVED", day, day, new Date(now.getTime() + 86400000));
    const manual = await location("manual-override", "blockedToday");
    await prisma.locationAvailabilityOverride.create({ data: { locationId: manual.id, type: "COMMERCIAL_BLOCK", reason: `${tag}-PRIVATE-REASON`, periodStart: noon, periodEnd: null } });
    const cleared = await location("cleared-override", "freeToday");
    await prisma.locationAvailabilityOverride.create({ data: { locationId: cleared.id, type: "COMMERCIAL_BLOCK", reason: tag, periodStart: day, clearedAt: now } });
    const maintenanceOverride = await location("maintenance-override", "blockedToday");
    await prisma.locationAvailabilityOverride.create({ data: { locationId: maintenanceOverride.id, type: "MAINTENANCE", reason: tag, periodStart: day } });
    await location("legacy-manual-block", "blockedToday", { blockedReason: `${tag}-PRIVATE-LEGACY`, blockedFrom: noon, blockedUntil: noon });
    await location("legacy-available-from", "blockedToday", { status: "AVAILABLE_FROM", availableFrom: tomorrow });
    const inactive = await location("inactive", "inactive", { lifecycleStatus: "INACTIVE" });
    await reservation(inactive.id, "BOOKED");
    await location("archived", "archived", { lifecycleStatus: "ARCHIVED" });
    await location("maintenance", "maintenance", { lifecycleStatus: "MAINTENANCE" });
    await location("digital-raw-type", "digital", { type: "LED Digital" });
    const profile = await location("profile-after-type-rename", "digital");
    await prisma.doohProfile.create({ data: { locationId: profile.id, loopSeconds: 60, slotSeconds: 10, sourceReference: "synthetic verified source" } });

    const summary = await getInventoryAvailabilitySummary({ now }); assertDelta(baseline, summary);
    assert.equal(summary.freeToday + summary.occupiedToday + summary.heldToday + summary.blockedToday + summary.unknownToday, summary.staticLocations);
    assert.equal(summary.staticLocations + summary.digitalLocations, summary.activeLocations);
    for (const value of [tag, users[0], users[1], ...locations]) assert.equal(JSON.stringify(summary).includes(value), false, "Aggregate output must not leak owner, location or client details");
    assert.equal(summary.asOf, now.toISOString());

    // More than the batch size cannot be silently dropped or tied to a page.
    const extra = Array.from({ length: 507 }, (_, index) => ({ id: `${tag}-bulk-${String(index).padStart(4,"0")}`, code: `${tag}-bulk-${index}`, city: "Synthetic", address: "Synthetic", type: "Panou", categoryId, status: "UNKNOWN" as const, showInPublic: false }));
    await prisma.location.createMany({ data: extra }); locations.push(...extra.map((row) => row.id));
    const large = await getInventoryAvailabilitySummary({ now });
    assert.equal(large.freeToday, summary.freeToday + 507); assert.equal(large.activeLocations, summary.activeLocations + 507);

    // A caller's RepeatableRead transaction remains stable across an external
    // committed insert, while the next complete snapshot sees that insert.
    await prisma.$transaction(async (tx) => {
      await tx.location.count();
      const late = await prisma.location.create({ data: { code: `${tag}-late`, city: "Synthetic", address: "Synthetic", type: "Panou", categoryId, showInPublic: false } });locations.push(late.id);
      const stable = await getInventoryAvailabilitySummary({ now, db: tx });
      assert.deepEqual(stable, large);
    }, { isolationLevel: "RepeatableRead", timeout: 20000 });
    const next = await getInventoryAvailabilitySummary({ now }); assert.equal(next.freeToday, large.freeToday + 1);
    const scope = executiveScopeForSession({ id: users[0], role: "COO", email: `${tag}-a@example.invalid`, name: tag + "a", tokenVersion: 0, iat: 1, exp: 4_000_000_000 }, { snapshot: "2090-01-15", period: "TODAY" }, now);
    const executive = await queryExecutiveOverview(scope, now);
    assert.equal(executive.summary.inventory.available, next.freeToday, "Executive today uses current expiry and the same free static inventory");
    assert.equal(executive.summary.inventory.booked, next.occupiedToday);
    assert.equal(executive.summary.inventory.hold, next.heldToday);
    assert.equal(executive.summary.inventory.unknown, next.digitalLocations + next.unknownToday, "Executive unknown excludes capacity-managed digital stock from OOH eligibility");

    const executiveRows = await prisma.location.findMany({ where: { id: { in: [noonStart.id, future.id, manual.id, profile.id] } }, include: { reservations: true, availabilityOverrides: true } });
    const partition = buildInventoryPartition(executiveRows.map((row) => ({ ...row, hasDoohProfile: row.id === profile.id })), day, now);
    assert.equal(partition.booked, 1); assert.equal(partition.available, 1); assert.equal(partition.manualUnavailable, 1); assert.equal(partition.unknown, 1);
    assert.equal(partition.activeBookedReservations, 1, "Future contracts are not executive current-day reservations");
    assert.equal(inventoryAvailabilityBucket({ type: "LED", lifecycleStatus: "ACTIVE" }, day, now), "DIGITAL");
    console.log(JSON.stringify({ ok: true, checked: ["company blockers without private data", "unique location partition", "future and expired holds remain free today", "manual/lifecycle restrictions", "digital/profile exclusion", "Bucharest midnight and inclusive noon dates", "507 extra locations paginated", "consistent shared snapshot", "executive canonical parity"] }));
  } finally {
    await prisma.doohProfile.deleteMany({ where: { locationId: { in: locations } } });
    await prisma.reservation.deleteMany({ where: { locationId: { in: locations } } });
    await prisma.locationAvailabilityOverride.deleteMany({ where: { locationId: { in: locations } } });
    await prisma.location.deleteMany({ where: { id: { in: locations } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  }
}
main().finally(() => prisma.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1; });
