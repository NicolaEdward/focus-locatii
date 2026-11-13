const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { spawnSync } = require('node:child_process');
const { identity } = require('./release/database-backup.cjs');
const { resolvePortablePlan } = require('./release/remediation-collation-plan.cjs');
const source = identity(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(source.u.hostname) || !/^focus_preview_/.test(source.name) || process.env.VERCEL_ENV === 'production' || process.env.ALLOW_SYNTHETIC_SEED !== 'true') throw new Error('LOCAL_SYNTHETIC_COLLATION_TEST_ONLY');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'release/remediation-schema.json'),'utf8'));
const quote = value => { assert.match(value,/^portfolio_[a-z0-9_]+$/); return '`'+value+'`'; };
const checksum = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main() {
  const suffix=Date.now(); const database=`focus_preview_portability_${suffix}`;
  const admin=await mysql.createConnection({host:source.u.hostname,port:Number(source.u.port||3306),user:decodeURIComponent(source.u.username),password:decodeURIComponent(source.u.password),multipleStatements:false});
  await admin.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  const url=new URL(process.env.DATABASE_URL);url.pathname='/'+database;
  const target=identity(url.href);
  const db=await mysql.createConnection({host:source.u.hostname,port:Number(source.u.port||3306),user:decodeURIComponent(source.u.username),password:decodeURIComponent(source.u.password),database,multipleStatements:false});
  const historical=[...new Set([...Object.values(manifest.tables).flatMap(table=>table.foreignKeys.map(fk=>fk.targetTable)).filter(table=>!manifest.tables[table]),'portfolio_users','portfolio_client_accounts','portfolio_locations','portfolio_reservations','portfolio_campaigns','portfolio_financial_receivables','portfolio_financial_receivable_payments','portfolio_audit_logs'])].sort();
  function invoke(args=[],extra={}) { const result=spawnSync(process.execPath,[path.join(__dirname,'release/apply-remediation-schema.cjs'),...args],{env:{...process.env,DATABASE_URL:url.href,APPLY_REMEDIATION_SCHEMA:'true',REMEDIATION_DATABASE_FINGERPRINT:target.fingerprint,...extra},encoding:'utf8',timeout:60000});return {code:result.status,output:JSON.parse((result.status===0?result.stdout:result.stderr).trim().split('\n').at(-1))}; }
  async function historicalState() {
    const values=[];
    for(const table of historical) { const [ddl]=await db.query('SHOW CREATE TABLE '+quote(table));const [rows]=await db.query('SELECT * FROM '+quote(table)+' ORDER BY id');values.push([table,ddl[0]['Create Table'],rows]); }
    return checksum(values);
  }
  try {
    for(const table of historical) {
      const collate=table==='portfolio_billing_items'?'utf8mb4_0900_ai_ci':'utf8mb4_unicode_ci';
      await db.query(`CREATE TABLE ${quote(table)} (id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE ${collate} NOT NULL, preservedPayload TEXT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.query('INSERT INTO '+quote(table)+' (id,preservedPayload) VALUES (?,?)',['synthetic-preserved-row','Synthetic historical payload must remain byte identical']);
    }
    const before=await historicalState();
    const check=invoke();assert.equal(check.code,0,JSON.stringify(check));assert.equal(check.output.pending.length,19);assert.equal(check.output.adaptations.length,1);assert.deepEqual(check.output.adaptations[0],{table:'portfolio_financial_invoice_allocations',column:'billingItemId',type:'varchar(191)',charset:'utf8mb4',fromCollation:'utf8mb4_unicode_ci',toCollation:'utf8mb4_0900_ai_ci'});
    const [stillAbsent]=await db.query('SHOW TABLES');assert.equal(stillAbsent.length,historical.length,'dry-run must execute no DDL');
    const denied=invoke(['--apply'],{REMEDIATION_RESOLVED_PLAN_SHA256:'wrong-plan'});assert.notEqual(denied.code,0);assert.equal(denied.output.code,'EXACT_RESOLVED_SCHEMA_PLAN_REQUIRED');
    const apply=invoke(['--apply'],{REMEDIATION_RESOLVED_PLAN_SHA256:check.output.resolvedPlanSha256});assert.equal(apply.code,0,JSON.stringify(apply));assert.deepEqual(apply.output.pending,[]);assert.equal(await historicalState(),before,'all existing historical table definitions and rows stay byte identical');
    const replay=invoke(['--apply'],{REMEDIATION_RESOLVED_PLAN_SHA256:check.output.resolvedPlanSha256});assert.equal(replay.code,0,JSON.stringify(replay));assert.equal(replay.output.schemaSha256,apply.output.schemaSha256);
    // Resume with the new table already present but one FK still pending.
    await db.query('ALTER TABLE portfolio_financial_invoice_allocations DROP FOREIGN KEY portfolio_financial_invoice_allocations_billingItemId_fkey');
    const resume=invoke(['--apply'],{REMEDIATION_RESOLVED_PLAN_SHA256:check.output.resolvedPlanSha256});assert.equal(resume.code,0,JSON.stringify(resume));assert.equal(resume.output.schemaSha256,apply.output.schemaSha256);assert.equal(await historicalState(),before);
    // A changed parent plan invalidates a previously reviewed hash.
    await db.query('ALTER TABLE portfolio_users ADD INDEX fixture_parent_metadata_change (preservedPayload(10))');
    const stale=invoke(['--apply'],{REMEDIATION_RESOLVED_PLAN_SHA256:check.output.resolvedPlanSha256});assert.notEqual(stale.code,0);assert.equal(stale.output.code,'EXACT_RESOLVED_SCHEMA_PLAN_REQUIRED');
    // Equivalence propagation and explicit refusal tests use metadata only.
    const column=(name,collationName='utf8mb4_unicode_ci')=>({name,type:'varchar(191)',charsetName:'utf8mb4',collationName});
    const spec=(columns,foreignKeys=[])=>({storage:{engine:'InnoDB'},columns,indexes:[],foreignKeys});
    const fk=(columnName,targetTable,targetColumn='id')=>({columnName,targetTable,targetColumn});
    const mini={migrations:[],tables:{portfolio_new_a:spec([column('id'),column('untouched')],[fk('id','portfolio_old')]),portfolio_new_b:spec([column('id')],[fk('id','portfolio_new_a')])}};
    const parsed=Object.keys(mini.tables).map(table=>({kind:'create',table,file:'fixture',sql:`CREATE TABLE \`${table}\` (\n  \`id\` VARCHAR(191) NOT NULL,\n  \`untouched\` VARCHAR(191) NULL\n)`}));
    const parents={portfolio_old:spec([column('id','utf8mb4_0900_ai_ci')])};
    const plan=resolvePortablePlan({manifest:mini,parsed,parentShapes:parents,databaseFingerprint:'synthetic'});assert.equal(plan.adaptations.length,2);assert.equal(plan.tables.portfolio_new_a.columns[1].collationName,'utf8mb4_unicode_ci');assert.ok(plan.parsed.every(statement=>statement.sql.includes('COLLATE utf8mb4_0900_ai_ci')));
    const conflict=JSON.parse(JSON.stringify(mini));conflict.tables.portfolio_new_a.foreignKeys.push(fk('id','portfolio_other'));
    assert.throws(()=>resolvePortablePlan({manifest:conflict,parsed,parentShapes:{...parents,portfolio_other:spec([column('id')])},databaseFingerprint:'synthetic'}),/CONFLICTING_HISTORICAL_PARENT_COLLATIONS/);
    for(const change of [{type:'varchar(190)'},{charsetName:'latin1',collationName:'latin1_swedish_ci'}]) { const changed=JSON.parse(JSON.stringify(parents));Object.assign(changed.portfolio_old.columns[0],change);assert.throws(()=>resolvePortablePlan({manifest:mini,parsed,parentShapes:changed,databaseFingerprint:'synthetic'}),/TYPE_OR_CHARSET_CHANGE_REJECTED/); }
    console.log('Portable collation plan passed: dry-run, exact plan binding, inherited FK collation, historical preservation, idempotence, resume, stale-plan refusal, graph propagation and conflict/type/charset rejection');
  } finally { await db.end();await admin.query('DROP DATABASE `'+database+'`');await admin.end(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
