const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  proofLibraryDefinesSafeRetention();
  completionRouteIsScopedAndDoesNotCreateReservations();
  proofPhotoRouteIsPrivate();
  cronIsProtectedAndLimitedToProofPhotos();
  operationalUiShowsCompletionWorkflow();
  operationalUiRemovesTechnicalStatusDropdown();
  operationalUiHidesCompletedSectionsAndSyncButtons();
  sellerDashboardShowsScopedProofPhotos();
  operationalDateDelayWorkflowIsAudited();
  completionRefreshesLocalState();
  reservationDtoExposesMetadataOnly();
  publicApiDoesNotExposeProofPhotos();
  operationTaskFlagsRemainDisabled();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "proof photo retention is 30 days",
      "proof upload accepts images only and limits size/count",
      "completion route is admin-only and scoped",
      "completion route updates operation notes without creating reservations/HOLD/BOOKED",
      "proof photo download route is authenticated and private",
      "cron requires CRON_SECRET",
      "cron deletes only operational proof photos",
      "operational UI exposes completion proof workflow",
      "operational UI removes technical status dropdown",
      "completed decoration billing list is collapsed and technical references are hidden",
      "reservation sync buttons are not exposed in admin UI",
      "seller dashboard can show scoped proof photos",
      "delayed operational date changes require reason and audit metadata",
      "completion updates the local operational state without manual refresh",
      "reservation DTO exposes metadata links only, not raw file contents",
      "public APIs do not expose proof photos",
      "OperationTask flags remain untouched"
    ]
  }, null, 2));
}

function proofLibraryDefinesSafeRetention() {
  const source = read("src", "lib", "operational-proof.ts");
  assert(source.includes('OPERATIONAL_PROOF_DOCUMENT_TYPE = "operational_proof_photo"'), "proof photos must use a dedicated document type");
  assert(source.includes("OPERATIONAL_PROOF_RETENTION_DAYS = 30"), "proof photos must expire after 30 days");
  assert(source.includes("OPERATIONAL_PROOF_MAX_FILES_PER_TASK = 10"), "proof photo count must be limited");
  assert(source.includes("OPERATIONAL_PROOF_MAX_FILE_SIZE = 10 * 1024 * 1024"), "proof photo size must be limited");
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    assert(source.includes(mimeType), `${mimeType} should be accepted`);
  }
  assert(source.includes("canCompleteOperationalReservation"), "completion access helper should be centralized");
  assert(source.includes("canRescheduleOperationalReservation"), "reschedule access helper should be centralized");
  assert(source.includes('reservation.status !== "BOOKED"'), "completion must only apply to active booked operational work");
}

function completionRouteIsScopedAndDoesNotCreateReservations() {
  const source = read("src", "app", "api", "admin", "operational", "tasks", "complete", "route.ts");
  assert(source.includes("requireAnyPermission"), "completion API must require authenticated admin permissions");
  assert(source.includes('"dashboard.operations.view"'), "field installer operational permission should be supported");
  assert(source.includes("canCompleteOperationalReservation"), "completion API must enforce scoped operational access");
  assert(source.includes("validateOperationalProofFile"), "completion API must validate uploaded files");
  assert(source.includes("clientDocument.create"), "proof photos should be stored as internal documents");
  assert(source.includes("withOperationCompletion"), "base operation completion should use operation metadata");
  assert(source.includes("withOperationTaskCompletion"), "extra task completion should use operation metadata");
  assert(source.includes("updateReservationProductionNotes"), "completion should only update operation notes");
  assert(!source.includes("reservation.create"), "completion must not create reservations");
  assert(!source.includes('status: "HOLD"'), "completion must not create HOLD records");
  assert(!source.includes('status: "BOOKED"'), "completion must not mark locations BOOKED");
}

function proofPhotoRouteIsPrivate() {
  const source = read("src", "app", "api", "admin", "operational", "proof-photos", "[id]", "route.ts");
  assert(source.includes("requireAnyPermission"), "proof photos must require auth");
  assert(source.includes("canAccessOperationalReservation"), "proof photos must be scoped to allowed operational users");
  assert(source.includes("OPERATIONAL_PROOF_DOCUMENT_TYPE"), "proof route must only serve proof photo documents");
  assert(source.includes("isOperationalProofActive"), "expired/deleted proof photos must not be served");
  assert(source.includes('searchParams.get("preview") === "1"'), "proof route should support authenticated preview mode");
  assert(source.includes('"SUPER_ADMIN", "COO"'), "manual delete should be limited to admin/COO");
}

