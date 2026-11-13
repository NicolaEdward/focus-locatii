const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { statements, validate } = require('./release/apply-remediation-schema.cjs');
const { identity } = require('./release/database-backup.cjs');
const source = identity(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(source.u.hostname) || !/^focus_preview_/.test(source.name) || process.env.VERCEL_ENV === 'production' || process.env.ALLOW_SYNTHETIC_SEED !== 'true') throw new Error('Local synthetic migration test only');
const sql = 'CREATE TABLE `portfolio_fixture` (`id` VARCHAR(20), `note` TEXT DEFAULT \'a;b\'); -- ignored;\nALTER TABLE `portfolio_fixture` ADD CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `portfolio_users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;';
assert.equal(statements(sql).length,2);
assert.equal(validate([{path:'fixture',sql}]).tables.length,1);
for (const extra of ['DELETE FROM `portfolio_users`','ALTER TABLE `portfolio_users` ADD COLUMN `x` INT','DROP TABLE `portfolio_fixture`','UPDATE `portfolio_users` SET active=0','TRUNCATE TABLE `portfolio_users`']) assert.throws(()=>validate([{path:'fixture',sql:sql+';'+extra}]),/NON_ADDITIVE/);
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'release/remediation-schema.json'),'utf8'));
assert.equal(Object.keys(manifest.tables).length,19);
assert.ok(Object.values(manifest.tables).every((t)=>t.storage.engine==='InnoDB'));
function invoke(args, env) {
  const r=spawnSync(process.execPath,[path.join(__dirname,'release/apply-remediation-schema.cjs'),...args],{env:{...process.env,...env},encoding:'utf8',timeout:60000});
  return {code:r.status,result:JSON.parse((r.status===0?r.stdout:r.stderr).trim().split('\n').at(-1))};
}
const denied=invoke(['--apply'],{APPLY_REMEDIATION_SCHEMA:'true',REMEDIATION_DATABASE_FINGERPRINT:'wrong-target'});
assert.notEqual(denied.code,0);assert.equal(denied.result.code,'EXPLICIT_DATABASE_FINGERPRINT_REQUIRED');
const check=invoke([],{});assert.equal(check.code,0);assert.deepEqual(check.result.pending,[]);
const replay=invoke(['--apply'],{APPLY_REMEDIATION_SCHEMA:'true',REMEDIATION_DATABASE_FINGERPRINT:source.fingerprint});
assert.equal(replay.code,0);assert.deepEqual(replay.result.before,replay.result.after);assert.equal(replay.result.schemaSha256,check.result.schemaSha256);
console.log('Additive schema gate passed: SQL restrictions, wrong-target denial, exact nineteen-table metadata, no-op replay and preserved historical counts');
