const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const neutralizationDates = loadTsModule(path.join(process.cwd(), "src", "lib", "neutralization-date.ts"));

main();

function main() {
  neutralizationDateBusinessRule();
  dashboardNeutralizationWarningUsesEffectiveDate();
  dashboardConflictGroupingUsesLocationId();
  cooDashboardRemovesDuplicateTaskSections();
  cooConflictActionsAreManualOnly();
  operationMutationControlsRequireOperatePermission();
  dashboardLabelsAreClearRomanian();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "neutralizationDate falls back to periodEnd",
      "missing neutralization schedule requires both dates missing/invalid",
      "dashboard no longer flags null neutralizationDate when periodEnd exists",
      "conflict grouping uses location id",
      "COO operation task list is not duplicated",
      "note-only conflict resolve buttons are hidden",
      "operation mutation controls require campaigns.operate",
      "dashboard labels are clearer Romanian labels"
    ]
  }, null, 2));
}

function neutralizationDateBusinessRule() {
  const explicit = neutralizationDates.effectiveNeutralizationDate({
    neutralizationDate: "2026-08-30T00:00:00.000Z",
    periodEnd: "2026-08-28T00:00:00.000Z"
  });
  assert.equal(explicit.date.toISOString(), "2026-08-30T00:00:00.000Z");
  assert.equal(explicit.source, "neutralizationDate");

  const fallback = neutralizationDates.effectiveNeutralizationDate({
    neutralizationDate: null,
    periodEnd: "2026-08-28T00:00:00.000Z"
  });
  assert.equal(fallback.date.toISOString(), "2026-08-28T00:00:00.000Z");
  assert.equal(fallback.source, "periodEnd");

  assert.equal(neutralizationDates.hasMissingNeutralizationSchedule({ neutralizationDate: null, periodEnd: "2026-08-28" }), false);
  assert.equal(neutralizationDates.hasMissingNeutralizationSchedule({ neutralizationDate: null, periodEnd: null }), true);
  assert.equal(neutralizationDates.hasMissingNeutralizationSchedule({ neutralizationDate: "bad-date", periodEnd: "also-bad" }), true);
}

function dashboardNeutralizationWarningUsesEffectiveDate() {
  const dashboard = read("src", "lib", "dashboard.ts");
  assert(dashboard.includes("hasMissingNeutralizationSchedule(item)"), "dashboard must use effective neutralization schedule helper");
  assert(!dashboard.includes("&& !item.neutralizationDate"), "dashboard must not flag null neutralizationDate alone");
  assert(!dashboard.includes("Campanie fara data neutralizare"), "old misleading neutralization problem title must be removed");
  assert(dashboard.includes("missing_neutralization_schedule"), "invalid schedule problem should remain for genuinely missing/invalid data");
}

function dashboardConflictGroupingUsesLocationId() {
  const dashboard = read("src", "lib", "dashboard.ts");
  assert(dashboard.includes("byLocation.get(item.location.id)"), "conflict grouping must use stable location id");
  assert(dashboard.includes("byLocation.set(item.location.id, group)"), "conflict grouping must store by stable location id");
  assert(!dashboard.includes("byLocation.get(item.location.code)"), "location code must be display-only, not the conflict grouping key");
}

function cooDashboardRemovesDuplicateTaskSections() {
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(commandCenter.includes('type OperationTaskFilter = "all" | "decoration" | "neutralization" | "overdue"'), "COO task list should use practical filters");
  assert(commandCenter.includes('TaskPanel title="Operatiuni de facut"'), "COO should keep one clear operational list");
  assert(!commandCenter.includes('TaskPanel title="Decorari"'), "COO must not render a second decoration task table");
  assert(!commandCenter.includes('TaskPanel title="Neutralizari"'), "COO must not render a second neutralization task table");
  assert(!commandCenter.includes("Taskuri operationale active"), "old noisy task title must be removed");
}

function cooConflictActionsAreManualOnly() {
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(commandCenter.includes("Rezolvare manuala necesara"), "conflict rows should explain manual resolution");
  assert(!/onCommand\([^)]*"markResolved"/s.test(commandCenter), "markResolved must not be exposed as a conflict resolve button");
  assert(!/onCommand\([^)]*"approveException"/s.test(commandCenter), "approveException must not be exposed as a conflict resolve button");

  const dashboard = read("src", "lib", "dashboard.ts");
  assert(!dashboard.includes("aproba exceptia"), "dashboard must not recommend fake exception approval as conflict resolution");
}

function operationMutationControlsRequireOperatePermission() {
  const reservationsPanel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(reservationsPanel.includes('const canUpdateOperationStatus = hasPermission(session.role, "campaigns.operate")'), "reservation operation status controls must require campaigns.operate");
  const canEditBlock = blockFrom(reservationsPanel, "function canEditOperationalReservation", "function AdminTableShell");
  assert(canEditBlock.includes('return hasPermission(session.role, "campaigns.operate");'), "operation task edit helper must require campaigns.operate");
  assert(!canEditBlock.includes("reservations.manage.own"), "sales ownership must not enable operation mutation controls");

  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(commandCenter.includes('hasPermission(data.role, "campaigns.operate")'), "COO task buttons should be gated by campaigns.operate");
  assert(commandCenter.includes("canOperate={canOperateCampaigns}"), "operation task panel must receive explicit permission gate");
  assert(commandCenter.includes("Doar vizualizare"), "users without operation permission should get read-only state");
}

function dashboardLabelsAreClearRomanian() {
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  for (const oldLabel of ["Operational Health", "Conflict Center", "Taskuri operationale active"]) {
    assert(!commandCenter.includes(oldLabel), `${oldLabel} should not render in dashboard`);
  }
  for (const newLabel of ["Stare operationala", "Suprapuneri contracte", "Operatiuni de facut", "Prioritati", "Inventar"]) {
    assert(commandCenter.includes(newLabel), `${newLabel} should render in dashboard`);
  }

  const financial = read("src", "components", "admin", "FinancialDashboardPanel.tsx");
  assert(!financial.includes("Needs Review"), "finance dashboard tab should be Romanian");
  assert(financial.includes("Necesita verificare"), "finance dashboard should use clearer review label");

  const clientCampaigns = read("src", "components", "admin", "ClientCampaignsWorkspace.tsx");
  assert(!clientCampaigns.includes("Accounts OOH"), "client workspace title should not use mixed English label");
  assert(clientCampaigns.includes("Clienti si campanii OOH"), "client workspace title should be clear Romanian");
}

function blockFrom(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