function cronIsProtectedAndLimitedToProofPhotos() {
  const route = read("src", "app", "api", "cron", "delete-expired-operational-proof-photos", "route.ts");
  const vercel = read("vercel.json");
  assert(route.includes("CRON_SECRET"), "cron route must require CRON_SECRET");
  assert(route.includes('request.headers.get("authorization") !== `Bearer ${secret}`'), "cron route must verify bearer token");
  assert(route.includes("OPERATIONAL_PROOF_DOCUMENT_TYPE"), "cron must only scan proof photo documents");
  assert(route.includes('status: "active"'), "cron must only delete active proof photos");
  assert(route.includes("expiryDate: { lt: now }"), "cron must only delete expired proof photos");
  assert(route.includes('storageUrl: `deleted:${document.id}`'), "cron should remove file payload after expiry");
  assert(vercel.includes("/api/cron/delete-expired-operational-proof-photos"), "vercel.json should register the cleanup cron route");
  assert(vercel.includes('"schedule": "0 3 * * *"'), "cron should run daily");
}

function operationalUiShowsCompletionWorkflow() {
  const source = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(source.includes("OperationCompletionDialog"), "operational UI should include a completion dialog");
  assert(source.includes("Finalizeaza + poze"), "tasks should expose a clear completion action");
  assert(source.includes("/api/admin/operational/tasks/complete"), "UI should call the dedicated completion endpoint");
  assert(source.includes("Pozele sunt pastrate 30 de zile"), "UI should explain photo retention");
  assert(source.includes("proofPhotosForTask"), "UI should show proof photo metadata per task");
  assert(source.includes("canChangeStatusDirectly"), "field installer should not get direct technical status controls");
  assert(source.includes("canCompleteOperationalReservation"), "UI editability should use scoped operational completion access");
  assert(source.includes("Incarca cel putin o poza dovada pentru finalizare."), "field installer completion should require proof photos");
  assert(source.includes("ProofPhotosDialog"), "authorized users should be able to view/download proof photos");
  assert(source.includes("?preview=1"), "proof photo viewer should use authenticated inline previews");
}

function operationalUiRemovesTechnicalStatusDropdown() {
  const source = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const tableBlock = blockFrom(source, "function OperationsTable", "function ProofPhotoSummary");
  assert(!tableBlock.includes("<select"), "operational decoration/neutralization table must not expose a technical status dropdown");
  assert(tableBlock.includes("OperationTaskStatusBadge"), "operational task status should be shown as a badge");
  assert(tableBlock.includes("Modifica data"), "delayed operational rows should expose a date modification action");
  assert(tableBlock.includes("Vezi poze"), "proof photos should be visible from the operational row");
}

function operationalUiHidesCompletedSectionsAndSyncButtons() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const billingBlock = blockFrom(panel, "function DecorationBillingSummary", "function OperationsTable");
  assert(billingBlock.includes("const [expanded, setExpanded] = useState(false)"), "completed monthly decorations should be collapsed by default");
  assert(billingBlock.includes("Vezi lista"), "completed monthly decorations should open only when requested");
  assert(billingBlock.includes("Ascunde lista"), "completed monthly decorations should be collapsible again");
  assert(!billingBlock.includes("<Th>Referinta</Th>"), "completed monthly decorations table must not show technical reference ids");
  assert(!panel.includes("Sync inchirieri"), "reservation sync button must not be exposed in admin UI");
  assert(!panel.includes("/api/admin/reservations/sync"), "admin UI must not call the legacy reservation sync endpoint");

  const smoke = read("scripts", "smoke-http.cjs");
  assert(!smoke.includes("/api/admin/reservations/sync"), "smoke checks must not call the legacy reservation sync endpoint");

  const billing = read("src", "lib", "decoration-billing.ts");
  assert(!billing.includes('"Referinta"'), "decoration billing CSV must not export technical reference ids");
  assert(billing.includes("left.scheduledDate || left.finalizationDate"), "completed decorations should sort by scheduled decoration date first");
  assert(billing.includes('campaignReference: task.reservation.contractNumber || ""'), "internal reservation ids must not be used as visible decoration references");
}

