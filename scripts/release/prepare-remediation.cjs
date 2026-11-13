// Build-time opt-in only; ordinary builds and runtime requests never migrate.
const { run } = require('./apply-remediation-schema.cjs');
async function main() {
  const apply = process.env.APPLY_REMEDIATION_SCHEMA === 'true';
  if (!apply && process.env.RUN_REMEDIATION_SCHEMA_CHECK !== 'true') {
    console.log(JSON.stringify({ event:'remediation_schema', skipped:true })); return;
  }
  const result = await run({apply}); console.log(JSON.stringify(result));
  if (apply && result.pending.length) throw new Error('ADDITIVE_SCHEMA_PENDING');
}
main().catch((error) => { console.error(JSON.stringify({ event:'remediation_schema',ok:false,code:/^[A-Z][A-Z0-9_]+$/.test(error.message||'') ? error.message : /^ER_[A-Z_]+$/.test(error.code||'') ? error.code : 'SCHEMA_PREPARATION_FAILED' })); process.exitCode=1; });
