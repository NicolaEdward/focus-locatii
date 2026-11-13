#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');
const { createBrowserRuntime } = require('../release/browser-runtime.cjs');

const root = '/workspace/work/ooh-simulation';
const base = 'http://127.0.0.1:3041';
const phase = process.argv[process.argv.indexOf('--phase') + 1];
if (!['before', 'after'].includes(phase) || process.env.OOH_SIMULATION !== 'true' || process.env.OOH_SIMULATION_DATASET_ID !== 'focus-ooh-real-company-v1' || process.env.APP_ENV !== 'preview') throw new Error('ISOLATED_RESERVATION_EDIT_PHASE_REQUIRED');
const accounts = JSON.parse(fs.readFileSync(path.join(root, 'accounts.private.json'), 'utf8'));
assert.ok(accounts.users.coo.email.endsWith('@example.invalid'));
const blankHoldFixture = process.argv.includes('--blank-hold-fixture');
const blankFixture = blankHoldFixture || process.argv.includes('--blank-fixture');
const fixtureStatus = blankHoldFixture ? 'HOLD' : 'BOOKED';
const id = blankFixture ? 'sim-ooh-edit-state-blank-' + fixtureStatus.toLowerCase() : 'sim-ooh-reservation-001';
const suffix = blankFixture ? '-blank-' + fixtureStatus.toLowerCase() : '';
const prisma = new PrismaClient({ log: [] });
const screenshots = path.join(root, 'screenshots', 'reservation-edit-state-' + phase + suffix);
fs.mkdirSync(screenshots, { recursive: true });
const report = { phase, reservation_id: id, cases: [], external_attempts_blocked: [], method: 'Actual UI login; rapid sequential Playwright fills, viewport changes and slow keyboard entry; actual PATCH request/response plus persisted synthetic row. No commercial amounts, rental period or status changed.' };
const select = { id: true, status: true, locationId: true, clientName: true, contractNumber: true, installationDate: true, productionNotes: true, notes: true, updatedAt: true, periodStart: true, periodEnd: true, clientId: true, campaignId: true, contractGroupId: true, amount: true, currency: true };

