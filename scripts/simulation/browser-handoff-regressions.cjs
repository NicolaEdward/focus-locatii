#!/usr/bin/env node
"use strict";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: run-isolated.cjs ... -- node scripts/simulation/browser-handoff-regressions.cjs --phase after-handoff-regressions --state <existing-lifecycle-state.json> [--scenario SIM-UI-16,SIM-UI-17]\nChecks existing synthetic rental edits and field dialog surfaces. If no field work is active, a manager reviews and assigns fixture016 before the field operator opens/cancels the dialog. No reservation, invoice, receipt or completion is created.");
  process.exit(0);
}
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ scenarios: [{ id: "SIM-UI-16", title: "Consecutive rental edits retain the documented contract reference and existing operational completion" }, { id: "SIM-UI-17", title: "Field proof completion dialog has an opaque readable surface in both themes and narrow viewports" }], mutations: "One documented reference/brief correction on the existing synthetic BOOKED rental; if required, one reviewed manager assignment of fixture016. No new booking, fiscal record, payment, photo or task completion." }, null, 2));
  process.exit(0);
}

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ui = require("./browser-sales.cjs");
const { root, arg, manifest, report, authenticated, act, click, fill, select, goto, settle, capture, observe, responseAfter, runJobs } = ui;

function lifecycleState() {
  const state = JSON.parse(fs.readFileSync(arg("--state", path.join(root, "lifecycle-state-after-lifecycle.json")), "utf8"));
  assert.ok(state.booked && state.installationCompleted && String(state.company || "").startsWith("SIM-OOH") && state.contractReference && state.reservationIds?.length);
  return state;
}

