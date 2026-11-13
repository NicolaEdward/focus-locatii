#!/usr/bin/env node
"use strict";

// Continues the actual offer created by browser-sales.cjs. No API write
// shortcuts, real fiscal issuance, bank API operations or customer delivery.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/simulation/browser-lifecycle.cjs --phase <phase> [--from <sales-report.json>] [--state <resume-state.json>] [--scenario <ids>]\nRun through run-isolated.cjs against the isolated synthetic application. --plan lists the UI journeys without starting a browser.");
  process.exit(0);
}
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ scenarios: [
    { id: "SIM-UI-10", title: "Campaign contract attachment, exact-offer acceptance and authorized HOLD→BOOKED" },
    { id: "SIM-UI-11", title: "Operational brief, assignment, field execution and private photographic proof" },
    { id: "SIM-UI-12", title: "Internal billing plan, synthetic external-invoice import, fiscal split verification and allocation" },
    { id: "SIM-UI-13", title: "Local receipt tracking and campaign/client financial follow-up" },
    { id: "SIM-UI-14", title: "RON contract values remain RON in the full rental workspace" },
  ], boundaries: ["Production manufacturing is a documented handoff where no structured supplier production order exists.", "Imported fictional invoice data is not fiscal issuance.", "A local synthetic receipt is not a physical bank transfer.", "Photographs and fictional attachments do not certify actual contract terms."] }, null, 2));
  process.exit(0);
}

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const ui = require("./browser-sales.cjs");
const { generateContractFile } = require("./lifecycle-fixtures.cjs");
const { root, base, phase, arg, manifest, report, authenticated, act, click, fill, select, goto, surface, settle, capture, observe, responseAfter, runJobs, persist } = ui;

const sourceReport = arg("--from", path.join(root, "browser-after.json"));
const stateFile = arg('--state', path.join(root, `lifecycle-state-${phase}.json`));
const state = { filesDir: path.join(root, "output", "lifecycle", phase), reportSource: sourceReport, fictional: true, externalFiscalIssuance: false, externalBankTransfer: false };

function loadMainJourney() {
  if (state.campaignId) return;
  const original = JSON.parse(fs.readFileSync(sourceReport, "utf8"));
  const originalState = original.observed_created;
  if (!originalState?.quoteId || !originalState?.campaignId || !originalState?.clientId || !originalState?.reservationIds?.length) {
    const error = new Error("DEPENDENCY_MAIN_UI_OFFER_AND_AUTHORIZED_HOLD_NOT_COMPLETED"); error.unsupported = true; throw error;
  }
  if (!originalState.company?.startsWith("SIM-OOH") || !/^SIM[A-Z0-9]+$/i.test(originalState.taxId || "")) throw new Error("FICTIONAL_LIFECYCLE_IDENTITY_REQUIRED");
  Object.assign(state, originalState);
  if (fs.existsSync(stateFile)) { const prior = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (prior.quoteId !== originalState.quoteId || prior.campaignId !== originalState.campaignId) throw new Error('LIFECYCLE_RESUME_IDENTITY_MISMATCH'); Object.assign(state, prior); }
  state.campaignName = originalState.campaignName || originalState.company + " campanie de iarnă";
  fs.mkdirSync(state.filesDir, { recursive: true, mode: 0o700 });
  persistState();
}
function persistState() {
  report.lifecycle = { ...state, taxId: state.taxId || null };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); persist();
}
function requirement(value, reason) { if (!value) { const error = new Error(reason); error.unsupported = true; throw error; } }

