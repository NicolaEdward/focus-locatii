#!/usr/bin/env node
/* Practical synthetic seller journeys. Run only after the isolation gate. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createBrowserRuntime } = require("../release/browser-runtime.cjs");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/simulation/browser-sales.cjs --phase <phase> [--scenario <ids>] [--input <fixture-input.json>]\nRun through run-isolated.cjs against the isolated synthetic application. --plan lists the UI journeys without starting a browser.");
  process.exit(0);
}
const root = process.env.OOH_SIMULATION_ARTIFACT_DIR || "/workspace/work/ooh-simulation";
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const phase = arg("--phase", "baseline");
if (!/^[a-z0-9-]{1,40}$/.test(phase)) throw new Error("Invalid phase name.");
const plan = [
  { id: "SIM-UI-01", title: "New inbound client, commercial preparation, dated selection, negotiated offer and approved HOLD", writes: true },
  { id: "SIM-UI-02", title: "Partial availability and an incompatible requested period", writes: false },
  { id: "SIM-UI-03", title: "Revision and map round trip preserve negotiated terms", writes: true },
  { id: "SIM-UI-04", title: "Agency, contracting client and final beneficiary are distinguishable", writes: false },
  { id: "SIM-UI-05", title: "Returning client, historical campaign and commercial price history", writes: false },
  { id: "SIM-UI-06", title: "Full inventory discovery, zone, budget, format and size criteria", writes: false },
  { id: "SIM-UI-07", title: "Desktop, laptop, tablet and mobile layouts with many rows and long names", writes: false },
  { id: "SIM-UI-08", title: "Effective price amendment summary and missing production cost are represented honestly", writes: false },
  { id: "SIM-UI-09", title: "Guided city/zone/format/price/size planning and explicit partial date adjustment", writes: false },
];
if (process.argv.includes("--plan")) { console.log(JSON.stringify({ phase, scenarios: plan, timing: "Automated elapsed durations, never human benchmark timings." }, null, 2)); process.exit(0); }

const db = new URL(process.env.DATABASE_URL || "invalid:");
const base = (process.env.OOH_SIMULATION_BASE_URL || "http://127.0.0.1:3041").replace(/\/$/, "");
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.pathname.startsWith('/focus_preview_simulation_') || process.env.OOH_SIMULATION !== 'true' || process.env.OOH_SIMULATION_DATASET_ID !== 'focus-ooh-real-company-v1' || process.env.ALLOW_SYNTHETIC_SEED !== 'true' || process.env.PREVIEW_DATASET_ID !== 'focus-media-synthetic-v1' || ['production'].includes(process.env.APP_ENV) || process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') throw new Error('Synthetic simulation environment required.');
if (new URL(base).origin !== 'http://127.0.0.1:3041') throw new Error('Browser simulation must target the isolated localhost application on port 3041.');
const manifest = JSON.parse(fs.readFileSync(arg('--manifest', path.join(root, 'manifest.json')), 'utf8'));
const privateAccounts = JSON.parse(fs.readFileSync(arg('--accounts', path.join(root, 'accounts.private.json')), 'utf8'));
const configPath = arg('--input', path.join(root, 'browser-input.json'));
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const accounts = privateAccounts.accounts || privateAccounts.users || privateAccounts;
const day = (offset) => new Date(new Date((manifest.anchorDate || '2026-11-16') + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0, 10);
const futureRental = manifest.reservations?.find(row => row.id === manifest.scenarios?.futureRentalId);
const partialLocation = manifest.locations?.find(row => row.id === futureRental?.locationId);
const defaults = { periodStart: day(45), periodEnd: day(75), availableLocationCode: manifest.locations?.find(row => row.city === 'Bucuresti')?.code, partialLocationCode: partialLocation?.code, partialPeriodStart: day(0), partialPeriodEnd: day(65), agencyCampaignId: manifest.scenarios?.agencyCampaignId, renewalCampaignId: manifest.scenarios?.directCampaignId };
const input = { opsSegmentedCampaignId: manifest.scenarios?.opsSegmentedCampaignId, opsCostCampaignId: manifest.scenarios?.opsCostCampaignId, ...defaults, ...(manifest.browser || manifest.browserInputs || {}), ...config };
const out = path.join(root, 'screenshots', phase); fs.mkdirSync(out, { recursive: true });
const report = { schema_version: '1.0', phase, source_commit: process.env.OOH_SIMULATION_SOURCE_COMMIT || null, application: base, dataset: 'focus-ooh-real-company-v1', started_at: new Date().toISOString(), methods: { login: 'Real credential form submission; no injected tokens or API login shortcut.', actions: 'Explicit wrapper calls count clicks, fills, selects, checks and direct navigation. Screens include distinct path and explicitly opened dialogs.', timing: 'Wall-clock automated execution including rendering and waits. Not an estimate of human time.', search: 'Each deliberate search input or search submission is recorded, including debounced inputs.', repeated_input: 'Same normalized business key and value entered more than once within a scenario; credentials excluded.', navigation: 'Some scenarios begin from a bookmarked workspace URL. Direct navigation is counted and is distinguishable from link clicks.' }, isolation: { browser_external_requests: 'blocked', external_attempts: [] }, authentication: [], scenarios: [], captures: [], page_errors: [], console_errors: [], failed_requests: [], observed_created: {} };
let browser;
let current = null;
let activeRole = null;
const contexts = new Map();
function persist() { report.updated_at = new Date().toISOString(); fs.writeFileSync(path.join(root, `browser-${phase}.json`), JSON.stringify(report, null, 2) + '\n'); }
function account(role) {
  let row = Array.isArray(accounts) ? accounts.find(x => x.key === role || x.roleKey === role || x.alias === role || x.role === role) : accounts[role];
  if (!row && role === 'seller') row = Array.isArray(accounts) ? accounts.find(x => x.role === 'SALES_AGENT') : accounts.sellerA || accounts.sales || accounts.salesAgent;
  if (!row && role === 'manager') row = Array.isArray(accounts) ? accounts.find(x => x.role === 'COO' || x.role === 'SUPER_ADMIN') : accounts.coo || accounts.admin;
  if (!row || !row.email || !(row.password || privateAccounts.password)) throw new Error(`Missing synthetic account alias: ${role}`);
  if (!row.email.endsWith('@example.invalid')) throw new Error('Only fictional invalid-domain accounts are allowed.');
  return { ...row, password: row.password || privateAccounts.password };
}
async function authenticated(role) {
  if (current) { const alreadyActed = current.actor_roles.size > 0; current.actor_roles.add(role); if (alreadyActed && activeRole && activeRole !== role) current.metrics.role_handoffs = (current.metrics.role_handoffs || 0) + 1; }
  activeRole = role;
  if (contexts.has(role)) return contexts.get(role);
  const credentials = account(role);
  const priorCurrent = current; current = null;
  try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Bucharest', locale: 'ro-RO' });
  await context.route('**/*', route => {
    const address = new URL(route.request().url());
    if (address.origin === base || ['data:', 'blob:'].includes(address.protocol)) return route.continue();
    report.isolation.external_attempts.push({ origin: address.origin, resource_type: route.request().resourceType(), blocked: true });
    return route.abort('blockedbyclient');
  });
  context.on('page', page => attach(page, role));
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Parola', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(url => url.pathname !== '/admin/login', { timeout: 30000 });
  report.authentication.push({ role, method: 'UI credentials', success: true, elapsed_ms: Date.now() - started, destination: new URL(page.url()).pathname, credential_fields_counted_in_business_metrics: false });
  contexts.set(role, { context, page }); persist(); return contexts.get(role);
  } finally { current = priorCurrent; }
}
function attach(page, role) {
  page.on('console', message => { if (message.type() === 'error') report.console_errors.push({ role, scenario: current?.id || null, page: new URL(page.url()).pathname, message: message.text().slice(0, 1000) }); });
  page.on('pageerror', error => report.page_errors.push({ role, scenario: current?.id || null, page: new URL(page.url()).pathname, message: error.message }));
  page.on('requestfailed', request => { if (request.url().startsWith(base)) report.failed_requests.push({ role, scenario: current?.id || null, path: new URL(request.url()).pathname, method: request.method(), error: request.failure()?.errorText }); });
  page.on('response', response => { if (current && response.url().startsWith(base) && response.status() >= 400) current.http_errors.push({ path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() }); });
  page.on('framenavigated', frame => { if (current && frame === page.mainFrame() && frame.url().startsWith(base)) { const url = new URL(frame.url()); current.paths.add(url.pathname); current.screens.add(url.pathname); } });
}
async function act(type, label, fn, options = {}) {
  const started = Date.now();
  if (current) {
    current.metrics[type] = (current.metrics[type] || 0) + 1;
    if (options.search) current.metrics.searches++;
    if (options.key && options.value !== undefined) {
      const identity = `${options.key}:${String(options.value).trim().toLowerCase()}`;
      const prior = current.inputs.get(identity) || 0;
      if (prior) current.metrics.repeated_business_entries++;
      current.inputs.set(identity, prior + 1);
    }
  }
  try { const result = await fn(); if (current) current.actions.push({ type, label, actor_role: activeRole, elapsed_ms: Date.now() - started, ...(options.key ? { business_key: options.key } : {}), ...(options.search ? { search: true } : {}) }); return result; }
  catch (error) { if (current) current.actions.push({ type, label, actor_role: activeRole, elapsed_ms: Date.now() - started, failed: true, error: error.message }); throw error; }
}
const click = (locator, label) => act('clicks', label, () => locator.click());
const fill = (locator, value, key, search = false) => act('fills', key, () => locator.fill(String(value)), { key, value, search });
const select = (locator, value, label) => act('selects', label, () => locator.selectOption(value));
const goto = (page, route, label) => act('direct_navigations', label || route, () => page.goto(base + route, { waitUntil: 'domcontentloaded' }));
function surface(name) { current?.screens.add(name); }
async function settle(page) { await page.waitForLoadState('domcontentloaded'); await page.locator('[aria-busy=true]').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {}); await page.waitForTimeout(350); }
async function capture(page, name, widths = [1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 }); await page.waitForTimeout(180);
    const file = path.join(out, `${name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const layout = await page.evaluate(() => ({ viewport_width: innerWidth, document_width: document.documentElement.scrollWidth, outer_overflow_px: Math.max(0, document.documentElement.scrollWidth - innerWidth), scroll_regions: [...document.querySelectorAll('main *,[role=dialog] *')].filter(element => { const s = getComputedStyle(element); return element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 4 && /auto|scroll/.test(s.overflowX); }).slice(0, 15).map(element => ({ tag: element.tagName, role: element.getAttribute('role'), width: element.clientWidth, scroll_width: element.scrollWidth, text: (element.textContent || '').trim().slice(0, 150) })), visible_dialogs: [...document.querySelectorAll('[role=dialog]')].filter(e => e.getClientRects().length).map(e => ({ label: e.getAttribute('aria-label') || document.getElementById(e.getAttribute('aria-labelledby'))?.textContent || null, width: e.clientWidth, scroll_height: e.scrollHeight, client_height: e.clientHeight })) }));
    report.captures.push({ scenario: current?.id || null, name, width, path: file, page: new URL(page.url()).pathname, ...layout });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); persist();
}
function observe(title, observed, expected, status = 'confirmed') { current.observations.push({ title, status, observed, expected }); }
async function scenario(id, fn) {
  const spec = plan.find(x => x.id === id) || { id, title: id, writes: true };
  const value = { ...spec, status: 'running', started_at: new Date().toISOString(), metrics: { clicks: 0, fills: 0, selects: 0, checks: 0, direct_navigations: 0, searches: 0, repeated_business_entries: 0 }, actions: [], observations: [], http_errors: [], actor_roles: new Set(), paths: new Set(), screens: new Set(), inputs: new Map() };
  current = value; const started = Date.now();
  try { await fn(); value.status = 'completed'; } catch (error) { value.status = error.unsupported ? 'unsupported' : 'blocked'; value.error = error.message; const p = contexts.get(activeRole)?.page || contexts.get('seller')?.page; if (p && !p.isClosed()) await capture(p, `${id}-blocked`).catch(() => {}); }
  value.elapsed_ms = Date.now() - started; value.distinct_paths = [...value.paths]; value.logical_screens = [...value.screens]; value.metrics.distinct_paths = value.paths.size; value.metrics.logical_screens = value.screens.size; value.metrics.explicit_actions = value.actions.length; value.actor_roles = [...value.actor_roles]; delete value.paths; delete value.screens; delete value.inputs; report.scenarios.push(value); current = null; persist();
}
function required(key) { if (!input[key]) { const error = new Error(`Fixture browser input '${key}' is missing; scenario cannot be honestly exercised.`); error.unsupported = true; throw error; } return input[key]; }
async function responseAfter(page, match, command) { const [response] = await Promise.all([page.waitForResponse(response => response.url().includes('/api/') && match(response), { timeout: 30000 }), command()]); const payload = await response.json().catch(() => null); if (response.status() >= 400) throw new Error(`UI command failed (${response.status()}): ${payload?.error || new URL(response.url()).pathname}`); await settle(page); return payload; }
// Session validation binds browser cookies to the browser user agent. Keep
// supporting read-only preconditions in that same authenticated context.
async function browserGet(page, url) { return page.evaluate(async address => { const response = await fetch(address, { cache: 'no-store' }); return { status: response.status, payload: await response.json() }; }, url); }
async function waitInventory(page) { await page.getByText('Se caută în întreg inventarul…', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(450); }
async function waitAvailability(page) { await page.getByText(/Se verifică disponibilitatea|Verificam disponibilitatea|Verificare disponibilitate/).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500); }

async function newInboundAndHold() {
  const { page } = await authenticated('seller');
  const stamp = Date.now().toString(36); const company = `SIM-OOH-UI ${phase} Atelierul Urban ${stamp}`;
  const periodStart = required('periodStart'); const periodEnd = required('periodEnd'); const code = required('availableLocationCode');
  await goto(page, '/admin/crm', 'Open CRM bookmarked workspace'); await settle(page);
  await click(page.getByRole('button', { name: 'Inbound', exact: true }), 'New inbound request'); surface('CRM inbound dialog');
  const dialog = page.getByRole('dialog', { name: 'Oportunitate inbound', exact: true });
  await fill(dialog.getByLabel('Firmă *', { exact: true }), company, 'client_name');
  await fill(dialog.getByLabel('CUI *', { exact: true }), `SIMUI${stamp.toUpperCase()}`, 'client_tax_id');
  await fill(dialog.getByLabel('Persoană de contact *', { exact: true }), 'SIM-OOH Irina Ionescu', 'contact_name');
  await fill(dialog.getByLabel('Email', { exact: true }), `sim-${stamp}@example.invalid`, 'contact_email');
  await fill(dialog.getByLabel('Oportunitate', { exact: true }), company + ' campanie de iarnă', 'campaign_name');
  await fill(dialog.getByLabel('Nevoie concretă *', { exact: true }), `Campanie OOH București, public familii urbane, buget 4500 EUR pentru ${periodStart}–${periodEnd}; producția și montajul se verifică separat.`, 'sales_brief');
  await fill(dialog.getByLabel('Geografie', { exact: true }), 'București — Băneasa / nord', 'geography');
  await fill(dialog.getByLabel('Formate', { exact: true }), 'Panou, mesh', 'formats');
  await capture(page, 'inbound-long-brief', [1440, 390]);
  await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'create_inbound', () => click(dialog.getByRole('button', { name: 'Creează', exact: true }), 'Create inbound opportunity'));
  await click(page.getByRole('button', { name: 'Toate', exact: true }), 'View all CRM records');
  await fill(page.getByLabel('Căutare CRM', { exact: true }), company, 'client_name', true); await page.waitForTimeout(700);
  await click(page.getByRole('button').filter({ hasText: company }).first(), 'Open new CRM opportunity'); surface('CRM opportunity dossier');
  const dossier = page.getByRole('dialog', { name: 'Dosar CRM', exact: true });
  await dossier.getByRole('heading', { name: 'Pregătește oferta', exact: true }).waitFor();
  await select(dossier.getByLabel(/^Moneda propunerii/), input.currency || 'EUR', 'Select explicit proposal currency');
  await select(dossier.getByLabel(/^Firma contractantă/), input.companyEntity || 'Focus Media', 'Select contracting company');
  await click(dossier.getByRole('button', { name: 'Continuă în ofertă', exact: true }), 'Prepare client and campaign without winning');
  await page.waitForURL('**/admin/commercial-quotes?**'); await settle(page);
  const clientId = await page.getByLabel('Client', { exact: true }).inputValue();
  const campaignId = await page.getByLabel('Campanie și monedă', { exact: true }).inputValue();
  assert.ok(clientId && campaignId); report.observed_created = { company, taxId: `SIMUI${stamp.toUpperCase()}`, clientId, campaignId, locationCode: code, periodStart, periodEnd, currency: input.currency || 'EUR', companyEntity: input.companyEntity || 'Focus Media' };
  await fill(page.getByLabel('Prima zi inclusă', { exact: true }), periodStart, 'period_start');
  await fill(page.getByLabel('Ultima zi inclusă', { exact: true }), periodEnd, 'period_end');
  const discovery = page.getByRole('button', { name: 'Deschide selecția pe hartă', exact: true });
  if (await discovery.isDisabled()) { observe('First inventory discovery is blocked by an empty selection', { valid_period_entered: true, selected_locations: 0, map_discovery_disabled: true }, 'A seller can start discovery from an empty offer without first selecting a location in another control.'); const blocked = new Error('APPLICATION_BLOCKER_EMPTY_SELECTION_PREVENTS_INVENTORY_DISCOVERY'); throw blocked; }
  await click(discovery, 'Find inventory from the offer');
  await page.waitForURL('**/admin/selectie-locatii?**'); await settle(page); await waitAvailability(page);
  await fill(page.getByLabel('Cauta cod, nume sau adresa', { exact: true }), code, 'location_search', true);
  await page.waitForTimeout(400);
  await click(page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: 'Adauga', exact: true }), 'Add available requested face');
  await click(page.getByRole('button', { name: 'Creează oferta cu aceste locații', exact: true }), 'Carry selection back to real offer');
  await page.waitForURL('**/admin/commercial-quotes?**'); await settle(page); await waitAvailability(page);
  assert.equal(await page.getByLabel('Client', { exact: true }).inputValue(), clientId);
  assert.equal(await page.getByLabel('Campanie și monedă', { exact: true }).inputValue(), campaignId);
  assert.equal(await page.getByLabel('Prima zi inclusă', { exact: true }).inputValue(), periodStart);
  const rate = page.getByLabel('Tarif lunar propus ' + code, { exact: true });
  const listRate = Number(await rate.inputValue()); const negotiated = (listRate * 0.9).toFixed(2);
  await fill(rate, negotiated, 'negotiated_monthly_rate');
  await fill(page.getByLabel('Justificare negociere ' + code, { exact: true }), 'SIM-OOH pachet multianual fictiv; discount supus aprobării.', 'negotiation_reason');
  await fill(page.getByLabel('Condiții și observații pentru revizuire', { exact: true }), 'SIM-OOH ofertă fictivă. Public țintă familii urbane; producția și montajul necesită cost verificat. Nu reprezintă contract.', 'offer_assumptions');
  const created = await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'quote.create', () => click(page.getByRole('button', { name: 'Salvează ciorna ofertei', exact: true }), 'Save first immutable proposal'));
  const quoteId = created?.result?.quote?.id || new URL(page.url()).searchParams.get('quoteId'); assert.ok(quoteId); report.observed_created.quoteId = quoteId; report.observed_created.vatRateBps = created?.result?.revision?.payload?.vatRateBps; report.observed_created.vatTreatment = created?.result?.revision?.payload?.vatTreatment; report.observed_created.campaignName = company + ' campanie de iarnă'; report.observed_created.listRate = listRate; report.observed_created.negotiatedRate = negotiated; report.observed_created.quoteTotals = { net: created?.result?.revision?.totalNet, tax: created?.result?.revision?.totalTax, gross: created?.result?.revision?.totalGross };
  observe('CRM and selection context transfers', { client_preserved: true, campaign_preserved: true, period_preserved: true, negotiated_rate: negotiated, catalog_rate: listRate }, 'Identity, period and per-face price retained without reentry.');
  await capture(page, 'first-negotiated-offer', [1440, 390]);
  const terms = page.getByRole('link', { name: 'termenii de plată și facturare ai campaniei', exact: true });
  if (await terms.count()) {
    observe('Preparation requires a separate trip to commercial terms', 'The newly prepared campaign has no payment or billing terms; offer can be saved but approval/HOLD is disabled and requires another campaign screen plus a new quote revision.', 'Commercial preparation should collect necessary terms in context or provide a single guided return with preserved offer state.');
    await click(terms, 'Complete missing campaign payment and billing terms'); await settle(page);
    await click(page.getByRole('button', { name: 'Editeaza', exact: true }), 'Edit commercial campaign dossier'); surface('Campaign commercial editor');
    const editor = page.getByRole('dialog');
    await select(editor.getByLabel(/^Termen de plată verificat/), '30_days', 'Set verified 30-day payment term');
    await select(editor.getByLabel(/^Facturare/), 'monthly_in_advance', 'Set agreed billing rule');
    await select(editor.getByLabel(/^Frecvența facturării/), 'monthly', 'Set monthly invoice frequency');
    await responseAfter(page, r => r.request().method() === 'PATCH', () => click(editor.getByRole('button', { name: 'Salveaza', exact: true }), 'Save campaign terms'));
    await goto(page, '/admin/commercial-quotes?quoteId=' + encodeURIComponent(quoteId), 'Return to immutable offer after campaign term correction'); await settle(page);
    await click(page.getByRole('button', { name: 'Pregătește o versiune nouă', exact: true }), 'Refresh proposal version against completed terms');
    await waitAvailability(page);
    await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'quote.create', () => click(page.getByRole('button', { name: 'Salvează versiunea nouă', exact: true }), 'Save quote with complete verified terms'));
  }
  const expiry = new Date(Date.now() + 2 * 86400000); const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'approval.request', () => click(page.getByRole('button', { name: 'Cere aprobarea expedierii', exact: true }), 'Request human approval of exact proposal'));
  await fill(page.getByLabel('Expirare HOLD propusă, maximum 5 zile', { exact: true }), localExpiry, 'hold_expiry');
  await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'approval.request', () => click(page.getByRole('button', { name: 'Cere aprobare HOLD', exact: true }), 'Request temporary inventory hold'));
  const { page: manager } = await authenticated('manager');
  await goto(manager, '/admin/commercial-quotes?quoteId=' + encodeURIComponent(quoteId), 'Manager opens exact offer and pending approvals'); await settle(manager);
  for (const name of ['Expediere ofertă', 'Creare HOLD']) {
    const approval = manager.locator('article').filter({ hasText: name }).filter({ has: manager.getByRole('button', { name: 'Aprob exact această versiune', exact: true }) }).first();
    await responseAfter(manager, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'approval.decide', () => click(approval.getByRole('button', { name: 'Aprob exact această versiune', exact: true }), 'Manager approves ' + name));
  }
  const held = await responseAfter(manager, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'hold.execute', () => click(manager.getByRole('button', { name: 'Execută HOLD aprobat', exact: true }), 'Manager executes authorized hold'));
  report.observed_created.reservationIds = held?.result?.result?.reservationIds || held?.result?.reservationIds || [];
  report.observed_created.quoteRevisionId = held?.result?.result?.quoteRevisionId || null;
  assert.ok(report.observed_created.reservationIds.length, 'Approved hold UI response must expose its created synthetic reservation IDs for handoff verification.');
  await capture(manager, 'human-approved-hold', [1440, 390]);
  observe('Human approved temporary reservation', 'The offer was prepared, exact version approved and HOLD executed entirely through the UI. External delivery is disabled.', 'One approved hold; no email, fiscal invoice or automatic sale.');
}

async function partialAvailability() {
  const { page } = await authenticated('seller'); const code = required('partialLocationCode');
  await goto(page, '/admin/selectie-locatii', 'Review requested multi-month availability'); await settle(page);
  await fill(page.getByLabel('Start campanie', { exact: true }), required('partialPeriodStart') || required('periodStart'), 'period_start');
  await fill(page.getByLabel('Final campanie', { exact: true }), required('partialPeriodEnd') || required('periodEnd'), 'period_end');
  await select(page.getByLabel(/^Disponibilitate/), 'ALL', 'Include partial and incompatible inventory');
  await fill(page.getByLabel('Cauta cod, nume sau adresa', { exact: true }), code, 'location_search', true); await waitAvailability(page); await page.waitForTimeout(400);
  const row = page.getByRole('row').filter({ hasText: code }); await row.waitFor();
  const text = await row.innerText(); observe('Partial availability explanation', text, 'Exact unavailable and available windows visible in context; alternatives can be selected without discarding the brief.');
  await capture(page, 'partial-availability', [1440, 1024, 768, 390]);
  const add = row.getByRole('button', { name: 'Adauga', exact: true });
  if (await add.count() && await add.isEnabled()) {
    await click(add, 'Add partially available candidate for evaluation');
    const transfer = page.getByRole('button', { name: 'Creează oferta cu aceste locații', exact: true });
    observe('Partial candidate continuation', { button_disabled: await transfer.isDisabled(), basket_text: (await page.locator('body').innerText()).slice(-6500) }, 'Partial inventory should offer an explicit date adjustment/split or clearly prevent an incompatible whole-period proposal.');
  }
}

async function revisionRoundTrip() {
  const quoteId = report.observed_created.quoteId || input.revisionQuoteId;
  if (!quoteId) { const error = new Error('No saved quote is available for revision; main scenario stopped before quote creation.'); error.unsupported = true; throw error; }
  const { page } = await authenticated('seller');
  const heldReservationId = report.observed_created.reservationIds?.[0] || input.revisionReservationId;
  if (heldReservationId) {
    const verified = await browserGet(page, base + '/api/reservations/' + encodeURIComponent(heldReservationId));
    assert.equal(verified.status, 200, 'The authenticated owner cannot read the existing HOLD used by this regression.');
    const body = verified.payload; const held = body.reservation;
    if (held?.status !== 'HOLD' || !held.holdExpiresAt || Date.parse(held.holdExpiresAt) <= Date.now()) {
      const error = new Error('REGRESSION_PRECONDITION_REQUIRES_ACTIVE_OWN_HOLD_NOT_BOOKED_OR_EXPIRED'); error.unsupported = true; throw error;
    }
    const expectedClient = report.observed_created.clientId || input.revisionClientId;
    const expectedCampaign = report.observed_created.campaignId || input.revisionCampaignId;
    if (expectedClient) assert.equal(held.clientId, expectedClient);
    if (expectedCampaign) assert.equal(held.campaignId, expectedCampaign);
    observe('Fresh active own HOLD is verified before the revision', { verification_method: 'Authenticated read-only GET precondition; not a user UI action or write shortcut.', reservationId: held.id, status: held.status, expires_at: held.holdExpiresAt, clientId: held.clientId, campaignId: held.campaignId, locationId: held.locationId }, 'Exercise an active own temporary hold. A BOOKED rental must keep its stronger commercial conflict rules.');
  }
  await goto(page, '/admin/commercial-quotes?quoteId=' + encodeURIComponent(quoteId), 'Open prior proposal for client-requested changes'); await settle(page);
  await click(page.getByRole('button', { name: 'Pregătește o versiune nouă', exact: true }), 'Create client-requested proposal revision');
  const code = required('availableLocationCode');
  const proposed = page.getByLabel('Tarif lunar propus ' + code, { exact: true }); await proposed.waitFor();
  const oldRate = await proposed.inputValue(); const changed = (Number(oldRate) + 7.5).toFixed(2);
  await fill(proposed, changed, 'negotiated_monthly_rate');
  await fill(page.getByLabel('Justificare negociere ' + code, { exact: true }), 'SIM-OOH revizuire negociere după schimbarea brief-ului.', 'negotiation_reason');
  const notes = 'SIM-OOH termen revizuit păstrat după revenirea de pe hartă.';
  await fill(page.getByLabel('Condiții și observații pentru revizuire', { exact: true }), notes, 'offer_assumptions');
  await click(page.getByRole('button', { name: 'Deschide selecția pe hartă', exact: true }), 'Inspect alternatives on the map');
  await page.waitForURL('**/admin/selectie-locatii?**'); await settle(page); await waitAvailability(page);
  await capture(page, 'revision-map', [1440]);
  const returnFromMap = page.getByRole('button', { name: 'Creează oferta cu aceste locații', exact: true });
  if (await returnFromMap.isDisabled()) {
    observe('An existing rental blocks a map-only revision return', { return_disabled: true, selected_location: code, context: (await page.locator('body').innerText()).slice(-7000) }, 'Returning an unsaved revision may retain explicit conflicts while final quote creation still revalidates availability; it must not discard the negotiated draft or silently ignore a reservation.');
    throw new Error('APPLICATION_BLOCKER_REVISION_MAP_RETURN_PREVENTED_BY_EXISTING_RESERVATION');
  }
  await click(returnFromMap, 'Return from map preserving revised commercial proposal');
  await page.waitForURL('**/admin/commercial-quotes?**'); await settle(page); await waitAvailability(page);
  assert.equal(await proposed.inputValue(), changed); assert.equal(await page.getByLabel('Condiții și observații pentru revizuire', { exact: true }).inputValue(), notes);
  observe('Unsaved revision survives map inspection', { proposed_monthly_rate: changed, assumptions_preserved: true, quote_identity_preserved: new URL(page.url()).searchParams.get('quoteId') === quoteId }, 'No repeated entry of negotiated rate, recipient, campaign or observations.');
  const save = page.getByRole('button', { name: 'Salvează versiunea nouă', exact: true });
  if (await save.isDisabled()) observe('Revision after HOLD requires availability resolution', (await page.getByRole('alert').allInnerTexts()), 'Existing own HOLD should have an explicit controlled amendment path; do not silently overbook or drop approval requirements.');
  else {
    const revised = await responseAfter(page, r => r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'quote.create', () => click(save, 'Save revised proposal'));
    const revision = revised?.result?.revision;
    report.revision_result = { quoteId, latestRevision: revised?.result?.quote?.latestRevision, quoteRevisionId: revision?.id, periodStart: revision?.payload?.periodStart, periodEnd: revision?.payload?.periodEnd, locationIds: revision?.payload?.lines?.map(line => line.locationId), ownerAccountAlias: 'sellerA', negotiatedMonthlyRate: changed };
    if (heldReservationId) {
      const rentalsResponse = await browserGet(page, base + '/api/reservations?view=workspace');
      assert.equal(rentalsResponse.status, 200);
      const rentals = rentalsResponse.payload;
      const sameCampaign = (rentals.reservations || []).filter(row => row.campaignId === (report.observed_created.campaignId || input.revisionCampaignId));
      assert.equal(sameCampaign.length, 1, 'A map-only proposal revision changed the number of this campaign\'s rentals.');
      assert.equal(sameCampaign[0].id, heldReservationId); assert.equal(sameCampaign[0].status, 'HOLD');
      if (report.observed_created.negotiatedRate) assert.equal(Number(sameCampaign[0].monthlyRentShare ?? sameCampaign[0].amount), Number(report.observed_created.negotiatedRate), 'Preparing a revised proposal implicitly applied its unapproved price to the existing HOLD.');
      report.revision_result.retainedHoldId = heldReservationId;
      report.revision_result.retainedHoldMonthlyRate = sameCampaign[0].monthlyRentShare ?? sameCampaign[0].amount;
      report.revision_result.campaignRentalCount = sameCampaign.length;
    }
    observe('Revised own-HOLD proposal persists without creating a second reservation', report.revision_result, 'The new exact version keeps the temporary hold context and still requires its own explicit approval before applying changed commercial terms.');
  }
  await capture(page, 'revised-proposal', [1440, 390]);
}

async function agencyDossier() {
  const { page } = await authenticated('seller');
  await goto(page, '/admin/campanii?campaignId=' + encodeURIComponent(required('agencyCampaignId')), 'Open agency campaign dossier'); await settle(page);
  await capture(page, 'agency-campaign', [1440, 390]);
  const body = await page.locator('body').innerText();
  await click(page.getByRole('button', { name: 'Editeaza', exact: true }), 'Inspect agency and final client commercial setup'); surface('Agency campaign editor');
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  const labels = await dialog.locator('label').allInnerTexts();
  if (!phase.startsWith('baseline')) assert.ok(labels.some(x => /Tip relație comercială/.test(x)) && labels.filter(x => /Agenție intermediară|Beneficiar final/.test(x)).length >= 2, 'Structured agency and beneficiary controls are missing after remediation.');
  observe('Agency / beneficiary / contracting parties', { dossier_mentions_agency: /agenție|agentie/i.test(body), editor_labels: labels, commission_or_rebate_fields: labels.filter(x => /comision|rebate|rabat/i.test(x)), agency_fields: labels.filter(x => /agenție|agentie|beneficiar|client final/i.test(x)) }, 'The invoiced/contracting client, agency and beneficiary should remain distinct, with approved commercial rules rather than an invented commission.');
  await capture(page, 'agency-campaign-editor', [1440, 390]);
  await page.keyboard.press('Escape');
}

async function renewalHistory() {
  const { page } = await authenticated('seller'); const id = required('renewalCampaignId');
  await goto(page, '/admin/campanii?campaignId=' + encodeURIComponent(id), 'Open expiring client campaign for renewal'); await settle(page);
  const overview = await page.locator('body').innerText();
  await click(page.getByRole('tab', { name: 'Locatii inchiriate', exact: true }), 'Find booked faces and past commercial prices'); await settle(page);
  const rentals = await page.locator('body').innerText();
  observe('Renewal price-history discoverability', { commercial_overview_excerpt: overview.slice(-5500), rented_faces_excerpt: rentals.slice(-6500), amendment_or_history_controls: await page.getByRole('button', { name: /istoric|act adi|prelung|amend|istor/i }).allTextContents() }, 'Seller sees prior campaign and exact effective price periods, then can prepare a non-overlapping renewal without copying the entire client record.');
  await capture(page, 'renewal-history', [1440, 390]);
}

async function inventoryDiscovery() {
  const { page } = await authenticated('seller'); await goto(page, '/admin/selectie-locatii', 'Find suitable locations for a geographic and budget brief'); await settle(page);
  const labels = await page.locator('label').allInnerTexts();
  observe('Available search criteria', { labels, city: await page.getByLabel(/oraș|oras|localitate/i).count(), area: await page.getByLabel(/zonă|zona/i).count(), budget: await page.getByLabel(/buget|preț maxim|pret maxim|tarif maxim/i).count(), size: await page.getByLabel(/suprafa|dimensi/i).count(), target_audience: await page.getByLabel(/public.țint|audien/i).count() }, 'Location discovery supports geographic, format, period, price and dimensions criteria; audience requires verified structured evidence.');
  if (input.inventoryBeyondFirstPageCode) {
    await fill(page.getByLabel('Cauta cod, nume sau adresa', { exact: true }), input.inventoryBeyondFirstPageCode, 'location_search', true); await page.waitForTimeout(500);
    observe('Inventory outside initial load', { requested_code: input.inventoryBeyondFirstPageCode, visible: await page.getByRole('row').filter({ hasText: input.inventoryBeyondFirstPageCode }).count() > 0 }, 'An eligible location remains discoverable regardless of its position in the full catalog.');
  }
  await capture(page, 'inventory-criteria', [1440, 1024, 768, 390]);
}

async function operationsDossier() {
  const { page } = await authenticated('seller');
  await goto(page, '/admin/campanii?campaignId=' + encodeURIComponent(required('opsSegmentedCampaignId')), 'Review a rental with a documented January/February price amendment'); await settle(page);
  const dossierText = await page.locator('body').innerText();
  if (!phase.startsWith('baseline')) assert.ok((dossierText.match(/\b250 EUR\b/g) || []).length >= 2 && !/\b300 EUR\b/.test(dossierText), 'Segmented campaign list and detail are not both250EUR.');
  observe('Effective price history summary', { expected_contract_total: manifest.scenarios?.opsSegmentedExpectedContractTotal, dossier_text: dossierText.slice(-7000) }, 'January 100 EUR plus February 150 EUR totals 250 EUR in both campaign list and detail, rather than applying the latest header price to the entire history.');
  await capture(page, 'segmented-campaign-list-detail', [1440, 390]);
  await goto(page, '/admin/campanii?campaignId=' + encodeURIComponent(required('opsCostCampaignId')), 'Review a new redecoration before the cost is known'); await settle(page);
  await click(page.getByRole('tab', { name: 'Locatii inchiriate', exact: true }), 'Open operational actions on contracted faces'); await settle(page);
  await click(page.getByRole('button', { name: 'Redecorare', exact: true }).first(), 'Prepare redecoration cost and brief'); surface('Redecoration task preparation');
  const dialog = page.getByRole('dialog');
  observe('Unknown redecoration cost fields', { labels: await dialog.locator('label').allInnerTexts(), cost_input_value: await dialog.getByLabel(/Cost estimat/).inputValue() }, 'An unknown cost remains explicitly unknown and its currency is selected deliberately; a blank input must not turn into a confirmed zero-RON task.');
  await capture(page, 'redecoration-unknown-cost', [1440, 390]);
  await page.keyboard.press('Escape');
}

async function guidedPlanning() {
  const { page } = await authenticated('seller');
  await goto(page, '/admin/selectie-locatii', 'Plan a location package from a real geographic and price brief'); await settle(page);
  if (!(await page.getByLabel(/^Oraș/).count())) { const error = new Error('Guided geographic and budget filters are unavailable in this application revision.'); error.unsupported = true; throw error; }
  await click(page.getByRole('button', { name: 'Resetează filtrele', exact: true }), 'Reset previous discovery filters'); await waitInventory(page);
  await fill(page.getByLabel('Start campanie', { exact: true }), required('periodStart'), 'period_start');
  await fill(page.getByLabel('Final campanie', { exact: true }), required('periodEnd'), 'period_end');
  await select(page.getByLabel(/^Disponibilitate/), 'AVAILABLE', 'Only offer faces available for the whole requested period'); await waitAvailability(page);
  await select(page.getByLabel(/^Oraș/), 'Bucuresti', 'Choose requested city Bucuresti'); await waitInventory(page);
  const area = page.getByLabel(/^Zonă/); const areaOptions = await area.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
  const targetArea = areaOptions.find(option => /Bucuresti suport 1/.test(option.text || ''));
  if (targetArea) { await select(area, targetArea.value, 'Choose inventory zone from the requested city'); await waitInventory(page); }
  const formatDetails = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Format/ }) }).first();
  await click(formatDetails.locator('summary'), 'Choose physical display format');
  await act('checks', 'Choose Panou format', () => formatDetails.getByRole('checkbox', { name: 'Panou', exact: true }).check());
  await click(formatDetails.locator('summary'), 'Close format options'); await waitInventory(page);
  await fill(page.getByLabel(/^Tarif lunar maxim/), '500', 'monthly_list_price_ceiling'); await waitInventory(page);
  await click(page.getByText('Dimensiuni și filtre suplimentare', { exact: true }), 'Inspect size constraints');
  await fill(page.getByLabel('Suprafață minimă (mp)', { exact: true }), '12', 'minimum_surface');
  await fill(page.getByLabel('Suprafață maximă (mp)', { exact: true }), '12', 'maximum_surface'); await waitInventory(page);
  const rows = page.getByRole('row').filter({ hasText: 'SIM-OOH-BUC-' });
  const descriptions = await rows.allInnerTexts(); assert.ok(descriptions.length > 0, 'Combined valid planning criteria lost all eligible Bucuresti faces.');
  assert.ok(descriptions.every(text => /Bucuresti/.test(text) && /Panou/.test(text) && /12 mp/.test(text)), 'Combined city/format/surface criteria returned another format or city.');
  observe('Combined criteria discover the actual faces', { city: 'Bucuresti', area: targetArea?.text || null, format: 'Panou', monthly_ceiling: '500 EUR per face', surface: '12 sqm', matching_rows: descriptions.length, rows: descriptions }, 'All visible results satisfy the combined criteria; monthly face tariff is not confused with total campaign budget or production cost.');
  await capture(page, 'guided-bucuresti-package', [1440, 1024, 768, 390]);
  await click(page.getByRole('button', { name: 'Resetează filtrele', exact: true }), 'Start partial availability alternative search'); await waitInventory(page);
  await fill(page.getByLabel('Start campanie', { exact: true }), required('partialPeriodStart'), 'partial_period_start');
  await fill(page.getByLabel('Final campanie', { exact: true }), required('partialPeriodEnd'), 'partial_period_end');
  await select(page.getByLabel(/^Disponibilitate/), 'ALL', 'Inspect partial candidate alongside unavailable faces');
  const code = required('partialLocationCode');
  await fill(page.getByLabel('Cauta cod, nume sau adresa', { exact: true }), code, 'partial_location_search', true); await waitInventory(page); await waitAvailability(page);
  const details = page.getByRole('row').filter({ hasText: code }).locator('details');
  await click(details.locator('summary'), 'Read full blocked and free date windows');
  const button = details.getByRole('button', { name: new RegExp('^Folosește intervalul ' + code) }).first();
  const original = { from: await page.getByLabel('Start campanie', { exact: true }).inputValue(), to: await page.getByLabel('Final campanie', { exact: true }).inputValue() };
  const dismissed = new Promise(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve(dialog.message()); }));
  await click(button, 'Evaluate suggested free date window'); const cancelPrompt = await dismissed;
  assert.equal(await page.getByLabel('Start campanie', { exact: true }).inputValue(), original.from); assert.equal(await page.getByLabel('Final campanie', { exact: true }).inputValue(), original.to);
  const accepted = new Promise(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(dialog.message()); }));
  await click(button, 'Explicitly accept a common period change'); const acceptedPrompt = await accepted; await waitAvailability(page); await waitInventory(page);
  const changed = { from: await page.getByLabel('Start campanie', { exact: true }).inputValue(), to: await page.getByLabel('Final campanie', { exact: true }).inputValue() };
  assert.equal(changed.from, day(0)); assert.equal(changed.to, day(34));
  observe('Guided partial period change is explicit and reversible before confirmation', { cancelled_prompt: cancelPrompt, accepted_prompt: acceptedPrompt, original, changed, cancelled_change_left_dates_untouched: true }, 'Dismiss preserves the entire selection period; accept changes it explicitly and revalidates every selected face.');
  await capture(page, 'guided-partial-free-window', [1440, 390]);
}

async function visualMatrix() {
  const { page } = await authenticated('seller');
  for (const [name, route] of [['seller-agenda','/admin/dashboard'], ['crm-many-records','/admin/crm?view=all'], ['selector-many-faces','/admin/selectie-locatii'], ['campaigns-many-records','/admin/campanii'], ['offers-history','/admin/commercial-quotes'], ['onboarding','/admin/onboarding']]) {
    await goto(page, route, 'Inspect ' + name); await settle(page); await capture(page, name, [1440, 1024, 768, 390]);
  }
  const { page: manager } = await authenticated('manager');
  for (const [name, route] of [['management-control','/admin/control-contractual'], ['financial-receivables','/admin/financiar/incasari'], ['operational-work','/admin/operational']]) {
    await goto(manager, route, 'Inspect ' + name); await settle(manager); await capture(manager, name, [1440, 1024, 768, 390]);
  }
  observe('Measured layout results', { captures: report.captures.length, outer_overflow_captures: report.captures.filter(x => x.outer_overflow_px > 1).map(x => ({ name: x.name, width: x.width, overflow_px: x.outer_overflow_px, path: x.path })), local_horizontal_scroll_regions: report.captures.filter(x => x.scroll_regions.length).map(x => ({ name: x.name, width: x.width, regions: x.scroll_regions.length })) }, 'No outer viewport overflow; necessary table scrolling is visible and actions remain reachable. Screenshots need human/agent visual inspection.');
}

async function runJobs(jobs) {
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || createBrowserRuntime(9294).findChrome(), headless: true, args: ['--no-sandbox'] });
    const selected = arg('--scenario', 'all');
    for (const [id, fn] of jobs) if (selected === 'all' || selected.split(',').includes(id)) await scenario(id, fn);
    report.completed_at = new Date().toISOString(); report.summary = { completed: report.scenarios.filter(x=>x.status==='completed').length, blocked: report.scenarios.filter(x=>x.status==='blocked').length, unsupported: report.scenarios.filter(x=>x.status==='unsupported').length, screenshots: report.captures.length, outer_overflow_captures: report.captures.filter(x=>x.outer_overflow_px>1).length, page_errors: report.page_errors.length, console_errors: report.console_errors.length, external_requests_blocked: report.isolation.external_attempts.length }; persist();
    console.log(JSON.stringify({ report: path.join(root, `browser-${phase}.json`), ...report.summary }, null, 2));
    return report;
  } catch (error) { report.fatal = error.message; persist(); throw error; }
  finally { if (browser) await browser.close(); }
}
module.exports = { root, base, phase, arg, manifest, input, report, authenticated, act, click, fill, select, goto, surface, settle, capture, observe, scenario, required, responseAfter, waitAvailability, waitInventory, runJobs, day, persist };
if (require.main === module) runJobs([['SIM-UI-08',operationsDossier],['SIM-UI-09',guidedPlanning],['SIM-UI-01',newInboundAndHold],['SIM-UI-02',partialAvailability],['SIM-UI-03',revisionRoundTrip],['SIM-UI-04',agencyDossier],['SIM-UI-05',renewalHistory],['SIM-UI-06',inventoryDiscovery],['SIM-UI-07',visualMatrix]]).catch(error => { console.error(error.message); process.exitCode = 1; });
