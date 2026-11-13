import assert from "node:assert/strict";
import fs from "node:fs";
import { createConnection } from "mysql2/promise";
const url = new URL(process.env.DATABASE_URL || "invalid:");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.startsWith("/focus_preview_") ||
  process.env.VERCEL_ENV === "production"
)
  throw new Error(
    "Migration test requires a local synthetic database endpoint.",
  );
const baseline = process.argv[2];
if (!baseline)
  throw new Error("Provide SQL generated from the audited baseline schema.");
const migration = fs.readFileSync(
  "prisma/migrations/20261113160000_commercial_workbench/migration.sql",
  "utf8",
);
assert.equal(
  /^\s*(?:DROP|ALTER|UPDATE|DELETE|TRUNCATE)\b/im.test(migration),
  false,
  "migration only creates new tables",
);
assert.equal((migration.match(/CREATE TABLE/g) || []).length, 16);
async function main() {
  const database = "focus_preview_ai_migration_" + Date.now();
  const db = await createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true,
  });
  let created = false;
  try {
    await db.query("CREATE DATABASE `" + database + "`");
    created = true;
    await db.query("USE `" + database + "`");
    await db.query(fs.readFileSync(baseline, "utf8"));
    const [before] = await db.query(
      "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,ORDINAL_POSITION",
      [database],
    );
    await db.query(migration);
    const [after] = await db.query(
      "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,ORDINAL_POSITION",
      [database],
    );
    const existing = new Set(
      (before as { TABLE_NAME: string }[]).map((r) => r.TABLE_NAME),
    );
    assert.deepEqual(
      (after as { TABLE_NAME: string }[]).filter((r) =>
        existing.has(r.TABLE_NAME),
      ),
      before,
      "existing schema stays unchanged",
    );
    const tables = new Set(
      (after as { TABLE_NAME: string }[]).map((r) => r.TABLE_NAME),
    );
    assert.equal(tables.size, existing.size + 16);
    console.log(
      JSON.stringify({
        ok: true,
        preservedTables: existing.size,
        addedTables: 16,
        syntheticOnly: true,
      }),
    );
  } finally {
    if (created) await db.query("DROP DATABASE `" + database + "`");
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
