const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const now = new Date("2026-06-26T00:00:00.000Z");
const rows = [
  row("active-hold", "HOLD", "2026-06-27", "2026-06-24"),
  row("expired-hold", "HOLD", "2026-06-25", "2026-06-24"),
  row("legacy-reserved", "RESERVED", null, "2026-06-15"),
  row("booked", "BOOKED", "2026-06-20", "2026-06-15"),
  row("cancelled", "CANCELLED", "2026-06-20", "2026-06-15"),
  row("lost", "LOST", "2026-06-20", "2026-06-15")
];
const auditCalls = [];

const prisma = {
  $transaction: async (callback) => callback({
    reservation: {
      findMany: async () => rows.filter(isEligible).map(({ id, status, holdExpiresAt, createdAt }) => ({
        id,
        status,
        holdExpiresAt,
        createdAt
      })),
      updateMany: async ({ where, data }) => {
        const ids = new Set(where.id.in);
        let count = 0;
        for (const item of rows) {
          if (!ids.has(item.id) || !isEligible(item)) continue;
          Object.assign(item, data);
          count += 1;
        }
        return { count };
      }
    }
  })
};

const {
  effectiveBlockingReservationWhere,
  effectiveHoldExpiresAt,
  expireStaleHolds,
  isEffectiveBlockingReservation,
  isEffectiveHold
} = loadTsModule(path.join(process.cwd(), "src", "lib", "reservation-lifecycle.ts"), {
  "@/lib/prisma": { prisma },
  "@/lib/audit": {
    recordAudit: async (input) => {
      auditCalls.push(input);
    }
  }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  assert.equal(isEffectiveHold(find("active-hold"), now), true, "active HOLD blocks before its exact expiry");
  assert.equal(isEffectiveHold(find("expired-hold"), now), false, "expired HOLD stops blocking without cleanup");
  assert.equal(isEffectiveHold(find("legacy-reserved"), now), false, "legacy HOLD without expiry uses the five-day fallback");
  assert.equal(isEffectiveBlockingReservation(find("booked"), now), true, "BOOKED remains blocking");
  assert.equal(isEffectiveBlockingReservation(find("cancelled"), now), false, "CANCELLED remains non-blocking");
  assert.equal(effectiveHoldExpiresAt(find("legacy-reserved")).toISOString(), "2026-06-20T00:00:00.000Z", "legacy HOLD expiry is deterministic");
  const blockingWhere = effectiveBlockingReservationWhere(now);
  assert.equal(blockingWhere.OR[0].status, "BOOKED", "canonical query keeps BOOKED blocking");
  assert.equal(blockingWhere.OR[1].status.in.join(","), "HOLD,RESERVED", "canonical query includes only temporary hold statuses");

  const first = await expireStaleHolds(now);
  assert.equal(first, 2, "eligible hold/reserved rows expire");
  assert.equal(find("active-hold").status, "HOLD", "active hold before expiry remains active");
  assert.equal(find("expired-hold").status, "EXPIRED", "eligible hold expires");
  assert.equal(find("legacy-reserved").status, "EXPIRED", "legacy reserved without holdExpiresAt expires by cutoff");
  assert.equal(find("booked").status, "BOOKED", "BOOKED never expires");
  assert.equal(find("cancelled").status, "CANCELLED", "CANCELLED is not changed");
  assert.equal(find("lost").status, "LOST", "LOST is not changed if legacy data contains it");
  assert.equal(auditCalls.length, 1, "audit/system log written for expiry");
  assert.equal(auditCalls[0].action, "reservation.holds_expired", "expiry audit action recorded");

  const second = await expireStaleHolds(now);
  assert.equal(second, 0, "running expiry twice is idempotent");
  assert.equal(auditCalls.length, 1, "idempotent no-op does not write duplicate audit");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "active hold before expiry remains active",
      "expired HOLD is non-blocking before cleanup",
      "one canonical blocking query covers BOOKED and active HOLD",
      "eligible hold expires",
      "BOOKED never expires",
      "CANCELLED/LOST not changed",
      "expiry is idempotent",
      "audit log written"
    ]
  }, null, 2));
}

function row(id, status, holdExpiresAt, createdAt) {
  return {
    id,
    status,
    holdExpiresAt: holdExpiresAt ? date(holdExpiresAt) : null,
    createdAt: date(createdAt)
  };
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function find(id) {
  return rows.find((item) => item.id === id);
}

function isEligible(item) {
  const legacyCutoff = new Date(now);
  legacyCutoff.setUTCDate(legacyCutoff.getUTCDate() - 5);
  return (
    ["HOLD", "RESERVED"].includes(item.status) &&
    ((item.holdExpiresAt && item.holdExpiresAt <= now) || (!item.holdExpiresAt && item.createdAt <= legacyCutoff))
  );
}
