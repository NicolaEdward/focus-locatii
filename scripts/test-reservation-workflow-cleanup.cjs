const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  periodPromptsAreReplaced();
  periodDialogValidatesAndRequiresPreview();
  conflictPreviewIsReadOnlyAndExcludesCurrentReservation();
  dashboardActionsUseSafeChangePeriodFlow();
  dirtyResetConfirmationIsInApp();
  statusActionsAreHiddenWhenInvalid();
  operationControlsRemainPermissionGated();
  groupEditContextIsClear();
  bookingHoldRequirementsAreExplained();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "reservation period changes no longer use window.prompt",
      "period dialog validates invalid ranges and requires preview before save",
      "conflict preview endpoint is read-only and excludes the current reservation",
      "period updates still call existing command/update flow",
      "form reset uses dirty-state in-app confirmation",
      "status-specific hold/cancel actions are hidden when invalid",
      "operation mutation controls remain gated by campaigns.operate",
      "group edit warning/context is visible",
      "BOOKED versus HOLD requirements are explained"
    ]
  }, null, 2));
}

function periodPromptsAreReplaced() {
  const holdActions = read("src", "components", "admin", "DashboardHoldActions.tsx");
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");

  for (const source of [holdActions, commandCenter]) {
    assert(!source.includes("Data noua de start campanie"), "old start-date prompt text must be removed");
    assert(!source.includes("Data noua de final campanie"), "old end-date prompt text must be removed");
  }
  assert(holdActions.includes("ReservationPeriodChangeDialog"), "hold quick actions should use the period dialog");
  assert(!commandCenter.includes("ReservationPeriodChangeDialog"), "the read-only COO dashboard must not expose reservation mutation dialogs");
}

function periodDialogValidatesAndRequiresPreview() {
  const dialog = read("src", "components", "admin", "ReservationPeriodChangeDialog.tsx");
  assert(dialog.includes("Data de final nu poate fi inainte de data de start."), "dialog should reject reversed date ranges while allowing one-day periods");
  assert(dialog.includes("if (end < start)"), "dialog should follow the inclusive reservation interval convention");
  assert(dialog.includes("Verifica disponibilitatea inainte de salvare."), "dialog should require a preview before save");
  assert(dialog.includes("currentPreview.conflicts.length === 0"), "dialog should block saving when conflicts exist");
  assert(dialog.includes("/api/admin/reservations/conflict-preview"), "dialog should call the preview endpoint");
  assert(dialog.includes("Suprapuneri active"), "dialog should render conflict warnings");
}

function conflictPreviewIsReadOnlyAndExcludesCurrentReservation() {
  const route = read("src", "app", "api", "admin", "reservations", "conflict-preview", "route.ts");
  assert(route.includes("id: { not: currentReservation.id }"), "preview must exclude the reservation being edited");
  assert(route.includes("effectiveBlockingReservationWhere(new Date())"), "preview must use the canonical effective blocking rule");
  assert(route.includes("periodStart: { lte: periodEnd }"), "preview should match inclusive reservation conflict logic");
  assert(route.includes("periodEnd: { gte: periodStart }"), "preview should match inclusive reservation conflict logic");
  assert(!/prisma\.\w+\.(create|update|updateMany|delete|deleteMany|upsert)\(/.test(route), "preview route must not mutate data");
}

function dashboardActionsUseSafeChangePeriodFlow() {
  const holdActions = read("src", "components", "admin", "DashboardHoldActions.tsx");
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  const commandRoute = read("src", "app", "api", "admin", "command-center", "route.ts");
  assert(holdActions.includes('"changePeriod", { periodStart, periodEnd }'), "hold dialog should call existing command-center changePeriod action");
  assert(!commandCenter.includes("/api/admin/command-center"), "the read-only COO dashboard must not call reservation mutation commands");
  assert(commandRoute.includes("updateReservation(reservation.id, { periodStart: input.periodStart, periodEnd: input.periodEnd }, session)"), "command-center changePeriod must still use reservation domain update flow");
}

function dirtyResetConfirmationIsInApp() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(panel.includes("isReservationFormDirty"), "reservation form should track dirty state");
  assert(panel.includes("ReservationResetConfirmDialog"), "reset should use an in-app confirmation dialog");
  assert(panel.includes("Ai modificari nesalvate"), "dirty reset copy should be visible");
  assert(!panel.includes("prompt("), "reservation panel should not use browser prompts");
  assert(panel.includes("reservationFormPeriodError"), "create form should validate campaign date range before submit");
  assert(panel.includes("mustPreviewPeriod && (!currentPeriodPreview || currentPeriodPreview.conflicts.length > 0)"), "edit dialog should require conflict preview before saving period changes");
  assert(panel.includes("Perioada a fost modificata. Verifica disponibilitatea inainte de salvare."), "edit dialog should tell users why preview is required");
}

function statusActionsAreHiddenWhenInvalid() {
  const holdActions = read("src", "components", "admin", "DashboardHoldActions.tsx");
  const reservationsPanel = read("src", "components", "admin", "AdminReservationsPanel.tsx");

  assert(holdActions.includes('const isActiveHold = ["HOLD", "RESERVED"].includes(row.status) && !expired'), "hold panel should gate hold actions to active holds");
  assert(reservationsPanel.includes("const canCancelReservation = canDelete && activeReservationStatuses.includes(reservation.status)"), "cancel action should only show for active reservations");
}

function operationControlsRemainPermissionGated() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const commandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  assert(panel.includes('const canUpdateOperationStatus = hasPermission(session.role, "campaigns.operate")'), "reservation operation controls must require campaigns.operate");
  assert(!commandCenter.includes("fetch("), "COO command center must remain read-only");
  assert(!commandCenter.includes('note: "Follow-up operational pentru hold."'), "HOLD actions must not create decoration tasks");
}

function groupEditContextIsClear() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(panel.includes("groupLocationLabels"), "group edit dialog should receive affected location labels");
  assert(panel.includes("Schimbarile comerciale, perioada si datele operationale se aplica intregului grup"), "group edit warning should explain scope");
  assert(panel.includes("Verifica atent intervalul si statusul inainte de salvare"), "group edit warning should mention period/status risk");
}

function bookingHoldRequirementsAreExplained() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(panel.includes("HOLD/RESERVED poate porni cu date de contact sau client estimat"), "hold requirements should be visible");
  assert(panel.includes("BOOKED cere client si campanie reale din baza de date"), "booked requirements should be visible");
  assert(panel.includes('form.status === "BOOKED" && (!form.clientId || !form.campaignId)'), "booked save should stay blocked until linked client/campaign exists");
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
