const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');
const { createBrowserRuntime } = require('../release/browser-runtime.cjs');
const root = '/workspace/work/ooh-simulation', base = 'http://127.0.0.1:3041';
const phase = process.argv[process.argv.indexOf('--phase') + 1];
if (!['baseline', 'after'].includes(phase) || process.env.OOH_SIMULATION !== 'true' || process.env.OOH_SIMULATION_DATASET_ID !== 'focus-ooh-real-company-v1' || process.env.APP_ENV !== 'preview') throw new Error('Isolated simulation phase required.');
const accounts = JSON.parse(fs.readFileSync(path.join(root, 'accounts.private.json'), 'utf8'));
assert.ok(accounts.users.sellerA.email.endsWith('@example.invalid'));
const dstOnly = process.argv.includes('--dst-only');
const report = { finding: 'SIM-CRM-003', phase, cases: [], timezone: 'Europe/Bucharest', external_attempts_blocked: [], expected_policy: 'Unzoned datetime-local is Bucharest wall time; nonexistent and ambiguous local times require correction or explicit offset; calendar-only dates remain calendar-only UTC values.', historical_timestamps_rewritten: false };
const screenshots = path.join(root, 'screenshots', 'crm-time-' + phase);
fs.mkdirSync(screenshots, { recursive: true });
const prisma = new PrismaClient({ log: [] });
(async () => {
 const browser = await chromium.launch({ executablePath: createBrowserRuntime(9298).findChrome(), headless: true, args: ['--no-sandbox'] });
 try {
  const existingActions = phase === 'after' ? await prisma.crmNextAction.findMany({ select: { id: true, dueAt: true }, orderBy: { id: 'asc' } }) : [];
  const context = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Bucharest' });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external_attempts_blocked.push(url.origin); return route.abort(); });
  const page = await context.newPage();
  await page.goto(base + '/admin/login'); await page.getByLabel('Email', { exact: true }).fill(accounts.users.sellerA.email); await page.getByLabel('Parola', { exact: true }).fill(accounts.password); await page.getByRole('button', { name: 'Login', exact: true }).click(); await page.waitForURL(url => url.pathname !== '/admin/login');
  for (const spec of [
   { key: 'winter', input: '2026-11-16T10:00', expectedUtc: '2026-11-16T08:00:00.000Z', expectedStatus: 200 },
   { key: 'spring-gap', input: '2027-03-28T03:30', expectedStatus: 400 },
   { key: 'autumn-ambiguous', input: '2026-10-25T03:30', expectedStatus: 400 },
   { key: 'autumn-offset-summer', input: '2026-10-25T03:30:00+03:00', expectedUtc: '2026-10-25T00:30:00.000Z', expectedStatus: 200 },
   { key: 'autumn-offset-winter', input: '2026-10-25T03:30:00+02:00', expectedUtc: '2026-10-25T01:30:00.000Z', expectedStatus: 200 },
   { key: 'dst-autumn-final-hour', input: '2026-10-25T23:30:00+02:00', expectedUtc: '2026-10-25T21:30:00.000Z', expectedStatus: 200, bounds: ['2026-10-24T21:00:00Z', '2026-10-25T21:00:00Z', '2026-10-25T22:00:00Z'], expectedOld: 0, expectedCanonical: 1 },
   { key: 'dst-spring-next-day', input: '2027-03-29T00:30:00+03:00', expectedUtc: '2027-03-28T21:30:00.000Z', expectedStatus: 200, bounds: ['2027-03-27T22:00:00Z', '2027-03-28T22:00:00Z', '2027-03-28T21:00:00Z'], expectedOld: 1, expectedCanonical: 0 },
  ].filter(spec => !dstOnly || spec.key.startsWith('dst-'))) {
   const tag = 'SIM-OOH-TIME-' + phase + '-' + spec.key + '-' + crypto.randomUUID();
   const before = await prisma.crmCompany.count({ where: { name: tag } });
   const throughForm = phase === 'after' && ['winter', 'spring-gap', 'autumn-ambiguous'].includes(spec.key);
   let response;
   if (throughForm) {
    await page.goto(base + '/admin/crm');
    await page.getByRole('button', { name: 'Prospect nou', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prospect nou', exact: true });
    await dialog.getByLabel('Firmă *', { exact: true }).fill(tag);
    await dialog.getByLabel('Persoană de contact', { exact: true }).fill('SIM-OOH Ora Locala');
    await dialog.getByLabel('Următorul contact', { exact: true }).fill(spec.input);
    const received = page.waitForResponse(result => new URL(result.url()).pathname === '/api/admin/crm/commands' && result.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Creează', exact: true }).click();
    const result = await received;
    response = { status: result.status(), payload: await result.json() };
    if (spec.expectedStatus === 400) {
     const expectedError = spec.key === 'spring-gap' ? 'Ora aleasă nu există' : 'Ora aleasă apare de două ori';
     await dialog.getByText(new RegExp(expectedError)).waitFor();
     response.visibleError = await dialog.locator('p').filter({ hasText: expectedError }).textContent();
     response.screenshot = path.relative(root, path.join(screenshots, spec.key + '.png'));
     await page.screenshot({ path: path.join(root, response.screenshot), fullPage: true });
     await dialog.getByRole('button', { name: 'Renunță', exact: true }).click();
    }
   } else {
    response = await page.evaluate(async data => { const result = await fetch('/api/admin/crm/commands', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: result.status, payload: await result.json() }; }, { action: 'create_prospect', companyName: tag, contactName: 'SIM-OOH Ora Locala', email: 'sim-time@example.invalid', status: 'prospecting', nextActionType: 'initial_call', nextActionDueAt: spec.input, idempotencyKey: crypto.randomUUID(), allowPotentialDuplicate: true });
   }
   const result = response.payload;
   const company = await prisma.crmCompany.findFirst({ where: { name: tag }, include: { nextActions: true, prospects: true } });
   const due = company?.nextActions[0]?.dueAt?.toISOString() || null;
   const item = { ...spec, submission: throughForm ? 'actual CRM create dialog' : 'authenticated browser API (explicit-offset input)', observedStatus: response.status, observedUtc: due, companyCreated: !!company, companyCountDelta: await prisma.crmCompany.count({ where: { name: tag } }) - before, prospectCount: company?.prospects.length || 0, actionCount: company?.nextActions.length || 0, outcome: result.outcome, message: result.error || null, visibleError: response.visibleError || null, screenshot: response.screenshot || null };
   report.cases.push(item);
   if (due) item.displayedBucharestTime = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }).format(new Date(due));
   if (spec.bounds && company) { item.fixed24hRangeCount = await prisma.crmNextAction.count({ where: { companyId: company.id, dueAt: { gte: new Date(spec.bounds[0]), lt: new Date(spec.bounds[1]) } } }); item.calendarDayRangeCount = await prisma.crmNextAction.count({ where: { companyId: company.id, dueAt: { gte: new Date(spec.bounds[0]), lt: new Date(spec.bounds[2]) } } }); assert.equal(item.fixed24hRangeCount, spec.expectedOld); assert.equal(item.calendarDayRangeCount, spec.expectedCanonical); }
   if (phase === 'after' && company?.prospects[0]) {
    const recordPath = '/api/admin/crm/records/prospect/' + encodeURIComponent(company.prospects[0].id);
    const detail = await page.evaluate(async pathname => { const result = await fetch(pathname, { cache: 'no-store' }); return { status: result.status, payload: await result.json() }; }, recordPath);
    item.detailApiStatus = detail.status;
    item.detailApiUtc = detail.payload.record?.nextAction?.dueAt || null;
    assert.equal(item.detailApiStatus, 200);
    assert.equal(item.detailApiUtc, due, 'Record API must preserve the persisted instant.');
    await page.goto(base + '/admin/crm?view=all&kind=prospect&record=' + encodeURIComponent(company.prospects[0].id));
    const drawer = page.getByRole('dialog', { name: 'Dosar CRM', exact: true });
    await drawer.getByRole('heading', { name: tag, exact: true }).waitFor();
    const dueText = drawer.locator('section').filter({ hasText: 'Următorul pas' }).first().locator('small');
    await dueText.waitFor();
    item.actualUiDueText = await dueText.textContent();
    item.expectedUiDueText = new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }).format(new Date(due));
    assert.equal(item.actualUiDueText, item.expectedUiDueText, 'Actual CRM drawer must display the Bucharest time.');
    item.screenshot = path.relative(root, path.join(screenshots, spec.key + '.png'));
    await page.screenshot({ path: path.join(root, item.screenshot), fullPage: true });
   }
   if (phase === 'after') { assert.equal(response.status, spec.expectedStatus, spec.key); if (spec.expectedUtc) { assert.equal(due, spec.expectedUtc, spec.key); assert.equal(item.companyCountDelta, 1); assert.equal(item.prospectCount, 1); assert.equal(item.actionCount, 1); } else { assert.equal(company, null, 'Invalid local time must not create a business record'); assert.equal(item.companyCountDelta, 0); assert.equal(item.prospectCount, 0); assert.equal(item.actionCount, 0); assert.equal(result.outcome, 'rejected'); } }
  }
  if (phase === 'after') {
   const preservedActions = await prisma.crmNextAction.findMany({ where: { id: { in: existingActions.map(action => action.id) } }, select: { id: true, dueAt: true }, orderBy: { id: 'asc' } });
   const digest = actions => crypto.createHash('sha256').update(JSON.stringify(actions.map(action => [action.id, action.dueAt.toISOString()]))).digest('hex');
   report.historical_timestamp_proof = { checked_existing_actions: existingActions.length, remaining_actions: preservedActions.length, before_sha256: digest(existingActions), after_sha256: digest(preservedActions) };
   assert.equal(report.historical_timestamp_proof.after_sha256, report.historical_timestamp_proof.before_sha256, 'Existing persisted timestamps must remain unchanged.');
  }
  report.execution_completed = true;
 } finally { await browser.close(); await prisma.$disconnect(); fs.writeFileSync(path.join(root, `crm-time-${phase}${dstOnly ? "-dst" : ""}.json`), JSON.stringify(report, null, 2) + '\n'); }
 console.log(JSON.stringify({ phase, cases: report.cases.length, actual_ui_submissions: report.cases.filter(x => x.submission === 'actual CRM create dialog').length, actual_ui_due_checks: report.cases.filter(x => x.actualUiDueText).length, mismatches: report.cases.filter(x => x.observedStatus !== x.expectedStatus || x.expectedUtc && x.observedUtc !== x.expectedUtc).length, external_attempts_blocked: report.external_attempts_blocked.length }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
