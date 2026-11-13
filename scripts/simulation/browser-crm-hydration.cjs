#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createBrowserRuntime } = require('../release/browser-runtime.cjs');
const root = '/workspace/work/ooh-simulation';
const base = 'http://127.0.0.1:3041';
const phase = process.argv[process.argv.indexOf('--phase') + 1] || 'baseline';
if (!['baseline', 'after'].includes(phase)) throw new Error('Explicit baseline/after phase required.');
if (process.env.OOH_SIMULATION !== 'true' || process.env.OOH_SIMULATION_DATASET_ID !== 'focus-ooh-real-company-v1' || process.env.APP_ENV !== 'preview') throw new Error('Synthetic simulation environment required.');
const accounts = JSON.parse(fs.readFileSync(path.join(root, 'accounts.private.json'), 'utf8'));
assert.ok(accounts.users.sellerA.email.endsWith('@example.invalid'));
const report = { finding: 'SIM-CRM-001', phase, app: base, server_timezone: 'UTC', business_writes: false, contexts: [], external_attempts_blocked: [] };
const screenshots = path.join(root, 'screenshots', 'crm-hydration-' + phase);
fs.mkdirSync(screenshots, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: createBrowserRuntime(9297).findChrome(), headless: true, args: ['--no-sandbox'] });
  try {
    for (const settings of [{ locale: 'ro-RO', timezoneId: 'Europe/Bucharest' }, { locale: 'en-US', timezoneId: 'UTC' }]) {
      const context = await browser.newContext({ ...settings, viewport: { width: 1440, height: 1000 } });
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external_attempts_blocked.push(url.origin); return route.abort(); });
      const page = await context.newPage(); const evidence = { ...settings, checks: [] }; let current;
      page.on('pageerror', error => { if (current) current.page_errors.push(error.message); });
      await page.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email', { exact: true }).fill(accounts.users.sellerA.email);
      await page.getByLabel('Parola', { exact: true }).fill(accounts.password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.waitForURL(url => url.pathname !== '/admin/login');
      for (const route of ['/admin/crm', '/admin/crm?view=all', '/admin/crm?view=opportunities&q=SIM-OOH&stage=negotiation&page=2']) {
        current = { route, page_errors: [], requested_workspace_urls: [] };
        const record = request => { if (request.url().includes('/api/admin/crm/workspace?')) current.requested_workspace_urls.push(new URL(request.url()).search); };
        page.on('request', record);
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        if (phase === 'after') await page.locator('[data-crm-snapshot="ready"]').waitFor();
        await page.waitForTimeout(1400);
        current.view_buttons = await page.locator('nav[aria-label="Perspective CRM"] button').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent.trim(), active: button.className.includes('bg-focus-yellow') })));
        current.stage_filter_visible = await page.getByLabel('Etapă oportunitate', { exact: true }).count();
        current.url_after_load = new URL(page.url()).pathname + new URL(page.url()).search;
        current.search_text = await page.getByLabel('Căutare CRM', { exact: true }).inputValue();
        const firstAgendaRow = page.locator('section[aria-label="Agenda de astăzi"] button').first();
        current.agenda_first_row = await firstAgendaRow.count() ? await firstAgendaRow.textContent() : null;
        current.screenshot = path.relative(root, path.join(screenshots, `${settings.locale}-${evidence.checks.length + 1}.png`));
        await page.screenshot({ path: path.join(root, current.screenshot), fullPage: true });
        page.off('request', record); evidence.checks.push(current);
        if (phase === 'after') {
          const expected = new URL(route, base).searchParams;
          const active = current.view_buttons.filter(button => button.active).map(button => button.text);
          assert.deepEqual(active, [expected.get('view') === 'all' ? 'Toate' : expected.get('view') === 'opportunities' ? 'Oportunități' : 'Astăzi']);
          assert.equal(current.search_text, expected.get('q') || '');
          assert.equal(current.stage_filter_visible, expected.get('view') === 'opportunities' || expected.get('view') === 'all' ? 1 : 0);
          assert.ok(current.requested_workspace_urls.length > 0, 'The bookmarked view must actually load workspace data.');
          if (route.includes('page=2')) {
            assert.equal(new URL(page.url()).searchParams.get('page'), '2', 'Initial query hydration must not reset a bookmarked page.');
            assert.ok(current.requested_workspace_urls.every(query => new URLSearchParams(query).get('page') === '2'), 'No first-page request may replace the explicit page.');
            assert.equal(await page.getByLabel('Etapă oportunitate', { exact: true }).inputValue(), 'negotiation');
            const changedQuery = 'SIM-OOH-query-changed';
            const changedResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/admin/crm/workspace' && url.searchParams.get('q') === changedQuery; });
            await page.getByLabel('Căutare CRM', { exact: true }).fill(changedQuery);
            const response = await changedResponse;
            current.changed_query_check = { workspace_status: response.status(), requested_page: new URL(response.url()).searchParams.get('page'), settled_url: new URL(page.url()).pathname + new URL(page.url()).search };
            assert.equal(current.changed_query_check.workspace_status, 200);
            assert.equal(current.changed_query_check.requested_page, '1', 'A real search change must reset pagination.');
          }
        }
      }
      report.contexts.push(evidence); await context.close();
    }
  } finally { await browser.close(); }
  report.hydration_errors = report.contexts.flatMap(context => context.checks.flatMap(check => check.page_errors)).filter(error => /#418|hydration/i.test(error)).length;
  fs.writeFileSync(path.join(root, `crm-hydration-${phase}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase, checks: report.contexts.reduce((sum, c) => sum + c.checks.length, 0), hydration_errors: report.hydration_errors, external_attempts_blocked: report.external_attempts_blocked.length }));
  if (phase === 'after') assert.equal(report.hydration_errors, 0);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
