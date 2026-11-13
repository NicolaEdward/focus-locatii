const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "focus-evidence-guards-"));
const environmentFile = path.join(directory, "synthetic.env");
fs.writeFileSync(environmentFile, "APP_ENV=ci\nVERCEL_ENV=preview\nALLOW_SYNTHETIC_SEED=true\nPREVIEW_DATASET_ID=focus-media-synthetic-v1\n", { mode: 0o600 });
const url = "mysql://guard-user:guard-sensitive-password@127.0.0.1:1/focus_preview_guard";
const base = { ...process.env, APP_ENV: "ci", VERCEL_ENV: "preview", NODE_ENV: "test", ALLOW_SYNTHETIC_SEED: "true", PREVIEW_DATASET_ID: "focus-media-synthetic-v1", DOCUMENT_AUDIT_TEST_DATABASE: "focus_preview_guard", DATABASE_URL: url };
delete base.ENV_FILE;
const cases = [
  [{ VERCEL_ENV: "production", ENV_FILE: environmentFile }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{ APP_ENV: "production", ENV_FILE: environmentFile }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{ NODE_ENV: "production" }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{ ALLOW_SYNTHETIC_SEED: "false" }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{ PREVIEW_DATASET_ID: "wrong" }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{ DATABASE_URL: url.replace("127.0.0.1", "example.invalid") }, [], "LOCAL_SYNTHETIC_DATABASE_REQUIRED"],
  [{ DATABASE_URL: url.replace("mysql:", "https:") }, [], "LOCAL_SYNTHETIC_DATABASE_REQUIRED"],
  [{ DATABASE_URL: url.replace("focus_preview_guard", "focus_live") }, [], "SYNTHETIC_ENVIRONMENT_REQUIRED"],
  [{}, ["--unknown"], "UNSUPPORTED_EVIDENCE_PREPARATION_ARGUMENT"],
  [{ DATABASE_URL: url.replace("focus_preview_guard", "focus_preview_bank_evidence") }, ["--seed-main-entities"], "DEDICATED_DATABASE_MUST_REMAIN_UNSEEDED"],
  [{ DOCUMENT_AUDIT_TEST_DATABASE: "focus_preview_other" }, ["--seed-main-entities"], "EXPECTED_MAIN_TEST_DATABASE_REQUIRED"],
];
try {
  for (const [environment, args, code] of cases) {
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "scripts/release/prepare-evidence-test-db.ts", ...args], { cwd: process.cwd(), env: { ...base, ...environment }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined, "Guard must return before any network connection");
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, phase: "guard", code });
    for (const credential of ["guard-user", "guard-sensitive-password", "mysql://", url]) assert.equal(output.includes(credential), false, "Guard output must omit connection credentials");
  }
  console.log(JSON.stringify({ passed: true, checks: cases.length, productionAndRemoteDeniedBeforeConnection: true, environmentFileCannotOverrideProduction: true, credentialsNotPrinted: true }));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