(async () => {
 if (blankFixture && !await prisma.reservation.findUnique({ where: { id }, select: { id: true } })) {
  const template = await prisma.reservation.findUniqueOrThrow({ where: { id: 'sim-ooh-reservation-001' } });
  const locationId = blankHoldFixture ? 'sim-ooh-location-118' : 'sim-ooh-location-119';
  assert.equal(await prisma.reservation.count({ where: { locationId } }), 0, 'A dedicated empty-metadata fixture must use an unused synthetic face.');
  const { createdAt, updatedAt, ...data } = template;
  await prisma.reservation.create({ data: { ...data, id, locationId, status: fixtureStatus, bookedAt: blankHoldFixture ? null : data.bookedAt, holdExpiresAt: blankHoldFixture ? new Date(Date.now() + 86400000) : null, contractGroupId: null, contractNumber: null, installationDate: null, productionNotes: null, notes: 'SIM-OOH dedicated empty-metadata editor test. No real contract or performed work.', externalId: 'SIM-OOH-EDIT-STATE-BLANK-' + fixtureStatus, externalSource: 'focus-ooh-real-company-v1' } });
  report.dedicated_fixture_created = true;
 }
 const initial = await prisma.reservation.findUniqueOrThrow({ where: { id }, select });
 assert.equal(initial.status, fixtureStatus);
 assert.ok(initial.clientId?.startsWith('sim-ooh-') && initial.campaignId?.startsWith('sim-ooh-'));
 const affected = initial.contractGroupId ? await prisma.reservation.count({ where: { contractGroupId: initial.contractGroupId } }) : 1;
 assert.equal(affected, 1, 'Focused investigation must affect exactly one claimed synthetic rental.');
 report.initial = initial;
 const location = await prisma.location.findUniqueOrThrow({ where: { id: initial.locationId }, select: { code: true } });
 const browser = await chromium.launch({ executablePath: createBrowserRuntime(9299).findChrome(), headless: true, args: ['--no-sandbox'] });
 let activePage;
 try {
  const context = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Bucharest', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external_attempts_blocked.push(url.origin); return route.abort(); });
  const page = await context.newPage();
  activePage = page;
  report.page_errors = [];
  page.on('pageerror', error => report.page_errors.push(error.message));
  await page.goto(base + '/admin/login');
  await page.getByLabel('Email', { exact: true }).fill(accounts.users.coo.email);
  await page.getByLabel('Parola', { exact: true }).fill(accounts.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(url => url.pathname !== '/admin/login');

  for (const [index, mode] of (blankFixture ? ['rapid'] : ['rapid', 'rapid', 'rapid-with-resize', 'slow-keyboard']).entries()) {
   await page.goto(base + '/admin/locatii?reservationId=' + encodeURIComponent(id));
   const workspace = page.getByRole('dialog', { name: 'Gestionare rezervari', exact: true });
   const existing = await prisma.reservation.findUniqueOrThrow({ where: { id }, select: { contractNumber: true, updatedAt: true } });
   const locationRows = workspace.getByRole('row').filter({ has: page.getByText(location.code, { exact: true }) });
   const targetedRow = existing.contractNumber ? locationRows.filter({ has: page.getByText('Contract ' + existing.contractNumber, { exact: true }) }) : locationRows;
   const editButton = targetedRow.getByRole('button', { name: 'Editeaza', exact: true }).first();
   await editButton.waitFor();
   await editButton.click();
   const editor = page.getByRole('dialog').filter({ has: page.getByLabel('Numar contract / IO', { exact: true }) }).last();
   await editor.getByLabel('Numar contract / IO', { exact: true }).waitFor();
   const reference = `SIM-OOH-EDIT-${phase}-${mode}-${index}-${Date.now().toString(36)}`;
   const brief = `SIM-OOH focused ${mode} production brief ${index}; synthetic input preservation check.`;
   const expected = { contractNumber: reference, installationDate: new Date(initial.periodStart.getTime() + (index + 2) * 86400000).toISOString().slice(0, 10), cost: `${150 + index}.00`, currency: index % 2 ? 'RON' : 'EUR', brief };
   const item = { mode, expected, input_trace: [] };
   report.cases.push(item);
   await editor.evaluate(element => {
    window.__reservationEditTrace = [];
    const fields = () => [...element.querySelectorAll('input,textarea,select')].map(input => ({ label: input.closest('label')?.querySelector('span')?.textContent?.trim(), value: input.value }));
    element.addEventListener('input', event => { window.__reservationEditTrace.push({ event: 'input', label: event.target.closest('label')?.querySelector('span')?.textContent?.trim(), fields: fields() }); }, true);
    element.addEventListener('change', event => { window.__reservationEditTrace.push({ event: 'change', label: event.target.closest('label')?.querySelector('span')?.textContent?.trim(), fields: fields() }); }, true);
   });
   const referenceInput = editor.getByLabel('Numar contract / IO', { exact: true });
   if (mode === 'slow-keyboard') { await referenceInput.fill(''); await referenceInput.pressSequentially(reference, { delay: 35 }); await page.waitForTimeout(300); }
   else await referenceInput.fill(reference);
   await editor.getByLabel('Data montaj explicita', { exact: true }).fill(expected.installationDate);
   if (mode === 'slow-keyboard') await page.waitForTimeout(300);
   await editor.getByLabel('Cost montaj / decorare', { exact: true }).fill(expected.cost);
   if (mode === 'slow-keyboard') await page.waitForTimeout(300);
   await editor.getByLabel(/^Moneda(?! contract)/).selectOption(expected.currency);
   await editor.getByText('Note operationale / optional', { exact: true }).click();
   await editor.getByLabel(/^Ce trebuie montat/).fill(brief);
   if (mode === 'rapid-with-resize') { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(180); await page.setViewportSize({ width: 1440, height: 1000 }); }
   item.before_save = { contractNumber: await referenceInput.inputValue(), installationDate: await editor.getByLabel('Data montaj explicita', { exact: true }).inputValue(), cost: await editor.getByLabel('Cost montaj / decorare', { exact: true }).inputValue(), currency: await editor.getByLabel(/^Moneda(?! contract)/).inputValue(), brief: await editor.getByLabel(/^Ce trebuie montat/).inputValue() };
   item.input_trace = await page.evaluate(() => window.__reservationEditTrace);
   item.screenshot = path.relative(root, path.join(screenshots, `${index}-${mode}.png`));
   await page.screenshot({ path: path.join(root, item.screenshot), fullPage: true });
   const [response] = await Promise.all([page.waitForResponse(result => ['/api/reservations/' + id, '/api/reservations/' + id + '/group'].includes(new URL(result.url()).pathname) && result.request().method() === 'PATCH'), editor.getByRole('button', { name: 'Salveaza modificarile', exact: true }).click()]);
   item.patch_path = new URL(response.url()).pathname;
   item.patch = response.request().postDataJSON();
   item.status = response.status();
   const payload = await response.json();
   item.response = payload.reservation || payload.reservations?.find(row => row.id === id) || { error: payload.error };
   item.database = await prisma.reservation.findUniqueOrThrow({ where: { id }, select });
   item.all_fields_preserved = item.before_save.contractNumber === reference && item.before_save.installationDate === expected.installationDate && item.before_save.cost === expected.cost && item.before_save.currency === expected.currency && item.before_save.brief === brief && item.patch.contractNumber === reference && item.patch.installationDate === expected.installationDate && item.response.contractNumber === reference && item.database.contractNumber === reference && item.database.installationDate?.toISOString().slice(0, 10) === expected.installationDate && item.database.productionNotes?.includes(brief) && item.database.productionNotes?.includes(`"decorationCost":${150 + index}`) && item.database.productionNotes?.includes(`"decorationCurrency":"${expected.currency}"`);
   assert.equal(item.status, 200);
   assert.equal(item.database.status, initial.status);
   assert.equal(item.database.amount, initial.amount);
   assert.equal(item.database.currency, initial.currency);
   assert.equal(item.database.periodStart.toISOString(), initial.periodStart.toISOString());
   assert.equal(item.database.periodEnd.toISOString(), initial.periodEnd.toISOString());
   assert.ok(item.patch.expectedUpdatedAt || item.patch.expectedVersions?.[id], 'Optimistic concurrency evidence must remain present.');
   assert.equal(item.patch.expectedUpdatedAt || item.patch.expectedVersions[id], existing.updatedAt.toISOString());
   if (phase === 'after') assert.ok(item.all_fields_preserved, mode + ': all edited fields must survive UI, request and persistence.');
  }
  report.completed = true;
 } finally {
  if (!report.completed && activePage) {
   report.failed_dom_values = await activePage.locator('[role=dialog]').evaluateAll(dialogs => dialogs.map(dialog => [...dialog.querySelectorAll('input,textarea,select')].filter(input => input.type !== 'password').map(input => ({ label: input.closest('label')?.querySelector('span')?.textContent?.trim(), value: input.value })))).catch(() => []);
   if (report.cases.length) report.cases.at(-1).input_trace = await activePage.evaluate(() => window.__reservationEditTrace).catch(() => []);
   await activePage.screenshot({ path: path.join(screenshots, 'probe-failure.png'), fullPage: true }).catch(() => {});
  }
  await browser.close();
 }
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
 await prisma.$disconnect();
 fs.writeFileSync(path.join(root, 'reservation-edit-state-' + phase + suffix + '.json'), JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify({ phase, cases: report.cases.length, mismatches: report.cases.filter(item => !item.all_fields_preserved).length, external_attempts: report.external_attempts_blocked.length, completed: report.completed || false, error: report.error || null }));
});
