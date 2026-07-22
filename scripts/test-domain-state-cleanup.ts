import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertCampaignStatusForCreate,
  assertCampaignStatusTransition,
  parseCampaignStatus
} from "../src/lib/campaign-state";
import {
  assertFinancialUploadTransition,
  assertReceivableImportRowTransition,
  assertReceivablePaymentTransition
} from "../src/lib/financial-state-machine";

assert.equal(parseCampaignStatus(" ACTIVE "), "active");
assert.equal(assertCampaignStatusTransition("draft", "active"), "active");
assert.equal(assertCampaignStatusTransition("active", "completed"), "completed");
assert.throws(() => assertCampaignStatusTransition("active", "draft"));
assert.throws(() => assertCampaignStatusTransition("archived", "active"));
assert.throws(() => assertCampaignStatusForCreate("completed"));

assert.equal(assertFinancialUploadTransition("preview_ready", "confirmed"), "confirmed");
assert.throws(() => assertFinancialUploadTransition("confirmed", "rejected"));
assert.equal(assertReceivableImportRowTransition("conflict", "resolved"), "resolved");
assert.equal(assertReceivableImportRowTransition("resolved", "imported"), "imported");
assert.throws(() => assertReceivableImportRowTransition("ignored", "imported"));
assert.equal(assertReceivablePaymentTransition("active", "cancelled"), "cancelled");
assert.throws(() => assertReceivablePaymentTransition("cancelled", "active"));

const campaigns = read("src/lib/campaigns.ts");
assert.match(campaigns, /z\.enum\(CAMPAIGN_STATUSES\)/);
assert.match(campaigns, /assertCampaignStatusTransition/);
assert.match(campaigns, /Foloseste actiunea dedicata de arhivare/);

const blockRoute = read("src/app/api/admin/locations/[id]/block/route.ts");
const createBranch = between(blockRoute, "if (input.blocked) {", "} else {");
assert.doesNotMatch(createBranch, /blockedReason:\s*input/);
assert.match(createBranch, /createManualAvailabilityOverride/);
assert.match(blockRoute, /Compatibility cleanup only/);

const locationMutations = read("src/lib/location-mutations.ts");
assert.match(locationMutations, /withoutLegacyAvailabilityState/);
assert.match(locationMutations, /status: "UNKNOWN"/);
assert.match(locationMutations, /blockedReason: null/);

const editor = read("src/components/admin/LocationEditor.tsx");
assert.doesNotMatch(editor, /Status disponibilitate vechi/);
assert.doesNotMatch(between(editor, "function toPayload", "function nullable"), /status:\s*state\.status/);

const inventoryImport = between(read("src/lib/import-excel.ts"), "function inventoryLocationData", "function buildInventoryPlan");
assert.doesNotMatch(inventoryImport, /\n\s{4}status,|availableFrom:|bookedUntil:/);

const syncRoute = read("src/app/api/admin/reservations/sync/route.ts");
assert.match(syncRoute, /LEGACY_RESERVATION_SYNC_RETIRED/);
assert.match(syncRoute, /status: 410/);
assert.doesNotMatch(syncRoute, /syncLegacyReservations/);

const schema = read("prisma/schema.prisma");
for (const historicalModel of ["model CrmLead {", "model ImportBatch {", "model OperationTask {"]) {
  assert.ok(schema.includes(historicalModel), `${historicalModel} must remain during expand phase`);
}
const inventoryImportService = read("src/lib/import-excel.ts");
assert.match(inventoryImportService, /prisma\.importBatch\.create/);
assert.match(inventoryImportService, /prisma\.importBatch\.update/);

const packageJson = read("package.json");
assert.doesNotMatch(packageJson, /db:import-reservations/);
assert.doesNotMatch(packageJson, /db:archive-legacy/);
assert.match(read("scripts/import-legacy-reservations.ts"), /Importul legacy de rezervari a fost retras/);
assert.match(read("scripts/backup-and-archive-legacy.cjs"), /Resetul legacy cu scrieri a fost retras/);
const legacyLocationImport = between(read("scripts/import-existing-locatii.ts"), "const data = {", "const location = existing");
assert.doesNotMatch(legacyLocationImport, /\n\s+status:/);

console.log("Domain state cleanup tests passed.");

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}
