import assert from "node:assert/strict";
import type { DoohProfile, Reservation } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import {
  createReservation,
  updateReservation,
  updateReservationGroup,
  updateReservationGroupStatus,
  extendReservationHold,
} from "../src/lib/reservations";
import {
  saveDoohProfile,
  checkDoohCapacity,
  bookDoohCapacity,
  commercialAvailability,
} from "../src/lib/commercial-workbench";
import { loadAvailabilityDecisions } from "../src/lib/availability-service";
const endpoint = new URL(process.env.DATABASE_URL || "invalid:");
if (
  !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
  !endpoint.pathname.startsWith("/focus_preview_") ||
  process.env.VERCEL_ENV === "production" ||
  !["ci", "test", "preview"].includes(process.env.APP_ENV || "")
)
  throw new Error("Local isolated synthetic database required.");
const tag = "cross-capacity-" + Date.now(),
  users: string[] = [],
  locations: string[] = [];
let categoryId = "",
  clientId = "",
  campaignId = "",
  suites = 0;
const iso = (day: string) => new Date(day + "T00:00:00.000Z");
const code = (value: string) => (e: unknown) =>
  Boolean(e && typeof e === "object" && "code" in e && e.code === value);
const check = (name: string) => {
  suites++;
  process.stdout.write("✓ " + name + "\n");
};
async function main() {
  const actors = await Promise.all(
    (["COO", "SALES_AGENT"] as const).map(async (role, i) => {
      const u = await prisma.user.create({
        data: {
          name: tag + i,
          email: tag + i + "@example.invalid",
          role,
          active: true,
          passwordHash: "unused-synthetic",
        },
      });
      users.push(u.id);
      return { ...u, iat: 1, exp: 9999999999 } as AuthSession;
    }),
  );
  const [coo, seller] = actors;
  const category = await prisma.category.create({
    data: { name: tag, slug: tag },
  });
  categoryId = category.id;
  const client = await prisma.clientAccount.create({
    data: { companyName: tag, accountOwnerUserId: seller.id, status: "active" },
  });
  clientId = client.id;
  const campaign = await prisma.campaign.create({
    data: {
      campaignName: tag,
      clientId,
      sellerUserId: seller.id,
      accountOwnerUserId: seller.id,
      currency: "RON",
      paymentTermType: "7_days",
      paymentTermDays: 7,
      status: "active",
    },
  });
  campaignId = campaign.id;
  for (let n = 0; n < 7; n++) {
    const l = await prisma.location.create({
      data: {
        categoryId,
        code: tag + n,
        city: "Synthetic",
        type: n === 0 ? "Billboard" : "DOOH LED",
        rateCardValue: 100,
        lifecycleStatus: "ACTIVE",
        showInPublic: false,
      },
    });
    locations.push(l.id);
  }
  const profiles: DoohProfile[] = [];
  for (let n = 1; n < 7; n++)
    profiles.push(
      await saveDoohProfile(
        {
          locationId: locations[n],
          timezone: "Europe/Bucharest",
          loopSeconds: 100,
          slotSeconds: 10,
          state: n === 3 ? "draft" : "verified",
          sourceReference: "synthetic verified full capacity ledger",
        },
        coo,
      ),
    );
  const period = { periodStart: "2090-04-01", periodEnd: "2090-04-02" };
  const staticInput = (locationId: string, status: "BOOKED" | "HOLD") => ({
    locationId,
    ...period,
    status,
    clientId,
    campaignId,
    clientName: tag,
    sellerUserId: seller.id,
    ...(status === "BOOKED" ? { amount: 100 } : {}),
  });
  for (const status of ["HOLD", "BOOKED"] as const)
    await assert.rejects(
      () =>
        createReservation(
          staticInput(locations[1], status),
          status === "HOLD" ? seller : coo,
        ),
      code("DOOH_CAPACITY_MANAGED"),
    );
  await assert.rejects(
    () => createReservation(staticInput(locations[3], "HOLD"), seller),
    code("DOOH_CAPACITY_MANAGED"),
  );
  const plain = await prisma.location.create({
    data: {
      categoryId,
      code: tag + "-digital-unconfigured",
      type: "DOOH",
      lifecycleStatus: "ACTIVE",
      showInPublic: false,
    },
  });
  locations.push(plain.id);
  await assert.rejects(
    () => createReservation(staticInput(plain.id, "HOLD"), seller),
    code("DOOH_CAPACITY_MANAGED"),
  );
  check(
    "new static HOLD/BOOKED denied for verified, draft and unconfigured digital media",
  );
  const staticDecision = await loadAvailabilityDecisions({
    locationIds: [locations[1], plain.id],
    ...{
      periodStart: iso(period.periodStart),
      periodEnd: iso(period.periodEnd),
    },
    requireOverrideStorage: true,
  });
  for (const id of [locations[1], plain.id]) {
    assert.equal(staticDecision.decisionsByLocationId[id].isBookable, false);
    assert.equal(
      staticDecision.decisionsByLocationId[id].reasons[0].code,
      "DOOH_CAPACITY_MANAGED",
    );
  }
  assert.equal(
    (await commercialAvailability({ locationIds: [locations[1]], ...period }))
      .rows[0].available,
    false,
  );
  await prisma.location.update({
    where: { id: locations[6] },
    data: { type: "Billboard" },
  });
  assert.equal(
    (
      await loadAvailabilityDecisions({
        locationIds: [locations[6]],
        requireOverrideStorage: true,
      })
    ).decisionsByLocationId[locations[6]].isBookable,
    false,
  );
  await assert.rejects(
    () => createReservation(staticInput(locations[6], "BOOKED"), coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  check(
    "canonical and agent availability never promise a whole DOOH location, including renamed media with a retained profile",
  );
  const [control] = await createReservation(
    staticInput(locations[0], "BOOKED"),
    coo,
  );
  await assert.rejects(
    () => updateReservation(control.id, { locationId: locations[1] }, coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  assert.equal(
    (await prisma.reservation.findUniqueOrThrow({ where: { id: control.id } }))
      .locationId,
    locations[0],
  );
  const legacyRows: Reservation[] = [];
  for (const id of [locations[2], locations[5]])
    legacyRows.push(
      await prisma.reservation.create({
        data: {
          locationId: id,
          periodStart: new Date("2090-03-20T12:00:00Z"),
          periodEnd: new Date("2090-03-20T12:00:00Z"),
          status: "BOOKED",
          clientId,
          campaignId,
          clientName: tag,
          ownerId: seller.id,
          sellerUserId: seller.id,
          amount: 100,
          currency: "RON",
          contractGroupId: tag + "-legacy",
        },
      }),
    );
  await updateReservation(
    legacyRows[0].id,
    { notes: "synthetic legacy annotation" },
    coo,
  );
  await updateReservationGroup(
    legacyRows[0].id,
    { notes: "synthetic group annotation" },
    coo,
  );
  await assert.rejects(
    () =>
      updateReservationGroup(
        legacyRows[0].id,
        { periodEnd: "2090-03-21" },
        coo,
      ),
    code("DOOH_CAPACITY_MANAGED"),
  );
  for (const row of legacyRows)
    assert.equal(
      (
        await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })
      ).periodEnd.toISOString(),
      row.periodEnd.toISOString(),
    );
  const legacyHold = await prisma.reservation.create({
    data: {
      locationId: locations[4],
      periodStart: new Date("2090-03-20T12:00:00Z"),
      periodEnd: new Date("2090-03-20T12:00:00Z"),
      status: "HOLD",
      holdExpiresAt: new Date(Date.now() + 86400000),
      clientId,
      campaignId,
      clientName: tag,
      ownerId: seller.id,
      sellerUserId: seller.id,
      amount: 100,
    },
  });
  await assert.rejects(
    () => updateReservationGroupStatus(legacyHold.id, "BOOKED", coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  await assert.rejects(
    () => extendReservationHold(legacyHold.id, 2, coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  await assert.rejects(
    () => updateReservation(legacyHold.id, { status: "HOLD" }, coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  await assert.rejects(
    () => updateReservationGroup(legacyHold.id, { status: "HOLD" }, coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  await assert.rejects(
    () => updateReservationGroupStatus(legacyHold.id, "HOLD", coo),
    code("DOOH_CAPACITY_MANAGED"),
  );
  check(
    "static moves/group retiming/confirm/hold extension denied atomically; legacy notes remain editable",
  );
  const capacity = (profileId: string, start: string, end: string) => ({
    profileId,
    periodStart: start,
    periodEnd: end,
    daypartStartMinute: 0,
    daypartEndMinute: 1440,
    shareBps: 1000,
  });
  // Bucharest is UTC+2 on 20 March: legacy day occupies every hour of that day.
  await assert.rejects(
    () =>
      checkDoohCapacity(
        capacity(
          profiles[1].id,
          "2090-03-20T20:30:00Z",
          "2090-03-20T21:30:00Z",
        ),
        coo,
      ),
    code("LEGACY_DIGITAL_OCCUPANCY"),
  );
  assert.equal(
    (
      await checkDoohCapacity(
        capacity(
          profiles[1].id,
          "2090-03-20T22:00:00Z",
          "2090-03-20T23:00:00Z",
        ),
        coo,
      )
    ).available,
    true,
  );
  assert.equal(
    (
      await checkDoohCapacity(
        capacity(
          profiles[1].id,
          "2090-03-19T21:00:00Z",
          "2090-03-19T22:00:00Z",
        ),
        coo,
      )
    ).available,
    true,
  );
  await assert.rejects(
    () =>
      checkDoohCapacity(
        capacity(
          profiles[3].id,
          "2090-03-20T20:30:00Z",
          "2090-03-20T21:30:00Z",
        ),
        coo,
      ),
    code("LEGACY_DIGITAL_OCCUPANCY"),
  );
  check(
    "legacy BOOKED and effective HOLD block the entire local inclusive day; exclusive midnight does not block the next/prior day",
  );
  async function waitForLocationWaiters(expected: number) {
    for (let n = 0; n < 100; n++) {
      const rows = await prisma.$queryRaw<
        Array<{ waiting: bigint }>
      >`SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.REQUESTING_ENGINE_LOCK_ID = l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = ${endpoint.pathname.slice(1)} AND l.OBJECT_NAME = 'portfolio_locations'`;
      if (Number(rows[0]?.waiting) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      "Both writers must wait on location before profile; actual InnoDB waiters not observed.",
    );
  }
  // Force each ordering using the real row lock before either writer may proceed.
  for (const [status, profile, first] of [
    ["BOOKED", profiles[0], "static"],
    ["HOLD", profiles[4], "capacity"],
  ] as const) {
    const window = capacity(
        profile.id,
        "2090-04-01T00:00:00Z",
        "2090-04-02T00:00:00Z",
      ),
      snapshot = await checkDoohCapacity(window, coo);
    const allocation = () =>
      bookDoohCapacity(
        {
          capacity: window,
          campaignId,
          approvalReference: "synthetic manager approval",
          expectedSnapshot: snapshot.snapshotHash,
          requestKey: tag + status,
        },
        coo,
      );
    const wholeLocation = () =>
      createReservation(
        staticInput(profile.locationId, status),
        status === "HOLD" ? seller : coo,
      );
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM portfolio_locations WHERE id = ${profile.locationId} FOR UPDATE`;
        const a = (first === "static" ? wholeLocation : allocation)();
        void a.catch(() => undefined);
        await waitForLocationWaiters(1);
        const b = (first === "static" ? allocation : wholeLocation)();
        pending = Promise.allSettled([a, b]);
        await waitForLocationWaiters(2);
      },
      { isolationLevel: "ReadCommitted", timeout: 20000 },
    );
    const results = await pending!;
    assert.equal(results.length, 2);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejection = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )!;
    assert.ok(code("DOOH_CAPACITY_MANAGED")(rejection.reason));
    assert.equal(
      await prisma.reservation.count({
        where: {
          locationId: profile.locationId,
          status: { in: ["BOOKED", "HOLD", "RESERVED"] },
          periodStart: { lte: iso(period.periodEnd) },
          periodEnd: { gte: iso(period.periodStart) },
        },
      }),
      0,
    );
    assert.equal(
      await prisma.doohCapacityBooking.count({
        where: { profileId: profile.id, state: "confirmed" },
      }),
      1,
    );
  }
  check(
    "deterministic real InnoDB races: both static BOOKED and full-location HOLD serialize location-first against confirmed DOOH capacity",
  );
  await updateReservationGroupStatus(legacyRows[0].id, "CANCELLED", coo);
  assert.equal(
    await prisma.reservation.count({
      where: { contractGroupId: tag + "-legacy", status: "CANCELLED" },
    }),
    2,
  );
  check(
    "explicit cancellation preserves legacy rows and releases blockers without rewriting history",
  );
  console.log(
    JSON.stringify({ ok: true, suites, syntheticOnly: true, providerCalls: 0 }),
  );
}
async function cleanup() {
  const profileIds = (
    await prisma.doohProfile.findMany({
      where: { locationId: { in: locations } },
      select: { id: true },
    })
  ).map((p) => p.id);
  const bookingIds = (
    await prisma.doohCapacityBooking.findMany({
      where: { profileId: { in: profileIds } },
      select: { id: true },
    })
  ).map((p) => p.id);
  await prisma.doohPlaybackProof.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  await prisma.doohCapacityBooking.deleteMany({
    where: { profileId: { in: profileIds } },
  });
  await prisma.doohProfile.deleteMany({ where: { id: { in: profileIds } } });
  await prisma.reservation.deleteMany({
    where: { locationId: { in: locations } },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  if (campaignId) await prisma.campaign.delete({ where: { id: campaignId } });
  if (clientId) await prisma.clientAccount.delete({ where: { id: clientId } });
  await prisma.location.deleteMany({ where: { id: { in: locations } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
