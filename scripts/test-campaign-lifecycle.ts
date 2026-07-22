import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bucharestDateKey, deriveCampaignEffectiveStatus } from "../src/lib/campaigns/campaign-effective-status";

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
assert.equal(bucharestDateKey(new Date("2026-07-21T21:30:00.000Z")), "2026-07-22", "Bucharest midnight boundary");
assert.equal(status({ status: "active", startDate: "2026-07-22", endDate: "2026-07-22" }, new Date("2026-07-21T21:30:00.000Z")), "ACTIVE");

const workspace = read("src", "lib", "client-campaign-workspaces.ts");
const cooDashboard = read("src", "lib", "dashboard", "coo-dashboard.ts");
const salesDashboard = read("src", "lib", "dashboard", "sales-dashboard.ts");
const campaignUi = read("src", "components", "admin", "client-campaigns", "CampaignsWorkspace.tsx");
assert(workspace.includes("deriveCampaignEffectiveStatus"), "campaign APIs expose the canonical effective status");
assert(cooDashboard.includes("campaignEffectiveStatusWhere"), "COO dashboard uses canonical campaign lifecycle");
assert(salesDashboard.includes("campaignEffectiveStatusWhere"), "Sales dashboard uses canonical campaign lifecycle");
assert(campaignUi.includes("campaign.effectiveStatus"), "campaign list renders effective status");
assert(campaignUi.includes("overview.effectiveStatus"), "campaign detail renders effective status");
assert(campaignUi.includes("form.status"), "administrative lifecycle remains independently editable");

console.log(JSON.stringify({ ok: true, checks: 17, timeZone: "Europe/Bucharest", endDateInclusive: true }, null, 2));

function read(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
