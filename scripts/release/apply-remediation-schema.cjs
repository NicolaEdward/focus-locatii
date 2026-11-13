// Reviewed additive migrations only. This runner never alters historical rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { identity } = require('./database-backup.cjs');
const { resolvePortablePlan } = require('./remediation-collation-plan.cjs');
const manifestPath = path.join(__dirname, 'remediation-schema.json');
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
const quote = (x) => { if (!/^portfolio_[a-z0-9_]+$/.test(x)) throw new Error('SCHEMA_IDENTIFIER_REJECTED'); return '`' + x + '`'; };

function statements(sql) {
  const result = []; let token = '', quoted = '', comment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (comment) { if (c === '\n') { comment = false; token += '\n'; } continue; }
    if (!quoted && c === '-' && n === '-') { comment = true; i++; continue; }
    if (quoted) {
      token += c;
      if (c === '\\') { if (n) { token += n; i++; } }
      else if (c === quoted) { if (n === quoted) { token += n; i++; } else quoted = ''; }
    } else if (['"', "'", '`'].includes(c)) { quoted = c; token += c; }
    else if (c === ';') { if (token.trim()) result.push(token.trim()); token = ''; }
    else token += c;
  }
  if (quoted) throw new Error('UNTERMINATED_SCHEMA_SQL');
  if (token.trim()) result.push(token.trim());
  return result;
}
function validate(files) {
  const parsed = files.flatMap((f) => statements(f.sql).map((sql) => ({ sql, file: f.path })));
  const creates = parsed.filter((s) => /^CREATE TABLE\s+`(portfolio_[a-z0-9_]+)`\s*\(/i.test(s.sql));
  const names = creates.map((s) => s.sql.match(/^CREATE TABLE\s+`([^`]+)`/i)[1]);
  if (!names.length || new Set(names).size !== names.length) throw new Error('INVALID_ADDITIVE_TABLE_SET');
  const tables = new Set(names);
  for (const s of parsed) {
    const create = s.sql.match(/^CREATE TABLE\s+`([^`]+)`\s*\(/i);
    const alter = s.sql.match(/^ALTER TABLE\s+`([^`]+)`\s+ADD CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY\s*\(/i);
    if (create) { s.table = create[1]; s.kind = 'create'; }
    else if (alter && tables.has(alter[1]) && !/;|\b(?:DROP|MODIFY|RENAME|CHANGE|INSERT)\b/i.test(s.sql)) {
      s.table = alter[1]; s.constraint = alter[2]; s.kind = 'foreign_key';
    } else throw new Error('NON_ADDITIVE_SQL_REJECTED');
    quote(s.table);
  }
  return { parsed, tables: names };
}
async function shape(db, database, table) {
  const [[storage]] = await db.execute('SELECT ENGINE engine, TABLE_COLLATION collationName FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, table]);
  const [columns] = await db.execute('SELECT COLUMN_NAME name, COLUMN_TYPE type, IS_NULLABLE nullable, COLUMN_DEFAULT defaultValue, EXTRA extra, CHARACTER_SET_NAME charsetName, COLLATION_NAME collationName, GENERATION_EXPRESSION generation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, table]);
  if (!columns.length) return null;
  const [indexes] = await db.execute('SELECT INDEX_NAME name, NON_UNIQUE nonUnique, SEQ_IN_INDEX sequence, COLUMN_NAME columnName, SUB_PART prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [database, table]);
  const [foreignKeys] = await db.execute('SELECT k.CONSTRAINT_NAME name,k.COLUMN_NAME columnName,k.ORDINAL_POSITION sequence,k.REFERENCED_TABLE_NAME targetTable,k.REFERENCED_COLUMN_NAME targetColumn,r.UPDATE_RULE updateRule,r.DELETE_RULE deleteRule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=? AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION', [database, table]);
  return { storage, columns, indexes, foreignKeys };
}
function stable(value) { return JSON.stringify(value); }
async function counts(db) {
  const result = {};
  for (const t of ['portfolio_users','portfolio_client_accounts','portfolio_locations','portfolio_reservations','portfolio_campaigns','portfolio_financial_receivables','portfolio_financial_receivable_payments','portfolio_audit_logs']) {
    const [[row]] = await db.query(`SELECT COUNT(*) n FROM ${quote(t)}`); result[t] = String(row.n);
  }
  return result;
}
async function run({ generate = false, apply = false } = {}) {
  const source = identity(process.env.DATABASE_URL);
  if (generate && (!['ci','test','preview'].includes(process.env.APP_ENV) || process.env.VERCEL_ENV === 'production' || !/^focus_(preview|test)_/.test(source.name) || process.env.ALLOW_SYNTHETIC_SEED !== 'true')) throw new Error('MANIFEST_CAPTURE_REQUIRES_SYNTHETIC_DATABASE');
  const manifest = generate ? { version: 1, migrations: fs.readdirSync(path.resolve(__dirname, '../../prisma/migrations')).filter((n) => /^20261113/.test(n)).sort().map((n) => ({ path: `prisma/migrations/${n}/migration.sql` })) } : JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = manifest.migrations.map((m) => { const sql = fs.readFileSync(path.resolve(__dirname, '../..', m.path), 'utf8'); if (!generate && hash(sql) !== m.sha256) throw new Error('MIGRATION_CHECKSUM_MISMATCH'); return { ...m, sql, sha256: hash(sql) }; });
  const validated = validate(files);
  if (!generate) {
    if (manifest.version !== 1 || !manifest.tables || stable(Object.keys(manifest.tables).sort()) !== stable([...validated.tables].sort())) throw new Error('INVALID_SCHEMA_MANIFEST');
    for (const table of validated.tables) {
      const spec = manifest.tables[table];
      if (spec?.storage?.engine !== 'InnoDB' || !Array.isArray(spec.columns) || !spec.columns.length || !Array.isArray(spec.indexes) || !Array.isArray(spec.foreignKeys)) throw new Error('INCOMPLETE_SCHEMA_MANIFEST');
    }
  }
  if (apply && !generate) {
    if (process.env.APPLY_REMEDIATION_SCHEMA !== 'true' || process.env.REMEDIATION_DATABASE_FINGERPRINT !== source.fingerprint) throw new Error('EXPLICIT_DATABASE_FINGERPRINT_REQUIRED');
    if (process.env.VERCEL_ENV === 'production' && (process.env.VERCEL_PROJECT_ID !== 'prj_c6GY3nlQvaw7h9vdZss8WTugWQ4v' || process.env.VERCEL_ORG_ID !== 'team_JXPumA8SQGBIWidvRoITA2dI')) throw new Error('PRODUCTION_PROJECT_MISMATCH');
  }
  const remote = !['127.0.0.1','localhost','::1'].includes(source.u.hostname);
  const ca = process.env.REMEDIATION_MYSQL_CA_FILE || source.u.searchParams.get('sslcert');
  const db = await mysql.createConnection({ host: source.u.hostname, port: Number(source.u.port || 3306), user: decodeURIComponent(source.u.username), password: decodeURIComponent(source.u.password), database: source.name, ssl: remote ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_PEM ? { ca: process.env.DATABASE_CA_PEM } : ca ? { ca: fs.readFileSync(ca) } : {}) } : undefined, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  let locked = false;
  try {
    await db.query('SET SESSION lock_wait_timeout = 10');
    await db.query('SET SESSION innodb_lock_wait_timeout = 15');
    await db.query('SET SESSION default_storage_engine = InnoDB');
    const [[lock]] = await db.execute("SELECT GET_LOCK('focus-remediation-schema-v1',10) locked"); if (Number(lock.locked) !== 1) throw new Error('SCHEMA_LOCK_BUSY'); locked = true;
    const before = await counts(db), initial = {};
    async function readParents() {
      const names = [...new Set(Object.values(manifest.tables || {}).flatMap(spec => spec.foreignKeys.map(fk => fk.targetTable)))].filter(name => !validated.tables.includes(name)).sort();
      const parents = {};
      for (const name of names) parents[name] = await shape(db, source.name, name);
      return parents;
    }
    const parents = generate ? {} : await readParents();
    const plan = generate ? { tables: manifest.tables || {}, parsed: validated.parsed, adaptations: [], resolvedPlanSha256: null, parentMetadataSha256: null } : resolvePortablePlan({ manifest, parsed: validated.parsed, parentShapes: parents, databaseFingerprint: source.fingerprint });
    const expectedTables = plan.tables;
    if (apply && !generate && process.env.REMEDIATION_RESOLVED_PLAN_SHA256 !== plan.resolvedPlanSha256) throw new Error('EXACT_RESOLVED_SCHEMA_PLAN_REQUIRED');
    for (const table of validated.tables) {
      const existing = await shape(db, source.name, table); initial[table] = existing;
      if (!generate && existing) {
        const expected = expectedTables[table];
        // A previous DDL attempt may have created a table before later FKs.
        if (!expected || stable(existing.storage) !== stable(expected.storage) || stable(existing.columns) !== stable(expected.columns) || existing.indexes.some((index) => !expected.indexes.some((v) => stable(v) === stable(index))) || existing.foreignKeys.some((fk) => !expected.foreignKeys.some((v) => stable(v) === stable(fk)))) throw new Error('EXISTING_ADDITIVE_TABLE_SCHEMA_MISMATCH');
      }
    }
    // Reject incompatible historical parent definitions before the first DDL.
    if (!generate) for (const table of validated.tables) {
      const spec = expectedTables[table];
      for (const fk of spec.foreignKeys) {
        const parent = expectedTables[fk.targetTable] || parents[fk.targetTable];
        const from = spec.columns.find((c) => c.name === fk.columnName), to = parent?.columns.find((c) => c.name === fk.targetColumn);
        if (!parent || parent.storage?.engine !== 'InnoDB' || !from || !to || from.type !== to.type || from.charsetName !== to.charsetName || from.collationName !== to.collationName || !parent.indexes.some((i) => i.columnName === fk.targetColumn && Number(i.sequence) === 1)) {
          console.log(JSON.stringify({ event:'remediation_foreign_key_preflight', childTable:table, childColumn:fk.columnName, parentTable:fk.targetTable, parentColumn:fk.targetColumn, expected:from ? {type:from.type,charset:from.charsetName,collation:from.collationName}:null, actual:to ? {type:to.type,charset:to.charsetName,collation:to.collationName,engine:parent.storage?.engine}:null }));
          throw new Error('FOREIGN_KEY_PARENT_INCOMPATIBLE');
        }
      }
    }
    if (apply && !generate) {
      const refreshed = resolvePortablePlan({ manifest, parsed: validated.parsed, parentShapes: await readParents(), databaseFingerprint: source.fingerprint });
      if (refreshed.resolvedPlanSha256 !== plan.resolvedPlanSha256) throw new Error('FOREIGN_KEY_PARENT_CHANGED_AFTER_PLAN');
    }
    if (apply || generate) for (const s of plan.parsed) {
      if (s.kind === 'create') { if (!initial[s.table]) await db.query(s.sql); }
      else {
        const existing = await shape(db, source.name, s.table);
        if (!existing.foreignKeys.some((f) => f.name === s.constraint)) await db.query(s.sql);
      }
    }
    const tables = {}, pending = [];
    for (const table of validated.tables) {
      tables[table] = await shape(db, source.name, table);
      if (!tables[table]) pending.push(table);
      else if (!generate && stable(tables[table]) !== stable(expectedTables[table])) throw new Error('FINAL_ADDITIVE_SCHEMA_MISMATCH');
    }
    const after = await counts(db);
    // Counts can legitimately change while users work. SQL restrictions are the
    // no-DML guarantee; drift is evidence to review, never a false rollback.
    const concurrentCountDrift = stable(before) !== stable(after);
    if (generate) fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, migrations: files.map(({ path,sha256 }) => ({path,sha256})), tables }, null, 2) + '\n');
    return { event: 'remediation_schema', ok: true, applied: Boolean(apply || generate), databaseFingerprint: source.fingerprint, additiveTableCount: validated.tables.length, pending, before, after, concurrentCountDrift, schemaSha256: hash(stable(tables)), adaptations: plan.adaptations, resolvedPlanSha256: plan.resolvedPlanSha256, parentMetadataSha256: plan.parentMetadataSha256 };
  } finally { if (locked) await db.query("SELECT RELEASE_LOCK('focus-remediation-schema-v1')").catch(() => {}); await db.end(); }
}
if (require.main === module) run({ generate: process.argv.includes('--generate-manifest'), apply: process.argv.includes('--apply') }).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(JSON.stringify({ event: 'remediation_schema', ok: false, code: /^[A-Z][A-Z0-9_]+$/.test(e.message || '') ? e.message : /^ER_[A-Z_]+$/.test(e.code || '') ? e.code : 'SCHEMA_CHECK_FAILED' })); process.exitCode = 1; });
module.exports = { statements, validate, run };
