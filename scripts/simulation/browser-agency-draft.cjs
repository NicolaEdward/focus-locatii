#!/usr/bin/env node
"use strict";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: run-isolated.cjs ... -- node scripts/simulation/browser-agency-draft.cjs --phase after-agency-draft\nCreates one synthetic agency campaign and one quote draft through the UI, reopens both, and reads its private print page. No approvals, reservation, dispatch, fiscal or banking actions.");
  process.exit(0);
}
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ scenarios: [{ id: "SIM-UI-18", title: "Persist and reopen a new agency campaign, prepare its real draft offer, and print the immutable contracting/agency/beneficiary identities" }], boundaries: "Commission and rebate remain unapproved manual conditions. No percentage is invented or automatically applied; no existing agency campaign is edited." }, null, 2));
  process.exit(0);
}

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ui = require("./browser-sales.cjs");
const { root, phase, arg, manifest, report, authenticated, click, fill, select, goto, settle, capture, observe, responseAfter, waitInventory, waitAvailability, runJobs, day, persist } = ui;
const statePath = arg("--state", path.join(root, "agency-state-" + phase + ".json"));
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { fictional: true };
function checkpoint() { report.agency = state; fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); persist(); }

async function agencyDraft() {
  const { page } = await authenticated("seller");
  const clientId = manifest.scenarios.agencyClientId;
  const beneficiaryId = manifest.scenarios.agencyEndClientId;
  const agency = manifest.clients.find(row => row.id === clientId);
  const beneficiary = manifest.clients.find(row => row.id === beneficiaryId);
  const location = manifest.locations.find(row => row.id === manifest.scenarios.freeLocationIds[0]);
  assert.ok(agency?.name.startsWith("SIM-OOH") && beneficiary?.name.startsWith("SIM-OOH") && location);
  if (!state.campaignId) {
    const stamp = Date.now().toString(36).toUpperCase();
    state.campaignName = "SIM-OOH Agency workflow " + phase + " " + stamp;
    state.campaignCode = "SIM-OOH-AGENCY-" + stamp;
    state.clientId = clientId; state.agencyClientId = clientId; state.endClientId = beneficiaryId;
    await goto(page, "/admin/campanii?create=1&clientId=" + encodeURIComponent(clientId), "Create a separate fictional agency campaign without modifying an existing booked dossier"); await settle(page);
    const dialog = page.getByRole("dialog", { name: "Campanie noua", exact: true }); await dialog.waitFor();
    await select(dialog.getByLabel(/^Tip relație comercială/), "agency", "Choose an agency-mediated commercial relationship");
    await select(dialog.getByLabel("Client", { exact: true }), clientId, "Choose the contracting and invoiced agency client");
    await click(dialog.getByRole("button", { name: "Folosește clientul contractual ca agenție", exact: true }), "Explicitly use the contracting agency in its separate intermediary role");
    await fill(dialog.getByLabel("Caută beneficiar final", { exact: true }), beneficiary.name, "agency_beneficiary_search", true);
    await select(dialog.getByLabel("Beneficiar final", { exact: true }), beneficiaryId, "Choose the distinct final beneficiary from the authorized portfolio");
    await fill(dialog.getByLabel("Nume campanie", { exact: true }), state.campaignName, "agency_campaign_name");
    await fill(dialog.getByLabel("Cod campanie", { exact: true }), state.campaignCode, "agency_campaign_code");
    await select(dialog.getByLabel(/^Moneda propunerii comerciale/), "EUR", "Select verified agency proposal currency");
    await select(dialog.getByLabel(/^Status/), "draft", "Keep this separate agency campaign in draft");
    await select(dialog.getByLabel(/^Entitate contractuala/), "Focus Media", "Choose the explicit contracting company");
    await select(dialog.getByLabel(/^Termen de plată verificat/), "45_days", "Record the explicit agency payment term");
    await select(dialog.getByLabel(/^Facturare/), "monthly_in_advance", "Record the agreed invoice rule");
    await select(dialog.getByLabel(/^Frecvența facturării/), "monthly", "Record monthly billing frequency");
    await fill(dialog.getByLabel("Observatii", { exact: true }), "SIM-OOH fictional agency draft. Commission and rebate remain unapproved manual conditions requiring separate verification; no percentage or automatic margin is authorized.", "agency_commercial_boundary");
    assert.equal(await dialog.getByLabel("Agenție intermediară", { exact: true }).inputValue(), clientId);
    assert.equal(await dialog.getByLabel("Beneficiar final", { exact: true }).inputValue(), beneficiaryId);
    await capture(page, "new-agency-campaign-preparation", [1440, 390]);
    const saved = await responseAfter(page, response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/campaigns", () => click(dialog.getByRole("button", { name: "Salveaza", exact: true }), "Persist the actual synthetic agency relationship and commercial terms"));
    assert.ok(saved.campaign?.id);
    assert.equal(saved.campaign.clientId, clientId); assert.equal(saved.campaign.agencyClientId, clientId); assert.equal(saved.campaign.endClientId, beneficiaryId); assert.equal(saved.campaign.campaignType, "agency");
    assert.equal(saved.campaign.sellerUserId, manifest.users.sellerA.id); assert.equal(saved.campaign.currency, "EUR"); assert.equal(saved.campaign.status, "draft");
    state.campaignId = saved.campaign.id; state.createdCampaign = saved.campaign; checkpoint();
  }
  assert.equal(state.clientId, clientId); assert.equal(state.agencyClientId, clientId); assert.equal(state.endClientId, beneficiaryId);
  const reopened = await responseAfter(page, response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/campaigns/" + state.campaignId, () => goto(page, "/admin/campanii?campaignId=" + encodeURIComponent(state.campaignId), "Reopen the newly saved agency dossier from its actual campaign URL"));
  assert.equal(reopened.campaign?.clientId, clientId); assert.equal(reopened.campaign?.agencyClientId, clientId); assert.equal(reopened.campaign?.endClientId, beneficiaryId);
  const dossier = await page.locator("body").innerText();
  assert.ok(dossier.includes(agency.name) && dossier.includes(beneficiary.name) && dossier.includes("Client contractual / facturat") && dossier.includes("Agenție") && dossier.includes("Beneficiar final"));
  await click(page.getByRole("button", { name: "Editeaza", exact: true }), "Verify the persisted structured party selections after reopening");
  const reopenedEditor = page.getByRole("dialog", { name: "Editeaza campanie", exact: true });
  assert.equal(await reopenedEditor.getByLabel("Client", { exact: true }).inputValue(), clientId);
  assert.equal(await reopenedEditor.getByLabel("Agenție intermediară", { exact: true }).inputValue(), clientId);
  assert.equal(await reopenedEditor.getByLabel("Beneficiar final", { exact: true }).inputValue(), beneficiaryId);
  assert.equal(await reopenedEditor.getByLabel(/^Moneda propunerii comerciale/).inputValue(), "EUR");
  observe("Agency campaign stores the three commercial roles explicitly", { campaignId: state.campaignId, contractual_client: { id: clientId, name: agency.name }, intermediary_agency: { id: clientId, name: agency.name }, final_beneficiary: { id: beneficiaryId, name: beneficiary.name }, sellerUserId: reopened.campaign.sellerUserId, currency: reopened.campaign.currency, status: reopened.campaign.status }, "Contracting/invoiced client, intermediary agency and final beneficiary persist as distinct roles, even when the first two use the same authorized party.");
  await capture(page, "reopened-agency-party-selections", [1440, 390]);
  await page.keyboard.press("Escape");

  if (!state.quoteId) {
    state.periodStart = day(300); state.periodEnd = day(330); state.locationId = location.id; state.locationCode = location.code;
    await goto(page, "/admin/commercial-quotes?" + new URLSearchParams({ clientId, campaignId: state.campaignId }), "Prepare the actual agency draft offer with the saved party identities"); await settle(page);
    await fill(page.getByLabel("Prima zi inclusă", { exact: true }), state.periodStart, "agency_period_start");
    await fill(page.getByLabel("Ultima zi inclusă", { exact: true }), state.periodEnd, "agency_period_end");
    await fill(page.getByLabel("E-mail destinatar", { exact: true }), "sim-agency-workflow@example.invalid", "agency_fictional_recipient");
    await click(page.getByRole("button", { name: "Deschide selecția pe hartă", exact: true }), "Discover a free physical OOH face for the agency draft");
    await page.waitForURL("**/admin/selectie-locatii?**"); await settle(page); await waitAvailability(page);
    await fill(page.getByLabel("Cauta cod, nume sau adresa", { exact: true }), location.code, "agency_location_search", true); await waitInventory(page); await waitAvailability(page);
    await click(page.getByRole("row").filter({ hasText: location.code }).getByRole("button", { name: "Adauga", exact: true }), "Choose one available physical face without reserving it");
    await click(page.getByRole("button", { name: "Creează oferta cu aceste locații", exact: true }), "Return the actual agency draft selection to the offer");
    await page.waitForURL("**/admin/commercial-quotes?**"); await settle(page); await waitAvailability(page); await waitInventory(page);
    assert.equal(await page.getByLabel("Client", { exact: true }).inputValue(), clientId); assert.equal(await page.getByLabel("Campanie și monedă", { exact: true }).inputValue(), state.campaignId);
    await fill(page.getByLabel("Condiții și observații pentru revizuire", { exact: true }), "SIM-OOH fictional agency quote. Commission and rebate require separate verification and remain unapproved; the quoted catalog rent does not invent either charge.", "agency_offer_boundary");
    const quoted = await responseAfter(page, response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "quote.create", () => click(page.getByRole("button", { name: "Salvează ciorna ofertei", exact: true }), "Save the actual agency offer as an unapproved draft"));
    assert.ok(quoted.result?.quote?.id && quoted.result?.revision?.id);
    const payload = quoted.result.revision.payload;
    assert.equal(payload.clientId, clientId); assert.equal(payload.campaignId, state.campaignId); assert.equal(payload.campaignParties?.campaignType, "agency");
    assert.deepEqual(payload.campaignParties.agency, { id: clientId, name: agency.name });
    assert.deepEqual(payload.campaignParties.endClient, { id: beneficiaryId, name: beneficiary.name });
    assert.ok(payload.campaignPartiesFingerprint);
    state.quoteId = quoted.result.quote.id; state.revisionId = quoted.result.revision.id; state.payloadHash = quoted.result.revision.payloadHash; state.immutablePayload = payload; checkpoint();
  }
  const readQuote = await responseAfter(page, response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/commercial-workbench" && new URL(response.url()).searchParams.get("quoteId") === state.quoteId, () => goto(page, "/admin/commercial-quotes?quoteId=" + encodeURIComponent(state.quoteId), "Reopen the persisted agency quote without approving or reserving it"));
  const quote = readQuote.quotes?.find(row => row.id === state.quoteId);
  const revision = quote?.revisions.find(row => row.id === state.revisionId);
  assert.equal(quote?.state, "draft"); assert.deepEqual(revision?.payload.campaignParties, state.immutablePayload.campaignParties); assert.equal(revision?.payloadHash, state.payloadHash);
  assert.ok(!readQuote.approvals?.some(row => row.revisionId === state.revisionId));
  await capture(page, "saved-agency-offer-draft", [1440, 390]);
  const printed = await goto(page, "/admin/commercial-quotes/" + encodeURIComponent(state.quoteId) + "/print?revision=" + encodeURIComponent(state.revisionId), "Read the private printable immutable agency quote version");
  assert.equal(printed.status(), 200);
  const paper = page.getByRole("article", { name: "Oferta comercială pentru tipărire", exact: true });
  const printText = await paper.innerText();
  assert.ok(/client contractual \/ facturat/i.test(printText) && printText.includes(state.immutablePayload.clientName));
  assert.ok(printText.includes("Agenție intermediară: " + state.immutablePayload.campaignParties.agency.name));
  assert.ok(printText.includes("Beneficiar final: " + state.immutablePayload.campaignParties.endClient.name));
  assert.ok(printText.includes(state.payloadHash) && printText.includes("Ciornă — necesită validare"));
  observe("Private print uses the saved immutable agency and beneficiary snapshot", { quoteId: state.quoteId, revisionId: state.revisionId, payloadHash: state.payloadHash, snapshot_parties: state.immutablePayload.campaignParties, quote_state: quote.state, approval_count: 0, printed_campaign: state.immutablePayload.campaignName }, "The printed version shows the captured contracting client, agency and final beneficiary with its immutable verification hash. Printing alone grants no approval, reservation, delivery or fiscal effect.");
  observe("Agency commission and rebate boundary", "Unapproved manual conditions only; no commission/rebate percentage is entered, calculated or inferred from rent.", "Supporting the agency relationship does not imply structured commission, rebate, supplier settlement or agency margin support.", "product_boundary");
  report.observed_created = { agencyCampaignId: state.campaignId, agencyQuoteId: state.quoteId, quoteRevisionId: state.revisionId, clientId, agencyClientId: clientId, endClientId: beneficiaryId, noApprovalHoldBookingOrFinanceEffects: true };
  checkpoint(); await capture(page, "private-agency-quote-print", [1440, 390]);
}

runJobs([["SIM-UI-18", agencyDraft]]).catch(error => { console.error(error.message); process.exitCode = 1; });
