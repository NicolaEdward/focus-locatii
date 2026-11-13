// Encrypted, consistent application-table backup and isolated restore verifier.
// Never prints records, passwords or connection URLs. Native provider backups
// remain necessary for infrastructure objects and point-in-time recovery.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { once } = require("node:events");
const mysql = require("mysql2");

const MAGIC = Buffer.from("FOCUSBK1");
const safeIdentifier = /^[A-Za-z0-9_]+$/;
const quote = (name) => { if (!safeIdentifier.test(name)) throw new Error("INVALID_DATABASE_IDENTIFIER"); return "`" + name + "`"; };
const digest = (x) => crypto.createHash("sha256").update(x).digest("hex");
const option = (name) => process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
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
function key() {
  const result = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
  if (result.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_REQUIRES_32_RANDOM_BYTES_BASE64");
  return result;
}
function connection(value, withoutDatabase = false) {
  const { u, name } = identity(value);
  const remote = !["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const ca = process.env.BACKUP_MYSQL_CA_FILE || u.searchParams.get("sslcert");
  return mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: withoutDatabase ? undefined : name,
    ssl: remote ? { rejectUnauthorized: true, ...(ca ? { ca: fs.readFileSync(ca) } : {}) } : undefined,
    supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true,
    multipleStatements: false, connectTimeout: 10000
  });
}
function encode(v) { return Buffer.isBuffer(v) ? { binaryBase64: v.toString("base64") } : v; }
function rowRecord(row, columns) { return columns.map((k) => encode(row[k])); }
async function write(stream, value) { if (!stream.write(value)) await once(stream, "drain"); }
async function tableChecksum(conn, table, columns) {
  const hashes = []; let count = 0;
  for await (const row of conn.query(`SELECT * FROM ${quote(table)}`).stream({ highWaterMark: 32 })) {
    hashes.push(digest(JSON.stringify(rowRecord(row, columns)))); count++;
  }
  hashes.sort(); return { count, hash: digest(hashes.join("\n")) };
}
async function backup(value, output) {
  const source = identity(value);
  if ((process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production") && process.env.ALLOW_PRODUCTION_BACKUP !== "true") throw new Error("PRODUCTION_BACKUP_REQUIRES_EXPLICIT_ENABLE");
  const master = key(), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.hkdfSync("sha256", master, salt, Buffer.from("focus-backup-v1"), 32), iv);
  cipher.setAAD(header);
  const conn = connection(value), db = conn.promise(); let out, outputCreated = false;
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    await db.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [objects] = await db.query("SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [source.name]);
    const [triggers] = await db.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [source.name]);
    const [routines] = await db.query("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?", [source.name]);
    if (objects.some((r) => r.TABLE_TYPE !== "BASE TABLE") || triggers.length || routines.length) throw new Error("USE_PROVIDER_BACKUP_FOR_VIEWS_TRIGGERS_OR_ROUTINES");
    out = fs.createWriteStream(output, { flags: "wx", mode: 0o600 });
    out.on("error", () => {});
    await once(out, "open"); outputCreated = true; await write(out, header);
    const record = async (data) => write(out, cipher.update(JSON.stringify(data) + "\n"));
    await record({ type: "manifest", version: 1, createdAt: new Date().toISOString(), sourceFingerprint: source.fingerprint, sourceDatabase: source.name, tableCount: objects.length });
    const tables = {};
    for (const object of objects) {
      const table = object.TABLE_NAME;
      const [ddl] = await db.query(`SHOW CREATE TABLE ${quote(table)}`);
      const [columns] = await db.query(`SHOW COLUMNS FROM ${quote(table)}`);
      const names = columns.map((r) => r.Field); names.forEach(quote);
      const createSql = ddl[0]["Create Table"];
      await record({ type: "table", table, columns: names, createSql });
      const hashes = []; let count = 0;
      for await (const row of conn.query(`SELECT * FROM ${quote(table)}`).stream({ highWaterMark: 32 })) {
        const values = rowRecord(row, names); hashes.push(digest(JSON.stringify(values))); count++;
        await record({ type: "row", table, values });
      }
      const [after] = await db.query(`SHOW CREATE TABLE ${quote(table)}`);
      if (after[0]["Create Table"] !== createSql) throw new Error("SCHEMA_CHANGED_DURING_BACKUP");
      hashes.sort(); tables[table] = { count, hash: digest(hashes.join("\n")) };
    }
    await record({ type: "checksums", tables });
    await db.query("COMMIT");
    await write(out, cipher.final()); await write(out, cipher.getAuthTag()); out.end(); await once(out, "finish");
    const encryptedSha256 = digest(await fsp.readFile(output));
    return { version: 1, action: "backup", ok: true, createdAt: new Date().toISOString(), sourceFingerprint: source.fingerprint, encryptedSha256, tables };
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch {}
    if (out) out.destroy();
    if (outputCreated) await fsp.unlink(output).catch(() => {});
    throw error;
  } finally { conn.destroy(); }
}
async function restore(value, input) {
  const target = identity(value);
  if (process.env.VERCEL_ENV === "production" || !["ci", "test", "preview", "staging"].includes(process.env.APP_ENV || "")) throw new Error("RESTORE_ONLY_IN_ISOLATED_NON_PRODUCTION");
  if (!/(preview|restore|test)/i.test(target.name) || process.env.RESTORE_DATABASE_CONFIRM !== target.name) throw new Error("RESTORE_TARGET_CONFIRMATION_REQUIRED");
  // Authentication is verified before connecting to or modifying the target.
  const encrypted = await fsp.readFile(input);
  if (encrypted.length < 52 || !encrypted.subarray(0, 8).equals(MAGIC)) throw new Error("INVALID_BACKUP_FORMAT");
  const header = encrypted.subarray(0, 36), salt = header.subarray(8, 24), iv = header.subarray(24, 36);
  const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.hkdfSync("sha256", key(), salt, Buffer.from("focus-backup-v1"), 32), iv);
  decipher.setAAD(header); decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(36, -16)), decipher.final()]);
  const records = plain.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const manifest = records[0], checksums = records.at(-1);
  if (manifest?.type !== "manifest" || manifest.version !== 1 || checksums?.type !== "checksums") throw new Error("INVALID_BACKUP_MANIFEST");
  if (manifest.sourceFingerprint === target.fingerprint || manifest.sourceDatabase === target.name) throw new Error("CANNOT_RESTORE_OVER_SOURCE_DATABASE");
  const conn = connection(value, true), db = conn.promise(); const started = Date.now();
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    const [databases] = await db.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [target.name]);
    if (!databases.length) {
      if (process.env.CREATE_ISOLATED_RESTORE_DATABASE !== "true") throw new Error("RESTORE_DATABASE_MUST_EXIST");
      await db.query(`CREATE DATABASE ${quote(target.name)} CHARACTER SET utf8mb4`);
    }
    await db.query(`USE ${quote(target.name)}`);
    const [existing] = await db.query("SHOW TABLES"); if (existing.length) throw new Error("RESTORE_TARGET_MUST_BE_EMPTY");
    await db.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    const columns = new Map();
    for (const r of records.slice(1, -1)) {
      quote(r.table);
      if (r.type === "table") {
        if (columns.has(r.table) || !/^CREATE TABLE\s/i.test(r.createSql)) throw new Error("INVALID_TABLE_RECORD");
        r.columns.forEach(quote); columns.set(r.table, r.columns); await db.query(r.createSql);
      } else if (r.type === "row") {
        const cols = columns.get(r.table);
        if (!cols || cols.length !== r.values.length) throw new Error("INVALID_ROW_RECORD");
        const values = r.values.map((v) => v && typeof v === "object" && Object.keys(v).length === 1 && typeof v.binaryBase64 === "string" ? Buffer.from(v.binaryBase64, "base64") : v);
        await db.query(`INSERT INTO ${quote(r.table)} (${cols.map(quote).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, values);
      } else throw new Error("UNKNOWN_BACKUP_RECORD");
    }
    await db.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    if (columns.size !== manifest.tableCount || columns.size !== Object.keys(checksums.tables).length) throw new Error("TABLE_COUNT_MISMATCH");
    for (const [table, cols] of columns) {
      const actual = await tableChecksum(conn, table, cols), expected = checksums.tables[table];
      if (!expected || actual.count !== expected.count || actual.hash !== expected.hash) throw new Error("RESTORE_CHECKSUM_MISMATCH");
    }
    return { version: 1, action: "restore_verification", ok: true, verifiedAt: new Date().toISOString(), sourceFingerprint: manifest.sourceFingerprint, targetFingerprint: target.fingerprint, encryptedSha256: digest(encrypted), tables: checksums.tables, durationMs: Date.now() - started };
  } finally { conn.destroy(); }
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
