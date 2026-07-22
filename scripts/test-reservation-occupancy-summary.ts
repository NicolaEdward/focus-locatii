import assert from "node:assert/strict";
import { summarizeReservationOccupancy } from "../src/lib/reservation-lifecycle-domain";

const now = new Date("2026-07-22T12:00:00.000Z");
const rows = [
  booked("current-1", "2026-07-01", "2026-07-31"),
  booked("current-2", "2026-07-22", "2026-08-10"),
  booked("future", "2026-08-01", "2026-08-31"),
  hold("hold-current", "2026-07-20", "2026-07-30", "2026-07-24T12:00:00.000Z"),
  hold("hold-future", "2026-08-10", "2026-08-20", "2026-07-24T12:00:00.000Z"),
  hold("hold-expired", "2026-08-10", "2026-08-20", "2026-07-21T12:00:00.000Z"),
  { ...booked("cancelled", "2026-08-01", "2026-08-31"), status: "CANCELLED" }
];

const summary = summarizeReservationOccupancy(rows, now);
assert.deepEqual(summary, {
  occupiedNow: 2,
  activeHolds: 2,
  upcoming: 1,
  activeOrUpcoming: 5
});
assert.equal(summary.activeOrUpcoming, summary.occupiedNow + summary.activeHolds + summary.upcoming);

console.log(JSON.stringify({ ok: true, summary }));

function booked(id: string, periodStart: string, periodEnd: string) {
  return {
    id,
    status: "BOOKED",
    periodStart: new Date(`${periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
    holdExpiresAt: null,
    createdAt: new Date("2026-07-20T12:00:00.000Z")
  };
}

function hold(id: string, periodStart: string, periodEnd: string, holdExpiresAt: string) {
  return {
    id,
    status: "HOLD",
    periodStart: new Date(`${periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
    holdExpiresAt: new Date(holdExpiresAt),
    createdAt: new Date("2026-07-20T12:00:00.000Z")
  };
}
