#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createBrowserRuntime } = require('../release/browser-runtime.cjs');

const root = '/workspace/work/ooh-simulation';
const base = 'http://127.0.0.1:3041';
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const phase = arg('--phase', 'final');
const contextPath = arg('--quote-context', null);
const onlyAvailability = process.argv.includes('--only-availability');
if (!/^[a-z0-9-]{1,40}$/.test(phase) || process.env.OOH_SIMULATION !== 'true' || process.env.OOH_SIMULATION_DATASET_ID !== 'focus-ooh-real-company-v1' || process.env.APP_ENV !== 'preview') throw new Error('SYNTHETIC_ROUTE_MATRIX_REQUIRED');
if (onlyAvailability && !contextPath) throw new Error('QUOTE_CONTEXT_REQUIRED');
require('tsx/cjs');
const { hasAnyPermission, hasPermission, hasGlobalDataAccess } = require('../../src/lib/rbac.ts');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, 'accounts.private.json'), 'utf8'));
const actors = Object.entries(manifest.users).map(([alias, user]) => ({ alias, id: user.id, role: user.role }));
assert.equal(actors.length, 8);
assert.equal(new Set(actors.map(actor => actor.role)).size, 7);
const month = manifest.anchorDate.slice(0, 7);
const pairedClients = ['sellerA', 'sellerB'].map(alias => manifest.clients.find(client => client.owner === manifest.users[alias].id));
assert.ok(pairedClients.every(Boolean));
const params = new URLSearchParams({ kind: 'clients', q: 'SIM-OOH-NO-SUCH-CLIENT-ROUTE-AUTH', ids: pairedClients.map(client => client.id).join(','), pageSize: '1' });
const sourcePath = path.join(root, 'final-build-source.json');
const sourceHash = fs.existsSync(sourcePath) ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')).application_source_sha256 : null;
const quote = contextPath ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : null;
if (quote) {
 assert.ok(typeof quote.quoteId === 'string' && Number.isInteger(quote.expectedRevision) && quote.expectedRevision > 0);
 assert.ok(quote.ownerAlias === 'sellerA' || quote.ownerAlias === 'sellerB');
 assert.ok(Array.isArray(quote.locationIds) && quote.locationIds.length > 0 && quote.locationIds.length <= 50);
 assert.ok(quote.locationIds.every(id => id.startsWith('sim-ooh-location-')));
 assert.match(quote.periodStart, /^\d{4}-\d{2}-\d{2}$/);
 assert.match(quote.periodEnd, /^\d{4}-\d{2}-\d{2}$/);
}
const report = { schema_version: '1.0', phase, application_source_sha256: sourceHash, scope: onlyAvailability ? 'quote-context read-only POST' : quote ? 'new GET routes and quote-context read-only POST' : 'new GET routes', actors: [], checks: [], failures: [], external_attempts_blocked: [], business_writes: false, incidental_metadata: 'Real UI login creates registered authentication sessions; authorized availability POST may create the existing audit-intent metadata. No customer, invoice, contract, quote or reservation writes.', permission_source: ['src/lib/rbac.ts', 'src/app/api/admin/commercial-options/route.ts', 'src/app/api/admin/receivables/[id]/documents/route.ts', 'src/lib/operational-execution-history.ts', 'src/lib/quote-hold-context.ts'], started_at: new Date().toISOString() };
let stage = 'launch';
const issue = (actor, caseId, check, valid) => { if (!valid) report.failures.push({ actor: actor.alias, case: caseId, check }); };
const shape = body => ({ response_keys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : [], ...(Array.isArray(body?.rows) ? { rows: body.rows.length, row_keys: body.rows[0] ? Object.keys(body.rows[0]).sort() : [] } : {}), ...(Array.isArray(body?.selected) ? { selected: body.selected.length } : {}), ...(Array.isArray(body?.documents) ? { documents: body.documents.length, document_keys: body.documents[0] ? Object.keys(body.documents[0]).sort() : [] } : {}), ...(body?.availabilityByLocationId ? { locations: Object.keys(body.availabilityByLocationId).length } : {}) });