async function contractAcceptanceAndBooking() {
  loadMainJourney();
  if (state.booked) { const { page } = await authenticated('manager'); await goto(page, '/admin/campanii?campaignId=' + encodeURIComponent(state.campaignId), 'Reopen the already verified accepted and booked campaign'); await settle(page); observe('Resume existing synthetic contract', { booked: state.bookedReservation, previous_state: stateFile }, 'A retry reuses the documented existing booking instead of creating another contract or rental.'); return; }
  const { page: seller } = await authenticated("seller");
  const contract = state.contractFile && state.contractReference && fs.existsSync(state.contractFile)
    ? { path: state.contractFile, reference: state.contractReference }
    : generateContractFile({ companyName: state.company, taxId: state.taxId, campaignName: state.campaignName, companyEntity: state.companyEntity, reference: `SIM-OOH-CONTRACT-${Date.now().toString(36).toUpperCase()}`, periodStart: state.periodStart, periodEnd: state.periodEnd, monthlyRate: state.negotiatedRate, currency: state.currency, locationCode: state.locationCode, paymentTerms: "SIM-OOH verified synthetic campaign payment/billing conditions" }, state.filesDir);
  state.contractFile = contract.path; state.contractReference = contract.reference;
  persistState();
  if (!state.documentId) {
  await goto(seller, "/admin/campanii?campaignId=" + encodeURIComponent(state.campaignId), "Open the campaign's contract/document dossier"); await settle(seller);
  await click(seller.getByRole("tab", { name: "Documente", exact: true }), "Attach the accepted fictional contract to its actual campaign"); await settle(seller);
  await click(seller.getByRole("button", { name: "Incarca", exact: true }), "Upload campaign contract"); surface("Campaign document upload");
  const documentDialog = seller.getByRole("dialog", { name: "Incarca document", exact: true });
  await select(documentDialog.getByLabel(/^Tip document/), "contract", "Choose contract document type");
  await act("file_uploads", "Choose the clearly fictional contract PDF", () => documentDialog.getByLabel("Fisier", { exact: true }).setInputFiles(contract.path));
  await fill(documentDialog.getByLabel("Observatii", { exact: true }), "SIM-OOH fictional contract used only for isolated workflow simulation. Not signed and not real business evidence.", "contract_document_note");
  const uploaded = await responseAfter(seller, r => r.url().includes("/api/admin/client-documents") && r.request().method() === "POST", () => click(documentDialog.getByRole("button", { name: "Salveaza", exact: true }), "Save the contract attached from campaign context"));
  const document = uploaded?.document || uploaded?.result?.document;
  state.documentId = document?.id || null;
  state.uploadedDocumentContext = document ? { id: document.id, documentType: document.documentType, related_ids_exposed_in_upload_receipt: Object.hasOwn(document, "clientId") && Object.hasOwn(document, "campaignId") } : { responseKeys: Object.keys(uploaded || {}) };
  persistState();
  if (document) {
    assert.equal(document.documentType, "contract");
  }
  await capture(seller, "campaign-contract-attached", [1440, 390]); persistState();
  }
  const offerWorkspace = await responseAfter(seller, r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/admin/commercial-workbench" && new URL(r.url()).searchParams.get("quoteId") === state.quoteId, () => goto(seller, "/admin/commercial-quotes?quoteId=" + encodeURIComponent(state.quoteId), "Record the exact client acceptance using the campaign contract"));
  const attached = offerWorkspace?.documents?.find(document => document.id === state.documentId);
  if (attached) {
    assert.equal(attached.clientId, state.clientId, "Campaign contract attachment resolved to another client.");
    assert.equal(attached.campaignId, state.campaignId, "Campaign contract attachment lost its campaign.");
    state.uploadedDocumentContext = { ...state.uploadedDocumentContext, clientId: attached.clientId, campaignId: attached.campaignId, context_observed_from: "authenticated_offer_workspace_GET" };
    persistState();
  }
  const linkedDocuments = seller.getByLabel("Document existent legat de dosar dacă există", { exact: true });
  const options = await linkedDocuments.locator("option").evaluateAll(rows => rows.map(row => ({ value: row.value, label: row.textContent })));
  const linked = options.find(row => row.value && (row.value === state.documentId || row.label?.includes(path.basename(contract.path))));
  observe("Campaign attachment transfers to offer acceptance", { uploaded_context: state.uploadedDocumentContext, selectable_from_same_offer: Boolean(linked), contract_file_name: path.basename(contract.path) }, "A contract uploaded from the campaign is associated with its actual client and can be selected for the same campaign's offer acceptance.");
  if (!linked) {
    await capture(seller, "campaign-contract-not-linked-to-acceptance", [1440, 390]);
    throw new Error("APPLICATION_BLOCKER_CAMPAIGN_CONTRACT_NOT_AVAILABLE_FOR_OWN_OFFER_ACCEPTANCE");
  }
  if (!state.documentId) state.documentId = linked.value;
  if (!state.acceptance) {
    await select(seller.getByLabel("Decizie", { exact: true }), "accepted", "Record client's exact-version acceptance");
    await fill(seller.getByLabel("Referință a acceptării sau contractului", { exact: true }), contract.reference, "contract_reference");
    await select(linkedDocuments, linked.value, "Link accepted offer to the uploaded fictional contract");
    const acceptance = await responseAfter(seller, r => r.request().method() === "POST" && r.request().postDataJSON()?.action === "quote.acceptance", () => click(seller.getByRole("button", { name: "Înregistrează decizia și dovada", exact: true }), "Save client acceptance and its evidence"));
    state.acceptance = acceptance?.result || null; persistState();
  }
  const { page: manager } = await authenticated("manager");
  const reservationId = state.reservationIds[0];
  await goto(manager, "/admin/locatii?reservationId=" + encodeURIComponent(reservationId), "Manager opens the authorized HOLD to prepare delivery and confirm BOOKED"); await settle(manager);
  const workspace = manager.getByRole("dialog", { name: "Gestionare rezervari", exact: true }); await workspace.waitFor();
  const row = workspace.getByRole("row").filter({ hasText: state.locationCode }).filter({ hasText: state.company }).first(); await row.waitFor();
  const beforeText = await row.innerText();
  await click(row.getByRole("button", { name: "Editeaza", exact: true }), "Add documentary reference and operational brief without retyping campaign terms"); surface("Rental correction editor");
  const editor = manager.getByRole("dialog").filter({ has: manager.getByLabel("Numar contract / IO", { exact: true }) }).last();
  await fill(editor.getByLabel("Numar contract / IO", { exact: true }), contract.reference, "contract_reference");
  await fill(editor.getByLabel("Data montaj explicita", { exact: true }), state.periodStart, "installation_date");
  await fill(editor.getByLabel("Cost montaj / decorare", { exact: true }), "150.00", "verified_installation_cost");
  await select(editor.getByLabel(/^Moneda(?! contract)/), state.currency, "Choose explicit installation cost currency");
  await click(editor.getByText("Note operationale / optional", { exact: true }), "Provide the production and installation handoff brief");
  await fill(editor.getByLabel(/^Ce trebuie montat/), "SIM-OOH production brief: print fictional approved artwork to the selected face dimensions; fit with existing tensioning. Contact and supplier details remain synthetic. Manufacturing approval is not implied by this note.", "production_brief");
  await capture(manager, "contract-and-operational-handoff", [1440, 390]);
  const edited = await responseAfter(manager, r => new URL(r.url()).pathname === "/api/reservations/" + reservationId && r.request().method() === "PATCH", () => click(editor.getByRole("button", { name: "Salveaza modificarile", exact: true }), "Save documented HOLD delivery details"));
  state.holdAfterOperationalPreparation = edited?.reservation || edited?.reservations?.[0] || null;
  const changed = await responseAfter(manager, r => new URL(r.url()).pathname === "/api/reservations/" + reservationId && r.request().method() === "PATCH", () => select(row.getByRole("combobox"), "BOOKED", "Manager explicitly confirms the contract as BOOKED"));
  const booked = changed?.reservation || changed?.reservations?.find(item => item.id === reservationId);
  assert.equal(booked?.status, "BOOKED");
  assert.equal(booked?.clientId, state.clientId); assert.equal(booked?.campaignId, state.campaignId);
  assert.equal(booked?.currency, state.currency); assert.equal(String(booked?.periodStart).slice(0, 10), state.periodStart); assert.equal(String(booked?.periodEnd).slice(0, 10), state.periodEnd);
  const actualRate = booked?.monthlyRentShare ?? booked?.amount;
  assert.equal(Number(actualRate), Number(state.negotiatedRate), "Approved negotiated rent changed during the booking handoff.");
  state.booked = true; state.bookedReservation = { id: booked.id, status: booked.status, clientId: booked.clientId, campaignId: booked.campaignId, currency: booked.currency, contractCompany: booked.contractCompany, contractNumber: booked.contractNumber, periodStart: booked.periodStart, periodEnd: booked.periodEnd, monthlyRentShare: booked.monthlyRentShare, amount: booked.amount, paymentTermType: booked.paymentTermType, paymentTermDays: booked.paymentTermDays, billingRule: booked.billingRule, billingFrequency: booked.billingFrequency, installationDate: booked.installationDate, decorationCost: booked.decorationCost, decorationCurrency: booked.decorationCurrency, productionNotes: booked.productionNotes };
  observe("Exact approved commercial terms survive HOLD to BOOKED", { previous_row: beforeText, booked: state.bookedReservation, repeated_manual_contract_reference: true }, "Client, campaign, per-face rent, currency, period and commercial conditions transfer; recording an evidence reference remains traceable and no sale is confirmed implicitly.");
  await capture(manager, "confirmed-booked-contract", [1440, 390]); persistState();
}

async function operationalExecution() {
  loadMainJourney(); requirement(state.booked, "DEPENDENCY_ACCEPTED_CONTRACT_NOT_BOOKED");
  if (state.installationCompleted) { const { page } = await authenticated('field'); await goto(page, '/admin/operational', 'Review already completed synthetic installation'); await settle(page); observe('Resume completed operation', { status: state.operationalCompletion?.status, previous_state: stateFile }, 'A retry preserves the completed task and its proof instead of repeating physical completion.'); return; }
  const { page: manager } = await authenticated("manager");
  await goto(manager, "/admin/operational", "Plan execution of the newly confirmed campaign"); await settle(manager);
  const board = manager.locator("section").filter({ has: manager.getByRole("heading", { name: "Lucrari de atribuit", exact: true }) }).first();
  const task = board.locator("label").filter({ hasText: state.locationCode + " - Decorare" }).filter({ hasText: state.company }).first();
  await task.waitFor();
  const description = await task.innerText();
  await act("checks", "Choose the actual campaign installation task", () => task.getByRole("checkbox").check());
  await select(board.getByLabel(/^Alpinist \/ executor teren/), manifest.users.field.id, "Assign the synthetic field operator");
  await fill(board.getByLabel("Motiv assignment", { exact: true }), "SIM-OOH controlled lifecycle simulation; assign only this campaign's installation.", "assignment_reason");
  const preview = await responseAfter(manager, r => r.url().includes("/api/admin/operational/assignments") && r.request().postDataJSON()?.command === "dry-run", () => click(board.getByRole("button", { name: "Verifica impactul", exact: true }), "Review assignment impact before applying"));
  assert.equal(preview?.dryRun?.blocked?.length, 0);
  const assigned = await responseAfter(manager, r => r.url().includes("/api/admin/operational/assignments") && r.request().postDataJSON()?.command === "apply", () => click(board.getByRole("button", { name: "Atribuie lucrarile", exact: true }), "Apply the reviewed field assignment"));
  state.assignment = { taskDescription: description, dryRun: preview.dryRun, result: assigned?.result };
  await capture(manager, "manager-assignment-applied", [1440, 390]);
  const { page: field } = await authenticated("field");
  await goto(field, "/admin/operational", "Field operator receives the assigned campaign task"); await settle(field);
  const ownTask = field.locator("article").filter({ hasText: state.locationCode }).filter({ hasText: state.company }).first(); await ownTask.waitFor();
  state.fieldVisibleTaskBefore = await ownTask.innerText();
  const start = ownTask.getByRole("button", { name: "Incepe lucrarea", exact: true });
  if (await start.count()) await responseAfter(field, r => r.url().includes("/api/admin/operational/tasks") && r.request().method() === "PATCH", () => click(start, "Field operator starts the assigned work"));
  await click(ownTask.getByRole("button", { name: "Finalizeaza cu poze", exact: true }), "Complete actual task with photographic evidence"); surface("Field proof completion");
  const completion = field.getByRole("dialog", { name: "Finalizeaza " + state.locationCode, exact: true });
  const proofPath = path.join(state.filesDir, "SIM-OOH-INSTALLATION-PROOF.png");
  await sharp({ create: { width: 800, height: 600, channels: 3, background: "#314f63" } }).png().toFile(proofPath);
  await act("file_uploads", "Upload a synthetic raster proof image", () => completion.locator('input[type="file"]').setInputFiles(proofPath));
  await fill(completion.getByLabel("Nota finalizare", { exact: true }), "SIM-OOH fictional task completion and photo. Only isolated workflow evidence; not a real installation or signed contractual proof.", "installation_completion_note");
  await capture(field, "field-proof-preparation", [1440, 390]);
  const finished = await responseAfter(field, r => r.url().includes("/api/admin/operational/tasks/complete") && r.request().method() === "POST", () => click(completion.getByRole("button", { name: "Marcheaza finalizat", exact: true }), "Finish the assigned task with its private proof"));
  assert.equal(finished?.status, "DONE");
  state.operationalCompletion = finished; state.installationCompleted = true;
  await capture(field, "field-installation-completed", [1440, 390]);
  observe("Sales-to-field handoff preserves the actual rental context", { manager_assignment: state.assignment, field_task_text: state.fieldVisibleTaskBefore, completion_status: finished.status, completion: finished }, "A field operator sees only assigned execution information; completion and proof are saved once and the contractual rental period is preserved.");
  observe("Production manufacturing boundary", "The workflow carries a production note and installation task; this run did not find or invent a separate manufacturing/supplier print-order approval.", "If separate production purchase orders and artwork proof approval are needed, model and authorize them explicitly before claiming that note entry completes manufacturing.", "product_boundary");
  persistState();
}

async function billingAndInvoices() {
  loadMainJourney(); requirement(state.booked, "DEPENDENCY_ACCEPTED_CONTRACT_NOT_BOOKED");
  const { billingInvoices } = require("./browser-finance-lifecycle.cjs");
  await billingInvoices({ ...ui, persistLifecycleState: persistState }, state); persistState();
}
async function receiptsAndFollowup() {
  loadMainJourney(); requirement(state.invoiceRecords?.length, "DEPENDENCY_LOCAL_SYNTHETIC_INVOICES_NOT_IMPORTED_AND_ALLOCATED");
  const { receiptFollowup } = require("./browser-finance-lifecycle.cjs");
  await receiptFollowup({ ...ui, persistLifecycleState: persistState }, state); persistState();
}
async function currencyIntegrity() {
  const { page } = await authenticated("manager");
  const reservation = manifest.reservations.find(row => row.id === "sim-ooh-reservation-004");
  assert.ok(reservation); await goto(page, "/admin/locatii?reservationId=" + encodeURIComponent(reservation.id), "Check a known RON rental in the booking workspace"); await settle(page);
  const workspace = page.getByRole("dialog", { name: "Gestionare rezervari", exact: true }); await workspace.waitFor();
  const location = manifest.locations.find(row => row.id === reservation.locationId);
  const row = workspace.getByRole("row").filter({ hasText: location.code }).first(); await row.waitFor(); const text = await row.innerText();
  observe("A RON contract keeps its stored currency in the rental table", { rental_id: reservation.id, expected_currency: "RON", displayed_row: text }, "The monetary cell must show RON and must not present a hardcoded EUR or an unverified tax basis.");
  await capture(page, "ron-rental-workspace", [1440, 390]);
  if (!phase.startsWith("baseline")) assert.ok(/RON/.test(text) && !/EUR\s*\+\s*TVA\s*\/\s*luna/.test(text), "A RON rental is still presented as EUR plus VAT in the main rental workspace.");
}

runJobs([["SIM-UI-10",contractAcceptanceAndBooking],["SIM-UI-11",operationalExecution],["SIM-UI-12",billingAndInvoices],["SIM-UI-13",receiptsAndFollowup],["SIM-UI-14",currencyIntegrity]]).then(() => persistState()).catch(error => { console.error(error.message); process.exitCode = 1; });