async function rentalEdits() {
  const state = lifecycleState();
  const reservationId = state.reservationIds[0];
  const { page } = await authenticated("manager");
  await goto(page, "/admin/locatii?reservationId=" + encodeURIComponent(reservationId), "Review the already booked synthetic rental after contract and field handoff"); await settle(page);
  const workspace = page.getByRole("dialog", { name: "Gestionare rezervari", exact: true }); await workspace.waitFor();
  const row = workspace.getByRole("row").filter({ hasText: state.locationCode }).filter({ hasText: state.company }).first();
  await click(row.getByRole("button", { name: "Editeaza", exact: true }), "Correct the contract reference while retaining already completed installation");
  const editor = page.getByRole("dialog").filter({ has: page.getByLabel("Numar contract / IO", { exact: true }) }).last();
  const contract = editor.getByLabel("Numar contract / IO", { exact: true });
  await contract.waitFor();
  const contractBefore = await contract.inputValue();
  const date = editor.getByLabel("Data montaj explicita", { exact: true });
  const cost = editor.getByLabel("Cost montaj / decorare", { exact: true });
  const currency = editor.getByLabel(/^Moneda(?! contract)/);
  const existingDate = await date.inputValue(); const existingCost = await cost.inputValue(); const existingCurrency = await currency.inputValue();
  const inputTrace = [];
  const recordFields = async step => inputTrace.push({ step, contractNumber: await contract.inputValue(), installationDate: await date.inputValue(), decorationCost: await cost.inputValue(), decorationCurrency: await currency.inputValue() });
  await recordFields("initial");
  await fill(contract, state.contractReference, "contract_reference");
  await recordFields("after_contract_reference");
  await fill(date, existingDate, "existing_installation_date");
  await recordFields("after_installation_date");
  await fill(cost, existingCost, "existing_verified_installation_cost");
  await recordFields("after_installation_cost");
  await select(currency, existingCurrency, "Retain verified production currency during the documented correction");
  await recordFields("after_cost_currency");
  const notes = editor.getByLabel(/^Ce trebuie montat/);
  if (!(await notes.isVisible())) await click(editor.getByText("Note operationale / optional", { exact: true }), "Review the existing operational brief and completion metadata");
  const existingNotes = await notes.inputValue();
  const marker = "SIM-OOH documented handoff regression: retain contract reference and completed installation.";
  const nextNotes = existingNotes.includes(marker) ? existingNotes : existingNotes + "\n" + marker;
  await fill(notes, nextNotes, "documented_handoff_correction_note");
  await recordFields("after_operational_note");
  report.rentalCorrection = { reservationId, inputTrace };
  ui.persist();
  assert.equal(await contract.inputValue(), state.contractReference, "Consecutive edits lost the contract reference before save.");
  assert.equal(await date.inputValue(), existingDate);
  assert.equal(await cost.inputValue(), existingCost);
  assert.equal(await currency.inputValue(), existingCurrency);
  let actualPatch;
  const recordPatch = request => { if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/reservations/" + reservationId) actualPatch = request.postDataJSON(); };
  page.on("request", recordPatch);
  let corrected;
  try {
    corrected = await responseAfter(page, response => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/reservations/" + reservationId, () => click(editor.getByRole("button", { name: "Salveaza modificarile", exact: true }), "Save the documented correction without changing commercial or completion terms"));
  } finally { page.off("request", recordPatch); }
  report.rentalCorrection.actualPatch = actualPatch;
  ui.persist();
  assert.equal(actualPatch?.contractNumber, state.contractReference);
  const rental = corrected.reservation || corrected.reservations?.find(row => row.id === reservationId);
  assert.ok(rental);
  assert.equal(rental.contractNumber, state.contractReference);
  assert.equal(rental.status, "BOOKED"); assert.equal(rental.clientId, state.clientId); assert.equal(rental.campaignId, state.campaignId);
  assert.equal(rental.currency, state.currency); assert.equal(Number(rental.monthlyRentShare ?? rental.amount), Number(state.negotiatedRate));
  assert.equal(rental.periodStart.slice(0, 10), state.periodStart); assert.equal(rental.periodEnd.slice(0, 10), state.periodEnd);
  assert.equal(rental.installationDate.slice(0, 10), existingDate); assert.ok(rental.productionNotes.includes(marker));
  assert.ok(rental.operationProofPhotos?.some(photo => state.operationalCompletion.proofPhotos.some(saved => saved.id === photo.id)), "Documentary correction lost the saved installation proof.");
  report.observed_created = { correctedExistingReservationId: reservationId, noNewBookingOrOperation: true };
  observe("Consecutive edits retain contract reference, commercial values and completed proof", { reservationId, contract_number_before: contractBefore, saved_contract_number: rental.contractNumber, amount: rental.monthlyRentShare ?? rental.amount, currency: rental.currency, periodStart: rental.periodStart, periodEnd: rental.periodEnd, installationDate: rental.installationDate, proof_ids: rental.operationProofPhotos.map(photo => photo.id) }, "A documented correction retains every entered field, the agreed commercial period and existing completed execution evidence.");
  await capture(page, "documented-contract-reference-correction", [1440, 390]);
}

async function fieldDialogSurface() {
  const { page } = await authenticated("field");
  await goto(page, "/admin/operational", "Inspect an existing assigned field task without completing it"); await settle(page);
  const activeTasks = () => page.locator("article").filter({ has: page.getByRole("button", { name: "Finalizeaza cu poze", exact: true }) });
  if (!(await activeTasks().count())) {
    const reservation = manifest.reservations.find(row => row.id === "sim-ooh-reservation-016");
    assert.equal(reservation?.status, "BOOKED");
    const location = manifest.locations.find(row => row.id === reservation.locationId);
    const campaign = manifest.campaigns.find(row => row.id === reservation.campaignId);
    assert.ok(location && campaign);
    const { page: manager } = await authenticated("manager");
    await goto(manager, "/admin/operational", "Prepare one existing synthetic task for read-only modal verification"); await settle(manager);
    const board = manager.locator("section").filter({ has: manager.getByRole("heading", { name: "Lucrari de atribuit", exact: true }) }).first();
    const task = board.locator("label").filter({ hasText: location.code + " - Decorare" }).filter({ hasText: campaign.name }).first();
    await task.waitFor();
    await act("checks", "Choose only fixture016's existing pending base installation", () => task.getByRole("checkbox").check());
    await select(board.getByLabel(/^Alpinist \/ executor teren/), manifest.users.field.id, "Assign the existing synthetic field operator");
    await fill(board.getByLabel("Motiv assignment", { exact: true }), "SIM-OOH read-only completion-dialog regression; only fixture016, no execution or completion.", "modal_verification_assignment_reason");
    const preview = await responseAfter(manager, response => response.url().includes("/api/admin/operational/assignments") && response.request().postDataJSON()?.command === "dry-run", () => click(board.getByRole("button", { name: "Verifica impactul", exact: true }), "Review the isolated task assignment before applying"));
    assert.equal(preview?.dryRun?.blocked?.length, 0);
    assert.equal(preview?.dryRun?.changeCount, 1);
    const applied = await responseAfter(manager, response => response.url().includes("/api/admin/operational/assignments") && response.request().postDataJSON()?.command === "apply", () => click(board.getByRole("button", { name: "Atribuie lucrarile", exact: true }), "Apply the single reviewed synthetic fixture assignment"));
    report.fieldDialogAssignment = { reservationId: reservation.id, locationId: location.id, campaignId: campaign.id, assigneeUserId: manifest.users.field.id, dryRun: preview.dryRun, result: applied.result, completionSubmitted: false };
    ui.persist();
    observe("Canonical task assignment prepares a safe modal inspection", report.fieldDialogAssignment, "The original seeded manual task lacks a canonical dedupe link; this is a fixture limitation. Assign one existing pending base task through actual reviewed UI controls, then inspect and cancel without executing it.", "controlled_test_condition");
    await authenticated("field");
    await goto(page, "/admin/operational", "Open the reviewed assigned fixture task in the field inbox"); await settle(page);
    assert.ok(await activeTasks().count());
  }
  for (const theme of ["light", "dark"]) {
    const actualTheme = await page.locator("html").getAttribute("data-theme");
    if (actualTheme !== theme) await click(page.getByRole("button", { name: theme === "dark" ? "Activeaza tema intunecata" : "Activeaza tema luminoasa", exact: true }), "Choose the " + theme + " admin theme");
    const task = page.locator("article").filter({ has: page.getByRole("button", { name: "Finalizeaza cu poze", exact: true }) }).first();
    await task.waitFor();
    const code = await task.getByRole("heading").innerText();
    await click(task.getByRole("button", { name: "Finalizeaza cu poze", exact: true }), "Inspect the field evidence dialog in the " + theme + " theme");
    const dialog = page.getByRole("dialog", { name: "Finalizeaza " + code, exact: true });
    const styles = await dialog.locator(":scope > div").first().evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, className: element.className }));
    assert.ok(styles.background !== "transparent" && !/rgba\([^)]*,\s*0\)/.test(styles.background), "Field completion panel has a transparent background in the " + theme + " theme.");
    observe("Opaque field completion surface in " + theme + " theme", { theme, locationCode: code, computed_styles: styles, actual_completion_submitted: false }, "Field instructions, evidence previews and completion actions remain readable above the dimmed task list.");
    await capture(page, "field-completion-dialog-" + theme, [1440, 390]);
    await click(dialog.getByRole("button", { name: "Renunta", exact: true }), "Close the inspected dialog without changing task state");
  }
}

runJobs([["SIM-UI-16", rentalEdits], ["SIM-UI-17", fieldDialogSurface]]).catch(error => { console.error(error.message); process.exitCode = 1; });