async function check(page, actor, spec) {
 stage = actor.alias + ':' + spec.id;
 const result = await page.evaluate(async spec => {
  const response = await fetch(spec.path, { method: spec.method || 'GET', credentials: 'same-origin', cache: 'no-store', ...(spec.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec.body) } : {}) });
  return { status: response.status, cache_control: response.headers.get('cache-control'), vary: response.headers.get('vary'), body: await response.json().catch(() => null) };
 }, { path: spec.path, method: spec.method, body: spec.body });
 const item = { actor: actor.alias, role: actor.role, case: spec.id, method: spec.method || 'GET', route: spec.route, expected_status: spec.expected, observed_status: result.status, cache_control: result.cache_control, ...shape(result.body) };
 report.checks.push(item);
 issue(actor, spec.id, 'expected_status', result.status === spec.expected);
 issue(actor, spec.id, 'no_store', /(?:^|,)\s*no-store(?:\s*,|$)/i.test(result.cache_control || ''));
 if (result.status >= 400) {
  const keys = item.response_keys;
  const text = JSON.stringify(result.body || {});
  item.private_response_data_exposed = !keys.every(key => ['error', 'code'].includes(key)) || pairedClients.some(client => text.includes(client.name) || text.includes(client.id));
  issue(actor, spec.id, 'minimal_error_no_private_data', !item.private_response_data_exposed);
 }
 if (result.status === 200 && spec.id === 'commercial-selected-scope') {
  const allowedIds = pairedClients.filter(client => hasGlobalDataAccess(actor.role) || client.owner === actor.id).map(client => client.id).sort();
  const actualIds = (result.body?.selected || []).map(client => client.id).sort();
  item.selected_scope_matches = JSON.stringify(actualIds) === JSON.stringify(allowedIds);
  issue(actor, spec.id, 'selected_client_ownership_scope', item.selected_scope_matches);
 }
 if (result.status === 200 && spec.id === 'commercial-foreign-search') {
  const text = JSON.stringify(result.body || {});
  const foreign = pairedClients.find(client => client.owner !== actor.id);
  item.private_response_data_exposed = (result.body?.rows?.length || 0) > 0 || (result.body?.selected?.length || 0) > 0 || text.includes(foreign.id) || text.includes(foreign.name);
  issue(actor, spec.id, 'foreign_client_not_disclosed', !item.private_response_data_exposed);
 }
 if (result.status === 200 && spec.id === 'invoice-documents') issue(actor, spec.id, 'no_storage_payload', !JSON.stringify(result.body).includes('storageUrl'));
 if (result.status === 200 && spec.id === 'execution-history' && actor.role === 'SALES_AGENT') {
  const foreignIds = new Set(manifest.reservations.filter(row => row.ownerId !== actor.id).map(row => row.id));
  item.foreign_reservation_rows = (result.body?.rows || []).filter(row => foreignIds.has(row.reservationId)).length;
  issue(actor, spec.id, 'execution_history_ownership_scope', item.foreign_reservation_rows === 0);
 }
 if (result.status === 200 && spec.id === 'quote-availability') {
  item.exact_quote_context = result.body?.quoteHoldContext?.quoteId === quote.quoteId && result.body?.quoteHoldContext?.expectedRevision === quote.expectedRevision;
  issue(actor, spec.id, 'exact_owned_or_global_quote_context', item.exact_quote_context);
 }
}

