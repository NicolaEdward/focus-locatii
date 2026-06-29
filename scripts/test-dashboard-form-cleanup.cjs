const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const installationDates = loadTsModule(path.join(process.cwd(), "src", "lib", "installation-date.ts"));

main();

function main() {
  installationDateBusinessRule();
  dashboardNoLongerFlagsImplicitMontajAsProblem();
  reservationFormKeepsOptionalFieldsCollapsed();
  cooLegacyReassignmentPanelRetired();
  cooTaskActionOmitsNullTaskId();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "effectiveInstallationDate uses explicit installationDate when present",
      "effectiveInstallationDate falls back to periodStart",
      "missing installation schedule only when both dates are missing or invalid",
      "dashboard no longer treats null installationDate alone as a problem",
      "reservation form moves billing/contact/notes fields into optional collapsed sections",
      "hidden optional billing/contact fields remain optional in reservation validation",
      "COO legacy unclear-sales reassignment panel is retired",
      "seller reassignment route remains protected manual correction endpoint",
      "COO task action omits null taskId for base tasks"
    ]
  }, null, 2));
}

function installationDateBusinessRule() {
  const explicit = installationDates.effectiveInstallationDate({
    installationDate: "2026-07-03T00:00:00.000Z",
    periodStart: "2026-07-01T00:00:00.000Z"
  });
  assert.equal(explicit.date.toISOString(), "2026-07-03T00:00:00.000Z");
  assert.equal(explicit.source, "installationDate");

  const fallback = installationDates.effectiveInstallationDate({
    installationDate: null,
    periodStart: "2026-07-01T00:00:00.000Z"
  });
  assert.equal(fallback.date.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(fallback.source, "periodStart");
  assert.equal(installationDates.hasMissingInstallationSchedule({ installationDate: null, periodStart: "2026-07-01" }), false);

  assert.equal(installationDates.hasMissingInstallationSchedule({ installationDate: null, periodStart: null }), true);
  assert.equal(installationDates.hasMissingInstallationSchedule({ installationDate: "bad-date", periodStart: "also-bad" }), true);
}

function dashboardNoLongerFlagsImplicitMontajAsProblem() {
  const dashboard = read("src", "lib", "dashboard.ts");
  assert(dashboard.includes("hasMissingInstallationSchedule(item)"), "dashboard must use effective installation schedule helper");
  assert(!dashboard.includes("!item.installationDate);"), "dashboard must not flag null installationDate alone");
  assert(!dashboard.includes("Campanie fara data montaj"), "old misleading montaj problem title must be removed");
  assert(dashboard.includes("missing_installation_schedule"), "invalid schedule problem should remain for genuinely missing/invalid data");
}

function reservationFormKeepsOptionalFieldsCollapsed() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(panel.includes('title="Setari facturare / optional"'), "billing fields should live in an optional section");
  assert(panel.includes('title="Date contact hold / optional"'), "hold contact fields should live in an optional section");
  assert(panel.includes('title="Date contact / optional"'), "edit contact fields should live in an optional section");
  assert(panel.includes('title="Note operationale / optional"'), "operational/internal notes should live in an optional section");
  assert(panel.includes("Implicit: data de start"), "edit form should explain implicit montaj date fallback");
  assert(panel.includes("details className="), "optional sections should use collapsed native details");

  const reservations = read("src", "lib", "reservations.ts");
  for (const field of ["billingFrequency", "billingDayOfMonth", "customBillingDate", "billingNotes", "clientPhone"]) {
    assert(new RegExp(`${field}: optional`).test(reservations), `${field} must remain optional in reservation validation`);
  }
  assert(reservations.includes("clientEmail: z.preprocess"), "clientEmail validation should still be optional/preprocessed");
  assert(reservations.includes(".nullable().optional()"), "hidden optional clientEmail must not become required");
}

function cooLegacyReassignmentPanelRetired() {
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(!commandCenter.includes("Realocare vanzari neclare"), "legacy unclear-sales panel should not render in COO dashboard");
  assert(!commandCenter.includes('fetch("/api/admin/seller-reassignments"'), "COO dashboard should not fetch legacy reassignment data");

  const route = read("src", "app", "api", "admin", "seller-reassignments", "route.ts");
  assert(route.includes("Manual admin correction endpoint only"), "manual route should document why dashboard no longer uses it");
  assert(route.includes('["COO", "SUPER_ADMIN"].includes(session.role)'), "manual route must remain COO/SUPER_ADMIN protected for writes");
  assert(route.includes("assignReservationsSeller(input.reservationIds, input.sellerUserId, session)"), "manual route must still use domain reassignment command");
}

function cooTaskActionOmitsNullTaskId() {
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(commandCenter.includes("function operationStatusBody"), "COO task buttons should share operation status body helper");
  assert(commandCenter.includes("...(row.taskId ? { taskId: row.taskId } : {})"), "base task payload must omit null taskId");
  assert(!commandCenter.includes("taskId: row.taskId }, \"Taskul"), "task buttons must not pass taskId directly when it is null");
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
