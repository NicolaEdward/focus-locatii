import { spawnSync } from "node:child_process";
import path from "node:path";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { assertSyntheticEnvironment, databaseIdentity, loadEnvFile } from "./env-utils";

const databaseName = "focus_preview_bank_evidence";
let phase = "guard";

function localSyntheticUrl() {
  if ([process.env.APP_ENV, process.env.VERCEL_ENV, process.env.NODE_ENV].some((value) => value?.toLowerCase() === "production")) throw new Error("SYNTHETIC_ENVIRONMENT_REQUIRED");
  loadEnvFile();
  try { assertSyntheticEnvironment(); } catch { throw new Error("SYNTHETIC_ENVIRONMENT_REQUIRED"); }
  const url = new URL(process.env.DATABASE_URL || "");
  if (url.protocol !== "mysql:" || !["localhost", "127.0.0.1"].includes(url.hostname) || process.env.NODE_ENV === "production") throw new Error("LOCAL_SYNTHETIC_DATABASE_REQUIRED");
  return url;
}

function childEnvironment(url: URL) {
  const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString() };
  // Every helper calls loadEnvFile(). A parent ENV_FILE must never replace the
  // dedicated URL with the seeded main database or a different environment.
  delete environment.ENV_FILE;
  return environment;
}

async function assertEmpty(connection: Connection) {
  const [tables] = await connection.execute<RowDataPacket[]>("SELECT TABLE_NAME name FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [databaseName]);
  for (const table of tables) {
    const identifier = String(table.name).replace(/`/g, "``");
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM \`${databaseName}\`.\`${identifier}\``);
    if (Number(rows[0]?.total) !== 0) throw new Error("DEDICATED_EVIDENCE_DATABASE_NOT_EMPTY");
  }
}

function runChild(label: string, args: string[], environment: NodeJS.ProcessEnv, secrets: string[]) {
  phase = label;
  const result = spawnSync(process.execPath, args, { cwd: path.resolve(process.cwd()), env: environment, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const redact = (input: string) => secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((text, secret) => text.split(secret).join("[redacted]"), input).replace(/mysql:\/\/[^\s"'<>]+/g, "[database-url-redacted]");
  if (result.stdout) process.stdout.write(redact(result.stdout).slice(-24000));
  if (result.stderr) process.stderr.write(redact(result.stderr).slice(-12000));
  if (result.error || result.status !== 0) throw new Error("EVIDENCE_TEST_CHILD_FAILED");
}

async function main() {
  const sourceUrl = localSyntheticUrl();
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--seed-main-entities")) throw new Error("UNSUPPORTED_EVIDENCE_PREPARATION_ARGUMENT");
  if (args[0] === "--seed-main-entities") {
    if (decodeURIComponent(sourceUrl.pathname.slice(1)) === databaseName) throw new Error("DEDICATED_DATABASE_MUST_REMAIN_UNSEEDED");
    if (decodeURIComponent(sourceUrl.pathname.slice(1)) !== (process.env.DOCUMENT_AUDIT_TEST_DATABASE || "focus_preview_ci")) throw new Error("EXPECTED_MAIN_TEST_DATABASE_REQUIRED");
    phase = "seed-main-entities";
    const { PrismaClient } = await import("@prisma/client");
    const { ensureFinancialLegalEntity } = await import("../../src/lib/financial-partners");
    const client = new PrismaClient({ log: [] });
    try {
      await client.$transaction(async (tx) => {
        for (const code of ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]) await ensureFinancialLegalEntity(tx, code);
      });
    } finally { await client.$disconnect(); }
    console.log(JSON.stringify({ ok: true, action: phase, syntheticOnly: true, databaseFingerprint: databaseIdentity().fingerprint }));
    return;
  }

  const targetUrl = new URL(sourceUrl.toString());
  targetUrl.pathname = "/" + databaseName;
  const environment = childEnvironment(targetUrl);
  const secrets = [sourceUrl.toString(), targetUrl.toString(), sourceUrl.username, sourceUrl.password, decodeURIComponent(sourceUrl.username), decodeURIComponent(sourceUrl.password)];
  phase = "connect-local-admin";
  const connection = await createConnection({ host: sourceUrl.hostname, port: Number(sourceUrl.port || 3306), user: decodeURIComponent(sourceUrl.username), password: decodeURIComponent(sourceUrl.password) });
  let locked = false;
  try {
    phase = "lock-dedicated-database";
    const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('focus_preview_bank_evidence_tests', 0) acquired");
    if (Number(lock[0]?.acquired) !== 1) throw new Error("EVIDENCE_DATABASE_ALREADY_IN_USE");
    locked = true;
    phase = "create-dedicated-database";
    await connection.query("CREATE DATABASE IF NOT EXISTS `focus_preview_bank_evidence` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    phase = "verify-empty-before-schema";
    await assertEmpty(connection);
    runChild("sync-dedicated-schema", [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate"], environment, secrets);
    phase = "verify-empty-before-bank";
    await assertEmpty(connection);
    runChild("bank-evidence-regression", [require.resolve("tsx/cli"), "scripts/test-bank-evidence-executor.ts"], environment, secrets);
    phase = "verify-bank-cleanup-before-contracts";
    await assertEmpty(connection);
    runChild("contract-metadata-regression", [require.resolve("tsx/cli"), "scripts/test-contract-metadata-evidence.ts"], environment, secrets);
    phase = "verify-contract-cleanup-before-receipts";
    await assertEmpty(connection);
    runChild("bank-receipt-regression", [require.resolve("tsx/cli"), "scripts/test-bank-receipt-evidence.ts"], { ...environment, RECEIPT_EVIDENCE_TEST_DATABASE: databaseName }, secrets);
    phase = "verify-final-cleanup";
    await assertEmpty(connection);
    console.log(JSON.stringify({ ok: true, action: "isolated-evidence-regressions", syntheticOnly: true, seeded: false, databaseFingerprint: databaseIdentity(targetUrl.toString()).fingerprint, checks: ["empty before schema", "empty before bank", "bank cleanup before contracts", "contract cleanup before receipts", "empty after receipts", "child ENV_FILE removed"] }));
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('focus_preview_bank_evidence_tests')").catch(() => undefined);
    await connection.end();
  }
}

main().catch((error: unknown) => {
  // Connection and Prisma errors may include credentials. Report only our
  // bounded phase and a fixed code; never echo the supplied URL or error body.
  const allowed = new Set(["SYNTHETIC_ENVIRONMENT_REQUIRED", "LOCAL_SYNTHETIC_DATABASE_REQUIRED", "EXPECTED_MAIN_TEST_DATABASE_REQUIRED", "DEDICATED_EVIDENCE_DATABASE_NOT_EMPTY", "DEDICATED_DATABASE_MUST_REMAIN_UNSEEDED", "UNSUPPORTED_EVIDENCE_PREPARATION_ARGUMENT", "EVIDENCE_DATABASE_ALREADY_IN_USE", "EVIDENCE_TEST_CHILD_FAILED"]);
  const code = error instanceof Error && allowed.has(error.message) ? error.message : "EVIDENCE_TEST_DATABASE_PREPARATION_FAILED";
  console.error(JSON.stringify({ ok: false, phase, code }));
  process.exitCode = 1;
});