(async () => {
 const browser = await chromium.launch({ executablePath: createBrowserRuntime(9300).findChrome(), headless: true, args: ['--no-sandbox'] });
 try {
  const makeContext = async () => {
   const context = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Bucharest' });
   await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external_attempts_blocked.push({ origin: url.origin, resource_type: route.request().resourceType() }); return route.abort(); });
   return context;
  };
  const quoteBody = quote ? { quoteId: quote.quoteId, expectedRevision: quote.expectedRevision, periodStart: quote.periodStart, periodEnd: quote.periodEnd, locationIds: quote.locationIds } : null;
  const getSpecs = actor => [
   { id: 'commercial-selected-scope', route: '/api/admin/commercial-options', path: '/api/admin/commercial-options?' + params, expected: hasAnyPermission(actor.role, ['reservations.view', 'reservations.view.own']) ? 200 : 403 },
   { id: 'invoice-documents', route: '/api/admin/receivables/:id/documents', path: '/api/admin/receivables/' + encodeURIComponent(manifest.scenarios.sharedInvoiceId) + '/documents', expected: hasPermission(actor.role, 'finance.view') ? 200 : 403 },
   { id: 'execution-history', route: '/api/admin/operational/execution-history', path: '/api/admin/operational/execution-history?month=' + month, expected: ['SUPER_ADMIN', 'COO', 'D_CEO', 'SALES_DIRECTOR', 'SALES_AGENT'].includes(actor.role) ? 200 : 403 },
  ];
  for (const actor of actors) {
   stage = actor.alias + ':login';
   const credentials = accounts.users[actor.alias];
   assert.ok(credentials?.email.endsWith('@example.invalid'));
   const context = await makeContext();
   try {
    const page = await context.newPage();
    await page.goto(base + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(credentials.email);
    await page.getByLabel('Parola', { exact: true }).fill(accounts.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/admin/login');
    const authenticated = await page.evaluate(async () => { const response = await fetch('/api/auth/session', { cache: 'no-store' }); const data = await response.json(); return { status: response.status, role: data.user?.role || data.session?.role || data.role }; });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.role, actor.role);
    report.actors.push({ alias: actor.alias, role: actor.role, actual_ui_login: true, session_role_verified: true });
    if (!onlyAvailability) {
     for (const spec of getSpecs(actor)) await check(page, actor, spec);
     if (actor.role === 'SALES_AGENT') {
      const foreign = pairedClients.find(client => client.owner !== actor.id);
      await check(page, actor, { id: 'commercial-foreign-search', route: '/api/admin/commercial-options', path: '/api/admin/commercial-options?' + new URLSearchParams({ kind: 'clients', q: foreign.name, ids: foreign.id }), expected: 200 });
     }
     if (actor.alias === 'admin') for (const spec of [
      { id: 'commercial-unknown-kind', route: '/api/admin/commercial-options', path: '/api/admin/commercial-options?kind=unknown', expected: 400 },
      { id: 'invoice-unknown-id', route: '/api/admin/receivables/:id/documents', path: '/api/admin/receivables/sim-ooh-missing-role-check/documents', expected: 404 },
      { id: 'history-invalid-month', route: '/api/admin/operational/execution-history', path: '/api/admin/operational/execution-history?month=1900-01', expected: 400 },
     ]) await check(page, actor, spec);
    }
    if (quote) {
     const allowed = hasPermission(actor.role, 'inventory.view');
     const expected = !allowed ? 403 : hasGlobalDataAccess(actor.role) || actor.alias === quote.ownerAlias ? 200 : 404;
     await check(page, actor, { id: 'quote-availability', route: '/api/admin/location-selection/availability', path: '/api/admin/location-selection/availability', method: 'POST', body: quoteBody, expected });
     if (actor.alias === 'admin') for (const spec of [
      { id: 'quote-unknown-id', expected: 404, body: { ...quoteBody, quoteId: 'sim-ooh-missing-quote-role-check' } },
      { id: 'quote-stale-revision', expected: 409, body: { ...quoteBody, expectedRevision: quote.expectedRevision + 1 } },
     ]) await check(page, actor, { ...spec, route: '/api/admin/location-selection/availability', path: '/api/admin/location-selection/availability', method: 'POST' });
    }
   } finally { await context.close(); }
  }
  const anonymous = { alias: 'unauthenticated', role: null };
  const context = await makeContext();
  try {
   const page = await context.newPage(); await page.goto(base + '/admin/login');
   if (!onlyAvailability) for (const spec of getSpecs({ role: 'FIELD_OPERATOR' })) await check(page, anonymous, { ...spec, id: spec.id + '-unauthenticated', expected: 401 });
   if (quote) await check(page, anonymous, { id: 'quote-availability-unauthenticated', route: '/api/admin/location-selection/availability', path: '/api/admin/location-selection/availability', method: 'POST', body: quoteBody, expected: 401 });
  } finally { await context.close(); }
  report.completed = true;
 } finally { await browser.close(); }
})().catch(() => { report.execution_error = 'ROLE_MATRIX_RUNTIME_ERROR'; report.failure_stage = stage; process.exitCode = 1; }).finally(() => {
 report.updated_at = new Date().toISOString();
 const suffix = onlyAvailability ? '-availability' : '';
 fs.writeFileSync(path.join(root, `new-route-roles-${phase}${suffix}.json`), JSON.stringify(report, null, 2) + '\n');
 if (report.failures.length) process.exitCode = 1;
 console.log(JSON.stringify({ phase, scope: report.scope, actors: report.actors.length, roles: new Set(report.actors.map(actor => actor.role)).size, checks: report.checks.length, failures: report.failures.length, external_attempts_blocked: report.external_attempts_blocked.length, completed: !!report.completed, execution_error: report.execution_error || null, failure_stage: report.failure_stage || null }));
});
