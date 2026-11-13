// Consolidated regression gate. DB fixtures are permitted only in an isolated
// synthetic environment; production deployments never run this script.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const url = new URL(process.env.DATABASE_URL || 'invalid:');
if (!['ci','test','preview'].includes(process.env.APP_ENV) || process.env.VERCEL_ENV === 'production' || process.env.ALLOW_SYNTHETIC_SEED !== 'true' || !['127.0.0.1','localhost'].includes(url.hostname) || !/^\/focus_(preview|test)_/.test(url.pathname)) throw new Error('Remediation tests require an isolated local synthetic database');
const suites = [
  'test-rbac.ts','test-user-management.ts','test-auth-hardening.ts','test-auth-remediation.ts',
  'test-client-atomic-mutations.ts','test-crm-command-outcomes.ts','test-location-mutation-transactions.ts','test-location-private-read.ts','test-inventory-availability-summary.ts','test-occupancy-summary-ui.cjs',
  'test-transactional-audit.ts','test-reservation-read-access.ts','test-d-ceo-mutation-inventory.ts',
  'test-availability.cjs','test-reservation-remediation.cjs','test-reservation-integrity.cjs',
  'test-reservation-route-safety.cjs','test-reservation-lifecycle.cjs','test-ownership-integrity.ts',
  'test-campaign-lifecycle.ts','test-campaign-commercial-summary.ts','test-business-responsibility.ts',
  'test-client-supplier-workflows.ts','test-public-location-serialization.cjs','test-document-access.cjs',
  'test-media-boundaries.ts','test-data-import-hardening.ts','test-secure-spreadsheet-imports.ts',
  'test-finance-remediation.ts','test-finance-plan-and-alerts.ts','test-financial-bank-reconciliation.ts',
  'test-receivables-reconciliation.ts','test-billing.cjs','test-finance-consistency.cjs',
  'test-commercial-workbench.ts','test-dooh-static-capacity.ts','test-operations-controls.ts','test-backup-restore.cjs','test-backup-hardening.cjs',
  'test-remediation-schema.cjs','test-remediation-collation-plan.cjs','test-database-connection-policy.ts','test-remediation-history.ts','test-database-read-retry.ts','test-release-governance.cjs','test-observability.ts',
  'test-admin-route-links.cjs','test-dashboard-command-centers.cjs','test-notifications.cjs','test-operations-rbac.cjs','test-dependency-policy.cjs'
];
const selected = process.env.REMEDIATION_TEST_FILTER ? suites.filter((s) => s.includes(process.env.REMEDIATION_TEST_FILTER)) : suites;
if (!selected.length) throw new Error('No matching remediation test');
const dir = path.resolve('artifacts/remediation'); fs.mkdirSync(dir,{recursive:true});
const results = [];
for (const name of selected) {
  const started = Date.now(), script = path.join('scripts',name);
  const args = name.endsWith('.ts') ? [require.resolve('tsx/cli'),script] : [script];
  const result = spawnSync(process.execPath,args,{encoding:'utf8',env:process.env,maxBuffer:20*1024*1024,timeout:300000});
  fs.writeFileSync(path.join(dir,name+'.log'),String(result.stdout||'')+String(result.stderr||''));
  const row = { suite:name,ok:result.status===0,durationMs:Date.now()-started,exitCode:result.status,error:result.error?.code||null };results.push(row);
  console.log(JSON.stringify(row));
  if (!row.ok) console.error((String(result.stderr||'')||String(result.stdout||'')).slice(-4000));
}
fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({environment:'local-synthetic',capturedAt:new Date().toISOString(),results},null,2)+'\n');
if (results.some((r)=>!r.ok)) process.exitCode=1;
