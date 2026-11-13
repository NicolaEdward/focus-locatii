// Encrypted, consistent application-table backup and isolated restore verifier.
// Provider backups remain necessary for infrastructure objects and PITR.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { pipeline } = require("node:stream/promises");
const readline = require("node:readline");
const mysql = require("mysql2");

const MAGIC = Buffer.from("FOCUSBK1"), HEADER_BYTES = 36, TAG_BYTES = 16;
const MAX_RECORD_BYTES = 64 * 1024 * 1024, HASH_BATCH = 16_384, MERGE_FAN_IN = 32;
const RESTORE_SQL_MODE = "STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO,NO_ENGINE_SUBSTITUTION";
const safeIdentifier = /^[A-Za-z0-9_]+$/;
const quote = (name) => { if (typeof name !== "string" || !safeIdentifier.test(name)) throw new Error("INVALID_DATABASE_IDENTIFIER"); return "`" + name + "`"; };
const digest = (x) => crypto.createHash("sha256").update(x).digest("hex");
const option = (name) => process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function key() {
  const result = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
  if (result.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_REQUIRES_32_RANDOM_BYTES_BASE64");
  return result;
}
function signReceipt(result) {
  return { ...result, signature: crypto.createHmac("sha256", crypto.hkdfSync("sha256", key(), Buffer.alloc(0), Buffer.from("focus-backup-receipt-v1"), 32)).update(canonical(result)).digest("base64url") };
}
function identity(value) {
  const u = new URL(value);
  if (u.protocol !== "mysql:") throw new Error("MYSQL_URL_REQUIRED");
  const name = decodeURIComponent(u.pathname.slice(1)); quote(name);
  return { u, name, fingerprint: digest(`${u.protocol}//${u.hostname}:${u.port || "default"}/${name}`).slice(0, 12) };
}
const hostname = (u) => u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
const isLocal = (u) => ["localhost", "127.0.0.1", "::1"].includes(hostname(u));
function protectedIdentity(candidate) {
  return ["PRODUCTION_DATABASE_URL", "PROD_DATABASE_URL", "LIVE_DATABASE_URL"].some((name) => {
    if (!process.env[name]) return false;
    const configured = identity(process.env[name]);
    return configured.name === candidate.name &&
      (hostname(configured.u) === hostname(candidate.u) || (isLocal(configured.u) && isLocal(candidate.u))) &&
      Number(configured.u.port || 3306) === Number(candidate.u.port || 3306);
  });
}
function assertRestoreTarget(target) {
  if (process.env.VERCEL_ENV === "production" || !["ci", "test", "preview", "staging"].includes(process.env.APP_ENV || "") || protectedIdentity(target)) throw new Error("RESTORE_ONLY_IN_ISOLATED_NON_PRODUCTION");
  if (!/^focus_(preview|restore|test)_[A-Za-z0-9_]+$/.test(target.name) || process.env.RESTORE_DATABASE_CONFIRM !== target.name) throw new Error("RESTORE_TARGET_CONFIRMATION_REQUIRED");
  const allowedHosts = (process.env.RESTORE_ALLOWED_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!isLocal(target.u) && !allowedHosts.includes(hostname(target.u))) throw new Error("REMOTE_RESTORE_HOST_REQUIRES_EXPLICIT_ALLOWLIST");
}
function connection(value, withoutDatabase = false) {
  const { u, name } = identity(value);
  const ca = process.env.BACKUP_MYSQL_CA_FILE || u.searchParams.get("sslcert");
  return mysql.createConnection({
    host: hostname(u), port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: withoutDatabase ? undefined : name,
    ssl: !isLocal(u) ? { rejectUnauthorized: true, ...(ca ? { ca: fs.readFileSync(ca) } : {}) } : undefined,
    supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true,
    charset: "utf8mb4", multipleStatements: false, connectTimeout: 10000
  });
}
function encode(v) {
  if (Buffer.isBuffer(v)) return { binaryBase64: v.toString("base64") };
  if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
  throw new Error("UNSUPPORTED_COLUMN_VALUE_USE_PROVIDER_BACKUP");
}
function decode(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.binaryBase64 === "string") {
    const data = Buffer.from(v.binaryBase64, "base64");
    if (data.toString("base64") !== v.binaryBase64) throw new Error("INVALID_BINARY_RECORD");
    return data;
  }
  return encode(v);
}
function rowRecord(row) { return row.map(encode); }
async function write(stream, value) {
  if (stream.destroyed) throw new Error("BACKUP_STREAM_CLOSED");
  if (!stream.write(value)) await once(stream, "drain");
}
async function privateWorkspace() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "focus-backup-private-"));
  await fsp.chmod(dir, 0o700); return dir;
}
async function fileDigest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// Preserve the original v1 sorted-row SHA256 contract using bounded disk runs.
// Only a fixed-size batch of row hashes is retained in memory, even for huge tables.
class RowChecksum {
  constructor(workspace) { this.workspace = workspace; this.hashes = []; this.files = []; this.count = 0; }
  async add(values) { this.hashes.push(digest(JSON.stringify(values))); this.count++; if (this.hashes.length >= HASH_BATCH) await this.flush(); }
  async flush() {
    if (!this.hashes.length) return;
    this.hashes.sort();
    const file = path.join(this.workspace, crypto.randomUUID() + ".hashes");
    await fsp.writeFile(file, this.hashes.join("\n") + "\n", { flag: "wx", mode: 0o600 });
    this.files.push(file); this.hashes = [];
  }
  async finish() {
    if (!this.files.length) { this.hashes.sort(); return { count: this.count, hash: digest(this.hashes.join("\n")) }; }
    await this.flush();
    while (this.files.length > MERGE_FAN_IN) {
      const next = [];
      for (let i = 0; i < this.files.length; i += MERGE_FAN_IN) {
        const group = this.files.slice(i, i + MERGE_FAN_IN), output = path.join(this.workspace, crypto.randomUUID() + ".hashes");
        const stream = fs.createWriteStream(output, { flags: "wx", mode: 0o600 });
        stream.on("error", () => {});
        try { for await (const line of mergeHashes(group)) await write(stream, line + "\n"); stream.end(); await once(stream, "finish"); }
        catch (error) { stream.destroy(); throw error; }
        await Promise.all(group.map((file) => fsp.unlink(file))); next.push(output);
      }
      this.files = next;
    }
    const hash = crypto.createHash("sha256"); let first = true;
    for await (const line of mergeHashes(this.files)) { if (!first) hash.update("\n"); hash.update(line); first = false; }
    await Promise.all(this.files.map((file) => fsp.unlink(file)));
    return { count: this.count, hash: hash.digest("hex") };
  }
}
async function* mergeHashes(files) {
  const streams = files.map((file) => fs.createReadStream(file));
  const readers = streams.map((stream) => readline.createInterface({ input: stream, crlfDelay: Infinity }));
  const iterators = readers.map((reader) => reader[Symbol.asyncIterator]());
  try {
    const heads = await Promise.all(iterators.map((iterator) => iterator.next()));
    while (true) {
      let selected = -1;
      for (let i = 0; i < heads.length; i++) if (!heads[i].done && (selected < 0 || heads[i].value < heads[selected].value)) selected = i;
      if (selected < 0) return;
      yield heads[selected].value; heads[selected] = await iterators[selected].next();
    }
  } finally { readers.forEach((reader) => reader.close()); streams.forEach((stream) => stream.destroy()); }
}
async function tableChecksum(conn, table, columns, workspace) {
  const checksum = new RowChecksum(workspace);
  for await (const row of conn.query({ sql: `SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}`, rowsAsArray: true }).stream({ highWaterMark: 1 })) await checksum.add(rowRecord(row));
  return checksum.finish();
}
async function inventory(db, name) {
  const [objects] = await db.query("SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [name]);
  const [triggers] = await db.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [name]);
  const [routines] = await db.query("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?", [name]);
  const [events] = await db.query("SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?", [name]);
  if (objects.some((r) => r.TABLE_TYPE !== "BASE TABLE" || r.ENGINE !== "InnoDB") || triggers.length || routines.length || events.length) throw new Error("USE_PROVIDER_BACKUP_FOR_UNSUPPORTED_DATABASE_OBJECTS");
  return objects;
}
function validateColumns(columns) {
  if (!columns.length || columns.some((r) => /(?:VIRTUAL|STORED) GENERATED|INVISIBLE/i.test(r.Extra || "") || /^(?:geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)\b/i.test(r.Type || ""))) throw new Error("USE_PROVIDER_BACKUP_FOR_UNSUPPORTED_COLUMNS");
  columns.forEach((r) => quote(r.Field));
}
function validateDdl(table, sql) {
  if (typeof sql !== "string" || !sql.startsWith("CREATE TABLE " + quote(table) + " (") || !/ENGINE=InnoDB\b/i.test(sql) || /REFERENCES\s+(?:`[^`]+`|\w+)\s*\./i.test(sql)) throw new Error("UNSUPPORTED_TABLE_DDL_USE_PROVIDER_BACKUP");
}
// Concurrent DML can advance the allocator without changing the schema. It must
// not invalidate an otherwise consistent snapshot or hide any column definition.
const comparableDdl = (sql) => sql.replace(/\) ENGINE=InnoDB AUTO_INCREMENT=\d+ /, ") ENGINE=InnoDB ");
async function backup(value, output) {
  const source = identity(value);
  if ((process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production" || protectedIdentity(source)) && process.env.ALLOW_PRODUCTION_BACKUP !== "true") throw new Error("PRODUCTION_BACKUP_REQUIRES_EXPLICIT_ENABLE");
  const master = key(), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.hkdfSync("sha256", master, salt, Buffer.from("focus-backup-v1"), 32), iv);
  cipher.setAAD(header);
  const workspace = await privateWorkspace(); let conn, db, out, outputCreated = false;
  try {
    conn = connection(value); db = conn.promise();
    await db.query("SET SESSION time_zone = '+00:00'");
    await db.query("SET SESSION sql_mode = ?", [RESTORE_SQL_MODE]);
    await db.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const snapshotStartedAt = new Date().toISOString();
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const objects = await inventory(db, source.name);
    if (!objects.length) throw new Error("BACKUP_REQUIRES_APPLICATION_TABLES");
    out = fs.createWriteStream(output, { flags: "wx", mode: 0o600 }); out.on("error", () => {});
    await once(out, "open"); outputCreated = true; await write(out, header);
    const record = async (data) => {
      const line = JSON.stringify(data) + "\n";
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error("BACKUP_RECORD_TOO_LARGE_USE_PROVIDER_BACKUP");
      await write(out, cipher.update(line));
    };
    await record({ type: "manifest", version: 1, createdAt: snapshotStartedAt, sourceFingerprint: source.fingerprint, sourceDatabase: source.name, tableCount: objects.length });
    const tables = Object.create(null);
    for (const object of objects) {
      const table = object.TABLE_NAME;
      const [ddl] = await db.query(`SHOW CREATE TABLE ${quote(table)}`);
      const [columns] = await db.query(`SHOW FULL COLUMNS FROM ${quote(table)}`); validateColumns(columns);
      const names = columns.map((r) => r.Field), createSql = ddl[0]["Create Table"]; validateDdl(table, createSql);
      await record({ type: "table", table, columns: names, createSql });
      const checksum = new RowChecksum(workspace);
      for await (const row of conn.query({ sql: `SELECT ${names.map(quote).join(",")} FROM ${quote(table)}`, rowsAsArray: true }).stream({ highWaterMark: 1 })) {
        const values = rowRecord(row); await checksum.add(values); await record({ type: "row", table, values });
      }
      const [after] = await db.query(`SHOW CREATE TABLE ${quote(table)}`);
      if (comparableDdl(after[0]["Create Table"]) !== comparableDdl(createSql)) throw new Error("SCHEMA_CHANGED_DURING_BACKUP");
      tables[table] = await checksum.finish();
    }
    if (canonical(await inventory(db, source.name)) !== canonical(objects)) throw new Error("SCHEMA_CHANGED_DURING_BACKUP");
    await record({ type: "checksums", tables }); await db.query("COMMIT");
    await write(out, cipher.final()); await write(out, cipher.getAuthTag()); out.end(); await once(out, "finish");
    return { version: 1, action: "backup", ok: true, createdAt: snapshotStartedAt, completedAt: new Date().toISOString(), sourceFingerprint: source.fingerprint, encryptedSha256: await fileDigest(output), tables: Object.fromEntries(Object.entries(tables)) };
  } catch (error) {
    try { if (db) await db.query("ROLLBACK"); } catch {}
    if (out) out.destroy();
    if (outputCreated) await fsp.unlink(output).catch(() => {});
    throw error;
  } finally { if (conn) conn.destroy(); await fsp.rm(workspace, { recursive: true, force: true }); }
}

// No database connection is created until GCM authentication and the entire
// record/checksum preflight pass. Unauthenticated plaintext exists only in an
// owner-only temporary directory and is removed on every exit path.
async function decryptToPrivateFile(input, workspace) {
  const source = await fsp.open(input, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const plainFile = path.join(workspace, "authenticated.ndjson");
  try {
    const stat = await source.stat();
    if (!stat.isFile() || stat.size <= HEADER_BYTES + TAG_BYTES) throw new Error("INVALID_BACKUP_FORMAT");
    const header = Buffer.alloc(HEADER_BYTES), tag = Buffer.alloc(TAG_BYTES);
    if ((await source.read(header, 0, header.length, 0)).bytesRead !== header.length || !header.subarray(0, MAGIC.length).equals(MAGIC) || (await source.read(tag, 0, tag.length, stat.size - TAG_BYTES)).bytesRead !== tag.length) throw new Error("INVALID_BACKUP_FORMAT");
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.hkdfSync("sha256", key(), header.subarray(8, 24), Buffer.from("focus-backup-v1"), 32), header.subarray(24, 36));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    const encryptedHash = crypto.createHash("sha256").update(header);
    const ciphertext = source.createReadStream({ start: HEADER_BYTES, end: stat.size - TAG_BYTES - 1, autoClose: false });
    ciphertext.on("data", (chunk) => encryptedHash.update(chunk));
    try { await pipeline(ciphertext, decipher, fs.createWriteStream(plainFile, { flags: "wx", mode: 0o600 })); }
    catch { throw new Error("BACKUP_AUTHENTICATION_OR_STREAM_FAILED"); }
    encryptedHash.update(tag);
    return { plainFile, encryptedSha256: encryptedHash.digest("hex") };
  } finally { await source.close(); }
}
async function* records(file) {
  let parts = [], length = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 64 * 1024 })) {
    let start = 0, end;
    while ((end = chunk.indexOf(10, start)) !== -1) {
      const part = chunk.subarray(start, end); length += part.length;
      if (length > MAX_RECORD_BYTES) throw new Error("BACKUP_RECORD_TOO_LARGE_USE_PROVIDER_BACKUP");
      parts.push(part);
      let row;
      try { row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, length))); }
      catch { throw new Error("INVALID_BACKUP_RECORD"); }
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("INVALID_BACKUP_RECORD");
      yield row; parts = []; length = 0; start = end + 1;
    }
    if (start < chunk.length) { parts.push(chunk.subarray(start)); length += chunk.length - start; }
    if (length > MAX_RECORD_BYTES) throw new Error("BACKUP_RECORD_TOO_LARGE_USE_PROVIDER_BACKUP");
  }
  if (length) throw new Error("TRUNCATED_BACKUP_RECORD");
}
async function validateArchive(file, target, workspace) {
  let manifest, checksums, currentTable, currentChecksum;
  const tables = new Map(), computed = Object.create(null);
  for await (const record of records(file)) {
    if (!manifest) {
      if (record.type !== "manifest" || record.version !== 1 || !Number.isSafeInteger(record.tableCount) || record.tableCount < 1 || record.tableCount > 10000 || !/^[a-f0-9]{12}$/.test(record.sourceFingerprint)) throw new Error("INVALID_BACKUP_MANIFEST");
      quote(record.sourceDatabase);
      if (record.sourceFingerprint === target.fingerprint || record.sourceDatabase === target.name) throw new Error("CANNOT_RESTORE_OVER_SOURCE_DATABASE");
      manifest = record; continue;
    }
    if (checksums) throw new Error("RECORD_AFTER_CHECKSUMS");
    if (record.type === "table") {
      quote(record.table); validateDdl(record.table, record.createSql);
      if (tables.has(record.table) || !Array.isArray(record.columns) || !record.columns.length || record.columns.length > 4096 || new Set(record.columns).size !== record.columns.length) throw new Error("INVALID_TABLE_RECORD");
      record.columns.forEach(quote);
      if (currentChecksum) computed[currentTable] = await currentChecksum.finish();
      currentTable = record.table; currentChecksum = new RowChecksum(workspace); tables.set(record.table, record.columns);
    } else if (record.type === "row") {
      if (record.table !== currentTable || !Array.isArray(record.values) || record.values.length !== tables.get(currentTable)?.length) throw new Error("INVALID_ROW_RECORD");
      record.values.forEach(decode); await currentChecksum.add(record.values);
    } else if (record.type === "checksums") {
      if (currentChecksum) computed[currentTable] = await currentChecksum.finish();
      checksums = record;
    } else throw new Error("UNKNOWN_BACKUP_RECORD");
  }
  if (!manifest || !checksums || !checksums.tables || typeof checksums.tables !== "object" || Array.isArray(checksums.tables) || tables.size !== manifest.tableCount || tables.size !== Object.keys(checksums.tables).length) throw new Error("INVALID_BACKUP_MANIFEST");
  for (const [table] of tables) {
    const expected = checksums.tables[table], actual = computed[table];
    if (!expected || !Number.isSafeInteger(expected.count) || expected.count < 0 || !/^[a-f0-9]{64}$/.test(expected.hash) || actual.count !== expected.count || actual.hash !== expected.hash) throw new Error("BACKUP_RECORD_CHECKSUM_MISMATCH");
  }
  return { manifest, checksums, tables };
}
async function restore(value, input) {
  const target = identity(value); assertRestoreTarget(target); key();
  const workspace = await privateWorkspace(), started = Date.now(); let conn;
  try {
    const { plainFile, encryptedSha256 } = await decryptToPrivateFile(input, workspace);
    const { manifest, checksums, tables } = await validateArchive(plainFile, target, workspace);
    conn = connection(value, true); const db = conn.promise();
    const [restoreLock] = await db.query("SELECT GET_LOCK(?, 0) AS acquired", ["focus-restore:" + target.fingerprint]);
    if (Number(restoreLock[0]?.acquired) !== 1) throw new Error("RESTORE_TARGET_ALREADY_IN_USE");
    await db.query("SET SESSION time_zone = '+00:00'");
    // Preserve explicit AUTO_INCREMENT zero values and zero dates while retaining
    // strict coercion checks. Prepared row values do not depend on SQL escaping mode.
    await db.query("SET SESSION sql_mode = ?", [RESTORE_SQL_MODE]);
    const [databases] = await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [target.name]);
    if (!databases.length) {
      if (process.env.CREATE_ISOLATED_RESTORE_DATABASE !== "true") throw new Error("RESTORE_DATABASE_MUST_EXIST");
      await db.query(`CREATE DATABASE ${quote(target.name)} CHARACTER SET utf8mb4`);
    }
    await db.query(`USE ${quote(target.name)}`);
    const [existing] = await db.query("SHOW TABLES"); if (existing.length) throw new Error("RESTORE_TARGET_MUST_BE_EMPTY");
    // An apparently empty schema can still contain routines or scheduled events.
    // Those must not execute against tables being restored into it.
    try { await inventory(db, target.name); }
    catch (error) {
      if (error.message === "USE_PROVIDER_BACKUP_FOR_UNSUPPORTED_DATABASE_OBJECTS") throw new Error("RESTORE_TARGET_MUST_BE_EMPTY");
      throw error;
    }
    await db.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    for await (const r of records(plainFile)) {
      if (r.type === "table") await db.query(r.createSql);
      else if (r.type === "row") {
        const cols = tables.get(r.table);
        await db.execute(`INSERT INTO ${quote(r.table)} (${cols.map(quote).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, r.values.map(decode));
      }
    }
    await db.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    for (const [table, cols] of tables) {
      const actual = await tableChecksum(conn, table, cols, workspace), expected = checksums.tables[table];
      if (actual.count !== expected.count || actual.hash !== expected.hash) throw new Error("RESTORE_CHECKSUM_MISMATCH");
    }
    return { version: 1, action: "restore_verification", ok: true, verifiedAt: new Date().toISOString(), sourceFingerprint: manifest.sourceFingerprint, targetFingerprint: target.fingerprint, encryptedSha256, tables: checksums.tables, durationMs: Date.now() - started };
  } finally { if (conn) conn.destroy(); await fsp.rm(workspace, { recursive: true, force: true }); }
}
async function main() {
  const action = process.argv[2];
  const result = signReceipt(action === "backup" ? await backup(process.env.DATABASE_URL, option("--output")) : action === "restore" ? await restore(process.env.DATABASE_URL, option("--input")) : (() => { throw new Error("USE_BACKUP_OR_RESTORE_COMMAND"); })());
  const receipt = option("--receipt"); if (receipt) await fsp.writeFile(receipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch((error) => {
  const code = /^[A-Z0-9_]+$/.test(error.message || "") ? error.message : /^ER_[A-Z_]+$/.test(error.code || "") ? error.code : "BACKUP_OR_RESTORE_FAILED";
  console.error(JSON.stringify({ ok: false, errorCode: code })); process.exitCode = 1;
});
module.exports = { backup, restore, identity, signReceipt };