function sellerDashboardShowsScopedProofPhotos() {
  const dashboard = read("src", "lib", "dashboard.ts");
  const roleDashboard = read("src", "components", "admin", "RoleDashboard.tsx");
  assert(dashboard.includes("OPERATIONAL_PROOF_DOCUMENT_TYPE"), "dashboard should fetch only operational proof documents");
  assert(dashboard.includes("canAccessOperationalReservation(viewer"), "dashboard proof photos must be scoped by seller/admin access");
  assert(dashboard.includes("operationalProofDownloadPath(document.id)"), "dashboard proof photos should use authenticated admin download URLs");
  assert(roleDashboard.includes("row.proofPhotos?.length"), "role dashboard should render proof photo availability when authorized");
  assert(roleDashboard.includes("poze dovada"), "seller dashboard should clearly label proof photos");
}

function operationalDateDelayWorkflowIsAudited() {
  const route = read("src", "app", "api", "admin", "operational", "tasks", "reschedule", "route.ts");
  const status = read("src", "lib", "operation-status.ts");
  assert(route.includes("Motivul intarzierii este obligatoriu."), "date delay route must require a delay reason");
  assert(route.includes("Confirma impactul asupra perioadei si pro-rata."), "date delay route must require explicit impact confirmation");
  assert(route.includes("canRescheduleOperationalReservation"), "date delay route must enforce scoped reschedule access");
  assert(route.includes("updateReservation("), "date delay route should use existing reservation update safety logic");
  assert(route.includes("financeReviewRequired"), "date delay route must flag finance review when billing exists");
  assert(route.includes("operation.delay.reschedule"), "date delay route must write an audit log");
  assert(!route.toLowerCase().includes("smartbill"), "date delay route must not change SmartBill");
  assert(status.includes("withOperationDelayChange"), "operation metadata should store delay reason/history without a migration");
  assert(status.includes("OPERATIONAL_DELAY_CHANGE"), "delay reason history should have an explicit source");
}

function completionRefreshesLocalState() {
  const source = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(source.includes("const operationalReservations = isOperationalWorkspace ? reservations"), "operational workspace should render from local state after completion");
  assert(source.includes("reservation.id === completionTarget.reservation.id ? payload.reservation : reservation"), "completion should update the completed reservation in-place");
  assert(source.includes("completionSaving"), "completion button should be disabled while saving");
  const route = read("src", "app", "api", "admin", "operational", "tasks", "complete", "route.ts");
  assert(route.includes("alreadyCompleted"), "completion route should treat harmless duplicate completion as idempotent");
}

function reservationDtoExposesMetadataOnly() {
  const reservations = read("src", "lib", "reservations.ts");
  const types = read("src", "types", "location.ts");
  assert(reservations.includes("documents: {"), "reservation include should fetch proof document metadata");
  assert(reservations.includes("OPERATIONAL_PROOF_DOCUMENT_TYPE"), "reservation include should be limited to proof photos");
  assert(!blockFrom(reservations, "documents: {", "}") .includes("storageUrl"), "reservation DTO must not include raw proof photo data");
  assert(types.includes("operationProofPhotos"), "ReservationDTO should expose proof photo metadata");
  assert(types.includes("downloadUrl"), "ReservationDTO should expose an authenticated proof photo download URL");
}

function publicApiDoesNotExposeProofPhotos() {
  const publicRoute = read("src", "app", "api", "locations", "route.ts");
  const publicLocations = read("src", "lib", "locations.ts");
  assert(!publicRoute.includes("operationProof"), "public locations route must not expose operational proof photos");
  assert(!publicLocations.includes("operational_proof_photo"), "public location serialization must not include proof photo documents");
}

function operationTaskFlagsRemainDisabled() {
  const completeRoute = read("src", "app", "api", "admin", "operational", "tasks", "complete", "route.ts");
  const flags = ["OPERATION_TASKS_ENABLED", "OPERATION_TASK_READS_ENABLED"];
  for (const flag of flags) {
    assert(!completeRoute.includes(flag), `${flag} should not be enabled or required by proof completion`);
  }
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
