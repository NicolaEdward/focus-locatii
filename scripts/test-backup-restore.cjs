const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const { backup, restore, identity } = require("./release/database-backup.cjs");

async function main() {
  const source = identity(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(source.u.hostname) && /preview|test/.test(source.name) && ["ci", "test", "preview"].includes(process.env.APP_ENV) && process.env.VERCEL_ENV !== "production", "Only local synthetic databases are allowed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "focus-backup-test-"));
  const target = new URL(source.u); target.pathname = "/focus_preview_restore_" + crypto.randomBytes(5).toString("hex");
  const database = target.pathname.slice(1), conn = await mysql.createConnection({ host: source.u.hostname, port: Number(source.u.port || 3306), user: decodeURIComponent(source.u.username), password: decodeURIComponent(source.u.password) });
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  process.env.RESTORE_DATABASE_CONFIRM = database; process.env.CREATE_ISOLATED_RESTORE_DATABASE = "true";
  try {
    const file = path.join(dir, "snapshot.enc"); const before = await backup(source.u.toString(), file);
    assert.equal(before.ok, true);
    await assert.rejects(backup(source.u.toString(), file));
    assert.equal(crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex"), before.encryptedSha256, "Existing backup must never be overwritten or deleted");
    const restored = await restore(target.toString(), file); assert.equal(restored.ok, true);
    assert.deepEqual(restored.tables, before.tables);
    await assert.rejects(restore(target.toString(), file), /RESTORE_TARGET_MUST_BE_EMPTY/);
    const corrupt = await fs.readFile(file); corrupt[40] ^= 1; await fs.writeFile(path.join(dir, "bad.enc"), corrupt);
    await assert.rejects(restore(target.toString(), path.join(dir, "bad.enc")));
    await assert.rejects(restore(source.u.toString(), file), /RESTORE_TARGET_CONFIRMATION_REQUIRED|CANNOT_RESTORE_OVER_SOURCE_DATABASE/);
    process.env.VERCEL_ENV = "production"; await assert.rejects(restore(target.toString(), file), /RESTORE_ONLY_IN_ISOLATED_NON_PRODUCTION/);
    console.log(JSON.stringify({ ok: true, restoredTableCount: Object.keys(before.tables).length, sourceFingerprint: before.sourceFingerprint, targetFingerprint: restored.targetFingerprint, durationMs: restored.durationMs, corruptionRejected: true, overwriteRejected: true, productionRejected: true }));
  } finally {
    await conn.query("DROP DATABASE `" + database + "`"); await conn.end(); await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Backup verification failed"); process.exitCode = 1; });
