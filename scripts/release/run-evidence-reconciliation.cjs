// Never runs in ordinary builds. Exact target, payload hash and encrypted input
// are validated by the child before any database connection is opened.
const { spawnSync } = require('node:child_process');
if (process.env.RUN_EVIDENCE_RECONCILIATION === 'true') {
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/release/run-evidence-reconciliation.ts'], {
    env: process.env, stdio: 'inherit', timeout: 600000
  });
  if (result.status !== 0) {
    console.error(JSON.stringify({ event: 'evidence_reconciliation', ok: false, code: 'EVIDENCE_JOB_PROCESS_FAILED', outcome: 'verify_receipts_before_retry' }));
    process.exitCode = result.status || 1;
  }
}
