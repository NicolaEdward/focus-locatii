const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const nativeFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const callbackMysql = require("mysql2");
const { backup, restore, identity } = require("./release/database-backup.cjs");
const { loadTsModule } = require("./load-ts-module.cjs");

async function sha(file) { const hash = crypto.createHash("sha256"); for await (const chunk of nativeFs.createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
function encryptedRecords(records) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), header = Buffer.concat([Buffer.from("FOCUSBK1"), salt, iv]);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.hkdfSync("sha256", Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "base64"), salt, Buffer.from("focus-backup-v1"), 32), iv);
  cipher.setAAD(header);
  return Buffer.concat([header, cipher.update(records.map((row) => JSON.stringify(row)).join("\n") + "\n"), cipher.final(), cipher.getAuthTag()]);
}
async function main() {
  const configured = identity(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(configured.u.hostname) && /^focus_preview_/.test(configured.name) && ["ci", "test", "preview"].includes(process.env.APP_ENV) && process.env.VERCEL_ENV !== "production", "Only local synthetic databases are allowed");
  const suffix = crypto.randomBytes(5).toString("hex"), sourceName = "focus_preview_backup_fixture_" + suffix, targetName = "focus_preview_restore_fixture_" + suffix, authName = "focus_preview_restore_auth_" + suffix;
  const sourceUrl = new URL(configured.u); sourceUrl.pathname = "/" + sourceName;
  const targetUrl = new URL(configured.u); targetUrl.pathname = "/" + targetName;
  const authUrl = new URL(configured.u); authUrl.pathname = "/" + authName;
  const admin = await mysql.createConnection({ host: configured.u.hostname, port: Number(configured.u.port || 3306), user: decodeURIComponent(configured.u.username), password: decodeURIComponent(configured.u.password), charset: "utf8mb4", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "focus-backup-fixture-test-")), file = path.join(dir, "fidelity.enc");
  const saved = { key: process.env.BACKUP_ENCRYPTION_KEY, confirmation: process.env.RESTORE_DATABASE_CONFIRM, create: process.env.CREATE_ISOLATED_RESTORE_DATABASE, hosts: process.env.RESTORE_ALLOWED_HOSTS, production: process.env.PRODUCTION_DATABASE_URL };
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64"); process.env.CREATE_ISOLATED_RESTORE_DATABASE = "true"; delete process.env.RESTORE_ALLOWED_HOSTS;
  const readFile = fs.readFile, mkdtemp = fs.mkdtemp, createdPrivateDirs = [];
  let backupConnections = 0, injectConcurrentInsert = false, concurrentInsertProven = false;
  const createConnection = callbackMysql.createConnection;
  callbackMysql.createConnection = (...args) => {
    backupConnections++; const conn = createConnection(...args), promise = conn.promise.bind(conn);
    conn.promise = () => {
      const db = promise(), query = db.query.bind(db);
      db.query = async (...queryArgs) => {
        const result = await query(...queryArgs);
        if (injectConcurrentInsert && queryArgs[0] === "SHOW CREATE TABLE `a_concurrent`") {
          injectConcurrentInsert = false;
          await admin.query("INSERT INTO `" + sourceName + "`.a_concurrent(value) VALUES(2)");
          concurrentInsertProven = true;
        }
        return result;
      };
      return db;
    };
    return conn;
  };
  fs.readFile = async (filename, ...args) => { if (String(filename).startsWith(dir)) throw Error("Whole-archive readFile is forbidden"); return readFile(filename, ...args); };
  fs.mkdtemp = async (...args) => {
    const folder = await mkdtemp(...args);
    if (String(args[0]).includes("focus-backup-private-")) { assert.equal((await fs.stat(folder)).mode & 0o777, 0o700); createdPrivateDirs.push(folder); }
    return folder;
  };
  try {
    await admin.query("CREATE DATABASE `" + sourceName + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
    await admin.query("USE `" + sourceName + "`");
    await admin.query("SET SESSION time_zone = '+00:00'");
    await admin.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_AUTO_VALUE_ON_ZERO,NO_ENGINE_SUBSTITUTION'");
    await admin.query("CREATE TABLE a_concurrent(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, value INT) ENGINE=InnoDB");
    await admin.query("INSERT INTO a_concurrent(value) VALUES(1)");
    await admin.query("CREATE TABLE fidelity (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, big_unsigned BIGINT UNSIGNED, big_signed BIGINT, precise_value DECIMAL(38,12), dt DATETIME(6), zero_date DATE, ts TIMESTAMP(6) NULL, bits BIT(12), raw_bytes VARBINARY(100), fixed_bytes BINARY(4), payload LONGBLOB, txt LONGTEXT, doc JSON) ENGINE=InnoDB");
    const blob = Buffer.alloc(192 * 1024); for (let i = 0; i < blob.length; i++) blob[i] = i % 256;
    const text = "NUL:\0 emoji:😀 quotes:'\" backslash:\\ newline:\n".repeat(1000);
    await admin.execute("INSERT INTO fidelity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", ["0", "18446744073709551615", "-9223372036854775808", "12345678901234567890123456.123456789012", "2024-02-29 12:34:56.123456", "0000-00-00", "2024-02-29 23:59:59.654321", Buffer.from([10, 255]), Buffer.from([0, 1, 92, 39, 255]), Buffer.from([0, 1, 2, 255]), blob, text, JSON.stringify({ binaryBase64: "ordinary JSON text", quote: "'\\\0😀", value: "999999999999999999.01" })]);
    await admin.execute("INSERT INTO fidelity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", ["9223372036854775808", null, null, "-0.000000000001", null, null, null, null, null, null, null, "", JSON.stringify([null, true, { nested: 1 }])]);
    await admin.query("CREATE TABLE duplicate_rows (label VARCHAR(100), value INT) ENGINE=InnoDB");
    await admin.query("INSERT INTO duplicate_rows VALUES ('same',1),('same',1),(NULL,NULL)");
    await admin.query("CREATE TABLE spill_rows (id INT PRIMARY KEY, label VARCHAR(40)) ENGINE=InnoDB");
    for (let start = 0; start < 17000; start += 1000) {
      const values = Array.from({ length: Math.min(1000, 17000 - start) }, (_, i) => [start + i, "synthetic-'\\-" + ((start + i) % 10)]);
      await admin.query("INSERT INTO spill_rows VALUES " + values.map(() => "(?,?)").join(","), values.flat());
    }
    injectConcurrentInsert = true;
    const before = await backup(sourceUrl.toString(), file), originalHash = await sha(file);
    assert.equal(concurrentInsertProven, true); assert.equal(before.tables.a_concurrent.count, 1, "snapshot excludes an insert committed after transaction start");
    assert.equal(before.encryptedSha256, originalHash); assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(backup(sourceUrl.toString(), file), (error) => error.code === "EEXIST"); assert.equal(await sha(file), originalHash);
    const receipt = loadTsModule(path.join(process.cwd(), "src/lib/backup-receipts.ts"));
    const { signReceipt } = require("./release/database-backup.cjs");
    assert.equal(receipt.verifyBackupReceipt(signReceipt(before), before.sourceFingerprint).tableCount, 4);
    process.env.RESTORE_DATABASE_CONFIRM = targetName;
    const restored = await restore(targetUrl.toString(), file); assert.deepEqual(restored.tables, before.tables);
    assert.equal(receipt.verifyRestoreReceipt(signReceipt(restored), before.sourceFingerprint).tableCount, 4);
    const [restoredSnapshot] = await admin.query("SELECT COUNT(*) AS count FROM `" + targetName + "`.a_concurrent"); assert.equal(Number(restoredSnapshot[0].count), 1);
    const [expected] = await admin.query({ sql: "SELECT * FROM `" + sourceName + "`.fidelity ORDER BY id", rowsAsArray: true });
    const [actual] = await admin.query({ sql: "SELECT * FROM `" + targetName + "`.fidelity ORDER BY id", rowsAsArray: true });
    assert.deepEqual(actual, expected, "date/UTC/microseconds/zero/decimal/bigint/binary/text/JSON fidelity");
    assert.equal(actual[0][0], "0", "AUTO_INCREMENT zero must remain zero");
    assert.equal(actual[0][3], "12345678901234567890123456.123456789012");
    assert.equal(actual[0][6], "2024-02-29 23:59:59.654321");
    await assert.rejects(restore(targetUrl.toString(), file), /RESTORE_TARGET_MUST_BE_EMPTY/);

    process.env.RESTORE_DATABASE_CONFIRM = authName;
    const corrupt = path.join(dir, "corrupt.enc"); await fs.copyFile(file, corrupt);
    const fd = await fs.open(corrupt, "r+"); try { const byte = Buffer.alloc(1); await fd.read(byte, 0, 1, 40); byte[0] ^= 1; await fd.write(byte, 0, 1, 40); } finally { await fd.close(); }
    const beforeAuthentication = backupConnections;
    await assert.rejects(restore(authUrl.toString(), corrupt), /BACKUP_AUTHENTICATION_OR_STREAM_FAILED/);
    assert.equal(backupConnections, beforeAuthentication, "corruption is rejected before opening any DB connection");
    const [absent] = await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [authName]); assert.equal(absent.length, 0, "corrupt backup cannot create its target database");
    const realKey = process.env.BACKUP_ENCRYPTION_KEY; process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    await assert.rejects(restore(authUrl.toString(), file), /BACKUP_AUTHENTICATION_OR_STREAM_FAILED/); process.env.BACKUP_ENCRYPTION_KEY = realKey;
    assert.equal(backupConnections, beforeAuthentication);
    const truncated = path.join(dir, "truncated.enc"); await fs.copyFile(file, truncated); await fs.truncate(truncated, (await fs.stat(truncated)).size - 9);
    await assert.rejects(restore(authUrl.toString(), truncated), /BACKUP_AUTHENTICATION_OR_STREAM_FAILED/); assert.equal(backupConnections, beforeAuthentication);
    const malformed = path.join(dir, "authenticated-invalid.enc");
    await fs.writeFile(malformed, encryptedRecords([{ type: "manifest", version: 1, sourceDatabase: sourceName, sourceFingerprint: before.sourceFingerprint, tableCount: 1 }, { type: "table", table: "bad", columns: ["id"], createSql: "CREATE TABLE `bad` (`id` INT) ENGINE=InnoDB" }, { type: "row", table: "bad", values: [1] }, { type: "checksums", tables: { bad: { count: 1, hash: "0".repeat(64) } } }]));
    await assert.rejects(restore(authUrl.toString(), malformed), /BACKUP_RECORD_CHECKSUM_MISMATCH/); assert.equal(backupConnections, beforeAuthentication, "authenticated malformed data fails preflight before DB connection");
    await admin.query("CREATE DATABASE `" + authName + "`");
    await admin.query("CREATE PROCEDURE `" + authName + "`.existing_procedure() SELECT 1");
    await assert.rejects(restore(authUrl.toString(), file), /RESTORE_TARGET_MUST_BE_EMPTY/, "routines make a target nonempty even with no tables");
    await admin.query("DROP DATABASE `" + authName + "`");
    process.env.RESTORE_DATABASE_CONFIRM = sourceName;
    await assert.rejects(restore(sourceUrl.toString(), file), /CANNOT_RESTORE_OVER_SOURCE_DATABASE/);
    const loose = new URL(targetUrl); loose.pathname = "/company_preview_production"; process.env.RESTORE_DATABASE_CONFIRM = "company_preview_production";
    await assert.rejects(restore(loose.toString(), file), /RESTORE_TARGET_CONFIRMATION_REQUIRED/);
    process.env.RESTORE_DATABASE_CONFIRM = authName; const remote = new URL(authUrl); remote.hostname = "restore-target.invalid";
    await assert.rejects(restore(remote.toString(), file), /REMOTE_RESTORE_HOST_REQUIRES_EXPLICIT_ALLOWLIST/);
    process.env.PRODUCTION_DATABASE_URL = authUrl.toString(); await assert.rejects(restore(authUrl.toString(), file), /RESTORE_ONLY_IN_ISOLATED_NON_PRODUCTION/); delete process.env.PRODUCTION_DATABASE_URL;

    const unsupported = [
      ["view", "CREATE VIEW unsupported_view AS SELECT 1 AS id", "DROP VIEW unsupported_view", /UNSUPPORTED_DATABASE_OBJECTS/],
      ["trigger", "CREATE TRIGGER unsupported_trigger BEFORE INSERT ON duplicate_rows FOR EACH ROW SET NEW.value = NEW.value", "DROP TRIGGER unsupported_trigger", /UNSUPPORTED_DATABASE_OBJECTS/],
      ["routine", "CREATE PROCEDURE unsupported_procedure() SELECT 1", "DROP PROCEDURE unsupported_procedure", /UNSUPPORTED_DATABASE_OBJECTS/],
      ["event", "CREATE EVENT unsupported_event ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY DO SELECT 1", "DROP EVENT unsupported_event", /UNSUPPORTED_DATABASE_OBJECTS/],
      ["engine", "CREATE TABLE unsupported_engine(id INT) ENGINE=MEMORY", "DROP TABLE unsupported_engine", /UNSUPPORTED_DATABASE_OBJECTS/],
      ["generated", "CREATE TABLE unsupported_generated(id INT, derived INT AS (id + 1) STORED) ENGINE=InnoDB", "DROP TABLE unsupported_generated", /UNSUPPORTED_COLUMNS/],
      ["invisible", "CREATE TABLE unsupported_invisible(id INT, hidden INT INVISIBLE) ENGINE=InnoDB", "DROP TABLE unsupported_invisible", /UNSUPPORTED_COLUMNS/],
      ["spatial", "CREATE TABLE unsupported_spatial(id INT, point_value POINT) ENGINE=InnoDB", "DROP TABLE unsupported_spatial", /UNSUPPORTED_COLUMNS/]
    ];
    for (const [name, create, drop, rejection] of unsupported) {
      await admin.query("USE `" + sourceName + "`"); await admin.query(create);
      const failed = path.join(dir, name + ".enc");
      try { await assert.rejects(backup(sourceUrl.toString(), failed), rejection); await assert.rejects(fs.stat(failed), (error) => error.code === "ENOENT"); }
      finally { await admin.query(drop); }
    }
    for (const folder of createdPrivateDirs) await assert.rejects(fs.stat(folder), (error) => error.code === "ENOENT");
    console.log(JSON.stringify({ ok: true, rowCount: Object.values(before.tables).reduce((sum, table) => sum + table.count, 0), consistentSnapshotWithConcurrentInsert: concurrentInsertProven, checksumSpillExercised: true, authenticatedBeforeAnyDatabaseConnection: true, exactDateBinaryDecimalFidelity: true, existingArchivePreserved: true, receiptV1Compatible: true, unsupportedObjectsRejected: unsupported.length, privateTemporaryFilesRemoved: createdPrivateDirs.length }));
  } finally {
    fs.readFile = readFile; fs.mkdtemp = mkdtemp; callbackMysql.createConnection = createConnection;
    for (const name of [sourceName, targetName, authName]) await admin.query("DROP DATABASE IF EXISTS `" + name + "`");
    await admin.end(); await fs.rm(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries({ BACKUP_ENCRYPTION_KEY: saved.key, RESTORE_DATABASE_CONFIRM: saved.confirmation, CREATE_ISOLATED_RESTORE_DATABASE: saved.create, RESTORE_ALLOWED_HOSTS: saved.hosts, PRODUCTION_DATABASE_URL: saved.production })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
