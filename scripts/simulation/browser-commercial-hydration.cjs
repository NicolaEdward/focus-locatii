#!/usr/bin/env node
"use strict";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: run-isolated.cjs ... -- node scripts/simulation/browser-commercial-hydration.cjs --phase after-commercial-hydration\nUses real synthetic data with controlled initial-list omission and delayed real read responses. Saves one fictional draft; does not approve, book or deliver.");
  process.exit(0);
}
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify({ scenarios: [{ id: "SIM-UI-15", title: "Remote commercial choices hydrate off-page deep links without erasing dates, and changing client clears both loaded and pending CRM context" }], controlled_conditions: "Selected client/campaign IDs are removed only from the initial genuine workspace GET list; real options GET responses are delayed. No fabricated business records or >500-row UI seed.", mutations: "One fictional quote draft through visible UI; no approval, reservation, outbound delivery, fiscal or bank mutation." }, null, 2));
  process.exit(0);
}

const assert = require("node:assert/strict");
const ui = require("./browser-sales.cjs");
const { manifest, report, authenticated, click, fill, select, goto, settle, capture, observe, responseAfter, waitInventory, waitAvailability, runJobs, day } = ui;

async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(label);
}

async function commercialHydration() {
  const { page } = await authenticated("seller");
  const clientId = manifest.scenarios.directClientId;
  const campaignId = manifest.scenarios.directCampaignId;
  const opportunityId = manifest.scenarios.newDirectOpportunityId;
  const originalCampaign = manifest.campaigns.find(row => row.id === manifest.scenarios.agencyCampaignId);
  assert.ok(originalCampaign && originalCampaign.clientId !== clientId);
  const location = manifest.locations.find(row => row.id === manifest.scenarios.freeLocationIds[1]);
  assert.ok(location);
  const controls = { omitSelected: true, omitOpportunity: false, delay: 1000, epoch: 0 };
  const evidence = { controlled_initial_list_fixture: true, fabricated_options_records: false, intentional_read_delay_is_included_in_automated_elapsed: true, superseded_read_aborts_are_expected_for_client_switches: true, actual_options_responses: [], workspace_transformations: [] };
  let selectedCampaign;
  let pendingOpportunityStarted = false;
  let pendingOpportunityReturned = false;
  const workspacePattern = "**/api/admin/commercial-workbench?*";
  const optionsPattern = "**/api/admin/commercial-options?*";
  await page.route(workspacePattern, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (controls.omitSelected) {
      body.clients = body.clients.filter(row => row.id !== clientId);
      body.campaigns = body.campaigns.filter(row => row.id !== campaignId);
    }
    if (controls.omitOpportunity) body.opportunities = body.opportunities.filter(row => row.id !== opportunityId);
    evidence.workspace_transformations.push({ epoch: controls.epoch, omit_selected_ids: controls.omitSelected, omit_opportunity_id: controls.omitOpportunity });
    await route.fulfill({ response, json: body });
  });
  await page.route(optionsPattern, async route => {
    const epoch = controls.epoch;
    const url = new URL(route.request().url());
    const response = await route.fetch();
    const body = await response.json();
    const kind = url.searchParams.get("kind");
    const ids = url.searchParams.get("ids") || "";
    if (kind === "campaigns" && ids.includes(campaignId)) selectedCampaign = body.selected?.find(row => row.id === campaignId);
    const pendingOpportunity = controls.omitOpportunity && kind === "opportunities" && ids.includes(opportunityId);
    if (pendingOpportunity) pendingOpportunityStarted = true;
    if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
    evidence.actual_options_responses.push({ epoch, kind, requested_ids: ids.split(",").filter(Boolean), selected_ids: (body.selected || []).map(row => row.id), delay_ms: controls.delay });
    if (pendingOpportunity) pendingOpportunityReturned = true;
    await route.fulfill({ response, json: body }).catch(() => {}); // Client changes deliberately abort superseded reads.
  });
  const deepLink = (client, campaign, opportunity = "") => "/admin/commercial-quotes?" + new URLSearchParams({ clientId: client, campaignId: campaign, ...(opportunity ? { opportunityId: opportunity } : {}) });
  try {
    await goto(page, deepLink(clientId, campaignId), "Open a genuine client/campaign deep link outside the controlled initial list page");
    await page.getByLabel("Prima zi inclusă", { exact: true }).waitFor();
    await until(() => selectedCampaign, "The actual selected campaign was not returned by the bounded options API.");
    assert.ok(selectedCampaign.startDate && selectedCampaign.endDate, "Fixture campaign needs verified dates for hydration regression.");
    const expectedDates = { from: selectedCampaign.startDate.slice(0, 10), to: selectedCampaign.endDate.slice(0, 10) };
    await until(async () => await page.getByLabel("Client", { exact: true }).inputValue() === clientId && await page.getByLabel("Campanie și monedă", { exact: true }).inputValue() === campaignId && await page.getByLabel("Prima zi inclusă", { exact: true }).inputValue() === expectedDates.from && await page.getByLabel("Ultima zi inclusă", { exact: true }).inputValue() === expectedDates.to, "Off-page client/campaign did not hydrate identity and campaign dates.");
    observe("Off-page deep link hydrates genuine campaign defaults", { clientId, campaignId, expected_dates: expectedDates, initial_list_ids_deliberately_omitted: true, options_records_are_real: true }, "Selected IDs resolve through bounded authenticated options reads and apply verified campaign dates.");
    await capture(page, "off-page-commercial-ids-and-dates", [1440, 390]);

    controls.epoch++; controls.delay = 1800; selectedCampaign = null;
    await goto(page, deepLink(clientId, campaignId), "Delay real campaign hydration while the seller supplies an explicit new period");
    await page.getByLabel("Prima zi inclusă", { exact: true }).waitFor();
    const editedDates = { from: day(160), to: day(190) };
    await fill(page.getByLabel("Prima zi inclusă", { exact: true }), editedDates.from, "explicit_new_period_start");
    await fill(page.getByLabel("Ultima zi inclusă", { exact: true }), editedDates.to, "explicit_new_period_end");
    await until(async () => await page.getByLabel("Campanie și monedă", { exact: true }).inputValue() === campaignId, "Delayed campaign choice did not arrive.");
    await settle(page);
    assert.equal(await page.getByLabel("Prima zi inclusă", { exact: true }).inputValue(), editedDates.from);
    assert.equal(await page.getByLabel("Ultima zi inclusă", { exact: true }).inputValue(), editedDates.to);
    observe("Late campaign defaults preserve seller-edited dates", { original_defaults: expectedDates, explicit_period_after_hydration: editedDates, controlled_real_response_delay_ms: controls.delay }, "An authenticated read response must not replace dates the seller has explicitly edited.");
    await capture(page, "slow-commercial-hydration-preserves-edited-dates", [1440, 390]);

    controls.epoch++; controls.omitSelected = false; controls.delay = 0;
    await goto(page, deepLink(originalCampaign.clientId, originalCampaign.id, opportunityId), "Open a quote with an already loaded genuine CRM opportunity");
    const unlink = page.getByRole("button", { name: "Elimină legătura cu cererea CRM", exact: true });
    await unlink.waitFor();
    await select(page.getByLabel("Client", { exact: true }), clientId, "Change the commercial client and clear the previous CRM intention");
    assert.equal(await unlink.count(), 0);
    observe("Changing client clears an existing CRM opportunity", { original_client_id: originalCampaign.clientId, new_client_id: clientId, stale_opportunity_control_visible: false }, "Changing commercial identity drops the prior opportunity link without requiring a separate hidden correction.");

    controls.epoch++; controls.omitOpportunity = true; controls.delay = 1800; pendingOpportunityStarted = false; pendingOpportunityReturned = false;
    await goto(page, deepLink(originalCampaign.clientId, originalCampaign.id, opportunityId), "Change client while a genuine CRM opportunity is still hydrating");
    await page.getByLabel("Client", { exact: true }).waitFor();
    await until(() => pendingOpportunityStarted, "The controlled pending CRM opportunity response was not observed.");
    await select(page.getByLabel("Client", { exact: true }), clientId, "Abort the pending prior-client CRM hydration by choosing the intended client");
    await until(() => pendingOpportunityReturned, "The controlled delayed CRM response did not complete.");
    await settle(page);
    assert.equal(await unlink.count(), 0, "The delayed CRM read restored a stale opportunity after client change.");
    await until(async () => await page.getByLabel("Campanie și monedă", { exact: true }).locator('option[value="' + campaignId + '"]').count(), "The new client's genuine campaign choices did not hydrate.");
    await select(page.getByLabel("Campanie și monedă", { exact: true }), campaignId, "Select the correct new-client campaign");
    const saveDates = { from: day(200), to: day(230) };
    await fill(page.getByLabel("Prima zi inclusă", { exact: true }), saveDates.from, "draft_period_start");
    await fill(page.getByLabel("Ultima zi inclusă", { exact: true }), saveDates.to, "draft_period_end");
    await fill(page.getByLabel("E-mail destinatar", { exact: true }), "sim-commercial-hydration@example.invalid", "fictional_quote_recipient");
    await fill(page.getByLabel("Condiții și observații pentru revizuire", { exact: true }), "SIM-OOH controlled slow-read regression. Fictional draft only; no reservation, dispatch or acceptance.", "supplemental_draft_assumptions");
    assert.ok(await page.getByText("0 selectate / maximum 50", { exact: true }).count());
    const openMap = page.getByRole("button", { name: "Deschide selecția pe hartă", exact: true });
    assert.ok(await openMap.isEnabled());
    await click(openMap, "Start inventory discovery before selecting the first face");
    await page.waitForURL("**/admin/selectie-locatii?**"); await settle(page); await waitAvailability(page);
    await fill(page.getByLabel("Cauta cod, nume sau adresa", { exact: true }), location.code, "supplemental_location_search", true); await waitInventory(page); await waitAvailability(page);
    await click(page.getByRole("row").filter({ hasText: location.code }).getByRole("button", { name: "Adauga", exact: true }), "Add a free physical OOH face for the fictional draft");
    await click(page.getByRole("button", { name: "Creează oferta cu aceste locații", exact: true }), "Return the selected face and current client identity to the draft");
    await page.waitForURL("**/admin/commercial-quotes?**"); await settle(page); await waitAvailability(page); await waitInventory(page);
    assert.equal(await unlink.count(), 0);
    let posted;
    const recordCommand = request => { if (request.method() !== "POST" || !request.url().includes("/api/admin/commercial-workbench")) return; const body = request.postDataJSON(); if (body?.action === "quote.create") posted = body.input; };
    page.on("request", recordCommand);
    let saved;
    try {
      saved = await responseAfter(page, response => response.request().method() === "POST" && response.request().postDataJSON()?.action === "quote.create", () => click(page.getByRole("button", { name: "Salvează ciorna ofertei", exact: true }), "Save the actual new-client draft without stale CRM context"));
    } finally { page.off("request", recordCommand); }
    assert.ok(posted && !Object.hasOwn(posted, "opportunityId"), "The actual draft command retained the previous client's CRM opportunity.");
    assert.equal(posted.clientId, clientId); assert.equal(posted.campaignId, campaignId);
    assert.ok(saved?.result?.quote?.id);
    report.observed_created = { supplementalQuoteId: saved.result.quote.id, clientId, campaignId, periodStart: saveDates.from, periodEnd: saveDates.to, locationId: location.id, noApprovalOrBooking: true };
    observe("Pending CRM hydration stays cleared through a genuine draft save", { new_client_id: clientId, new_campaign_id: campaignId, actual_POST_has_opportunityId: false, saved_quote_id: saved.result.quote.id, zero_location_map_entry_succeeded: true }, "A superseded CRM read cannot silently relink the draft; server persistence succeeds for the chosen client and campaign without approving or booking.");
    observe("Controlled read timing and initial list-page fixture", evidence, "This UI run exercises real scoped server records with deliberate initial-list omission and delayed read responses. Full >500-record scope and pagination are separate domain tests.", "controlled_test_condition");
    await capture(page, "new-client-draft-without-stale-opportunity", [1440, 390]);
  } finally {
    await page.unroute(workspacePattern);
    await page.unroute(optionsPattern);
  }
}

runJobs([["SIM-UI-15", commercialHydration]]).catch(error => { console.error(error.message); process.exitCode = 1; });
