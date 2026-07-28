import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  activeCampaignBookingWhere,
  bucharestDateKey,
  campaignEffectiveStatusWhere,
  deriveCampaignEffectiveStatus
} from "../src/lib/campaigns/campaign-effective-status";

const now = new Date("2026-07-22T12:00:00.000Z");
const status = (input: Parameters<typeof deriveCampaignEffectiveStatus>[0], date = now) => deriveCampaignEffectiveStatus(input, date).effectiveStatus;

assert.equal(status({ status: "planned", startDate: "2026-07-23", endDate: "2026-08-01" }), "SCHEDULED");
assert.equal(status({ status: "active", startDate: "2026-07-22", endDate: "2026-08-01" }), "ACTIVE");
assert.equal(status({ status: "active", startDate: "2026-07-01", endDate: "2026-07-22" }), "ACTIVE", "end day is inclusive");
assert.equal(status({ status: "active", startDate: "2026-07-01", endDate: "2026-07-21" }), "ENDED");
assert.equal(status({ status: "cancelled", startDate: "2026-08-01", endDate: "2026-08-31" }), "CANCELLED");
assert.equal(status({ status: "active", archivedAt: "2026-07-01", startDate: "2026-07-01", endDate: "2026-08-01" }), "ARCHIVED");
assert.equal(status({ status: "draft", startDate: null, endDate: null }), "DRAFT");
assert.equal(status({ status: "planned", startDate: null, endDate: "2026-08-01" }), "INCOMPLETE");
assert.equal(status({ status: "active", startDate: "2026-08-02", endDate: "2026-08-01" }), "INCOMPLETE");
assert.equal(status({
  status: "active",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  bookedPeriods: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-08-31" }]
}), "ACTIVE", "an active BOOKED period is canonical evidence that the campaign is already active");
assert.equal(status({
  status: "active",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  bookedPeriods: [{ status: "HOLD", periodStart: "2026-06-01", periodEnd: "2026-08-31" }]
}), "SCHEDULED", "HOLD must not activate a campaign");
assert.equal(status({
  status: "cancelled",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  bookedPeriods: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-08-31" }]
}), "CANCELLED", "terminal campaign lifecycle remains authoritative");
const bookingDecision = deriveCampaignEffectiveStatus({
  status: "active",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  bookedPeriods: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-08-31" }]
}, now);
assert.equal(bookingDecision.periodSource, "ACTIVE_BOOKING");
assert.equal(bookingDecision.startDate, "2026-06-01");
assert.equal(bucharestDateKey(new Date("2026-07-21T21:30:00.000Z")), "2026-07-22", "Bucharest midnight boundary");
assert.equal(status({ status: "active", startDate: "2026-07-22", endDate: "2026-07-22" }, new Date("2026-07-21T21:30:00.000Z")), "ACTIVE");
const activeWhere = campaignEffectiveStatusWhere("ACTIVE", now) as {
  OR: Array<{ startDate?: { lt?: Date } }>;
};
const scheduledWhere = campaignEffectiveStatusWhere("SCHEDULED", now) as {
  AND: Array<{ startDate?: { gte?: Date } }>;
};
const bookingWhere = activeCampaignBookingWhere(now) as { periodStart: { lt?: Date } };
assert.equal(activeWhere.OR[0].startDate?.lt?.toISOString(), "2026-07-23T00:00:00.000Z", "ACTIVE includes date-only values stored at noon on the snapshot day");
assert.equal(scheduledWhere.AND[2].startDate?.gte?.toISOString(), "2026-07-23T00:00:00.000Z", "SCHEDULED starts on the next business date");
assert.equal(bookingWhere.periodStart.lt?.toISOString(), "2026-07-23T00:00:00.000Z", "BOOKED periods starting at noon remain active on their start day");

const workspace = read("src", "lib", "client-campaign-workspaces.ts");
const cooDashboard = read("src", "lib", "dashboard", "coo-dashboard.ts");
const salesDashboard = read("src", "lib", "dashboard", "sales-dashboard.ts");
const campaignUi = read("src", "components", "admin", "client-campaigns", "CampaignsWorkspace.tsx");
assert(workspace.includes("deriveCampaignEffectiveStatus"), "campaign APIs expose the canonical effective status");
assert(cooDashboard.includes("campaignEffectiveStatusWhere"), "COO dashboard uses canonical campaign lifecycle");
assert(salesDashboard.includes("campaignEffectiveStatusWhere"), "Sales dashboard uses canonical campaign lifecycle");
assert(campaignUi.includes("campaign.effectiveStatus"), "campaign list renders effective status");
assert(campaignUi.includes("overview.effectiveStatus"), "campaign detail renders effective status");
assert(campaignUi.includes("Perioada activa"), "campaign detail explains when an active rental overrides inconsistent campaign dates");
assert(campaignUi.includes("form.status"), "administrative lifecycle remains independently editable");

console.log(JSON.stringify({ ok: true, checks: 26, timeZone: "Europe/Bucharest", endDateInclusive: true }, null, 2));

function read(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
