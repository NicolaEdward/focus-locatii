import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deriveCampaignCommercialSummary } from "../src/lib/campaigns/campaign-commercial-summary";

const summary = deriveCampaignCommercialSummary([
  {
    status: "BOOKED",
    periodStart: "2026-06-15",
    periodEnd: "2026-07-31",
    amount: 1000,
    currency: "EUR"
  },
  {
    status: "BOOKED",
    periodStart: "2026-07-01",
    periodEnd: "2026-08-31",
    monthlyRentShare: 500,
    currency: "EUR"
  },
  {
    status: "CANCELLED",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: 99_999,
    currency: "EUR"
  },
  {
    status: "HOLD",
    periodStart: "2025-01-01",
    periodEnd: "2027-12-31",
    amount: 99_999,
    currency: "EUR"
  }
]);

assert.equal(summary.periodStart?.toISOString().slice(0, 10), "2026-06-15");
assert.equal(summary.periodEnd?.toISOString().slice(0, 10), "2026-08-31");
assert.equal(summary.bookedReservationCount, 2);
assert.equal(summary.totalsByCurrency.EUR, 2533.33);
assert.equal(summary.totalsByCurrency.RON, 0);
assert.equal(summary.currency, "EUR");
assert.equal(summary.totalContractValue, 2533.33);

const jetExample = deriveCampaignCommercialSummary([
  {
    status: "BOOKED",
    periodStart: "2026-06-01",
    periodEnd: "2026-08-31",
    amount: 3000,
    currency: "EUR"
  }
]);
assert.equal(jetExample.totalContractValue, 9000);
assert.equal(jetExample.periodStart?.toISOString().slice(0, 10), "2026-06-01");
assert.equal(jetExample.periodEnd?.toISOString().slice(0, 10), "2026-08-31");

const mixedCurrency = deriveCampaignCommercialSummary([
  {
    status: "BOOKED",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    amount: 1000,
    currency: "EUR"
  },
  {
    status: "BOOKED",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    amount: 5000,
    currency: "RON"
  }
]);
assert.deepEqual(mixedCurrency.totalsByCurrency, { RON: 5000, EUR: 1000 });
assert.equal(mixedCurrency.currency, null);
assert.equal(mixedCurrency.totalContractValue, null);
assert.ok(mixedCurrency.dataQualityReasons.includes("MIXED_CAMPAIGN_CURRENCIES"));

const groupTotalOnly = deriveCampaignCommercialSummary([
  {
    status: "BOOKED",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    monthlyRentTotal: 3000,
    contractGroupId: "group-1",
    currency: "EUR"
  }
]);
assert.equal(groupTotalOnly.totalContractValue, null);
assert.ok(groupTotalOnly.dataQualityReasons.includes("BOOKED_MONTHLY_RENT_MISSING"));

const partiallyPriced = deriveCampaignCommercialSummary([
  {
    status: "BOOKED",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    amount: 1000,
    currency: "EUR"
  },
  {
    status: "BOOKED",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    amount: null,
    currency: "EUR"
  }
]);
assert.equal(partiallyPriced.totalsByCurrency.EUR, 1000);
assert.equal(partiallyPriced.totalContractValue, null);
assert.ok(partiallyPriced.dataQualityReasons.includes("BOOKED_MONTHLY_RENT_MISSING"));

const empty = deriveCampaignCommercialSummary([]);
assert.equal(empty.periodStart, null);
assert.equal(empty.periodEnd, null);
assert.equal(empty.totalContractValue, null);

const reservationService = fs.readFileSync(path.join(process.cwd(), "src", "lib", "reservations.ts"), "utf8");
const syncScript = fs.readFileSync(path.join(process.cwd(), "scripts", "sync-campaign-commercial-summaries.ts"), "utf8");
for (const writePath of [
  "export async function createReservation",
  "export async function updateReservation",
  "export async function updateReservationGroupStatus",
  "export async function updateReservationGroup",
  "export async function deleteReservation"
]) {
  const start = reservationService.indexOf(writePath);
  assert.notEqual(start, -1, `Missing reservation write path: ${writePath}`);
  const nextExport = reservationService.indexOf("export async function", start + writePath.length);
  const block = reservationService.slice(start, nextExport === -1 ? undefined : nextExport);
  assert.ok(block.includes("syncCampaignCommercialSummary"), `${writePath} must synchronize the campaign snapshot`);
}
assert.ok(syncScript.includes("--apply necesita --backup-out"), "Historical synchronization must require a rollback backup");
assert.ok(syncScript.includes("restoreCampaignSnapshots"), "Historical synchronization must support restoring its backup");

console.log(JSON.stringify({
  ok: true,
  checks: 30,
  source: summary.source,
  jetExample: {
    periodStart: jetExample.periodStart?.toISOString().slice(0, 10),
    periodEnd: jetExample.periodEnd?.toISOString().slice(0, 10),
    totalContractValue: jetExample.totalContractValue,
    currency: jetExample.currency
  }
}, null, 2));
