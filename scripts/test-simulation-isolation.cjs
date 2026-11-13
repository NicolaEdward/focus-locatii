"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildEnvironment, DATASET_ID, PREVIEW_DATASET_ID } = require("./simulation/isolation-guard.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ooh-simulation-isolation-"));
const runner = path.resolve(__dirname, "simulation/run-isolated.cjs");
const envFile = path.join(directory, "synthetic.env");
const manifestPath = path.join(directory, "isolation.json");
const marker = path.join(directory, "child-ran");
const explicit = {
  OOH_SIMULATION: "true", OOH_SIMULATION_DATASET_ID: DATASET_ID,
  APP_ENV: "preview", VERCEL_ENV: "preview", NODE_ENV: "test",
  ALLOW_SYNTHETIC_SEED: "true", PREVIEW_DATASET_ID,
  DATABASE_URL: "mysql://ooh_simulation_scoped:synthetic-only-password@127.0.0.1:33407/focus_preview_simulation_ooh_unit",
  NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3050",
  AUTH_SECRET: "unit-test-auth-secret-".repeat(3),
  AUTH_MFA_ENCRYPTION_KEY: "unit-test-mfa-secret-".repeat(3),
  CRON_SECRET: "unit-test-cron-secret-".repeat(3),
};
const manifest = {
  schema_version: "1.0", dataset_id: DATASET_ID,
  isolation: { database_scope_verified: true, network_internal_verified: true, clean_runtime_verified: true },
  database: { host: "127.0.0.1", port: 33407, name: "focus_preview_simulation_ooh_unit", user: "ooh_simulation_scoped" },
  application: { origin: "http://127.0.0.1:3050" },
  network: { name: "unit-test-no-database-or-container", internal: true },
};
let groups = 0;
function writeEnvironment(values = explicit) {
  fs.writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
}
function run(extra = [], options = {}) {
  return spawnSync(process.execPath, [runner, "--env", envFile, "--manifest", manifestPath, ...extra], { encoding: "utf8", timeout: 15000, ...options });
}
function denied(values, expectedCode, currentManifest = manifest) {
  writeEnvironment(values);
  fs.writeFileSync(manifestPath, JSON.stringify(currentManifest));
  fs.rmSync(marker, { force: true });
  const result = run(["--", process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fs.existsSync(marker), false, "Refused input still executed the child.");
  assert.ok(result.stderr.includes(expectedCode), result.stderr);
  assert.ok(!result.stderr.includes("synthetic-only-password"));
  groups++;
}
try {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  writeEnvironment();
  const inherited = { ...process.env, SECRET: "parent-secret-must-not-leak", DATABASE_URL: "mysql://real:secret@production.invalid/production", RESEND_API_KEY: "real-mail-key-must-not-leak", AUTH_SECRET: "parent-auth-must-not-leak", GH_TOKEN: "parent-github-token", NODE_OPTIONS: "--require=/nonexistent/parent-preload.cjs", RUN_EVIDENCE_RECONCILIATION: "true", RUN_PRODUCTION_RECONCILIATION_EXPORT: "true" };
  // Start the runner in a trusted Node bootstrap. The runner can replace its
  // child's NODE_OPTIONS; it cannot undo a preload run before its own code.
  const runnerParent = { ...inherited };
  delete runnerParent.NODE_OPTIONS;
  const childCode = `
    const assert = require('node:assert/strict');
    assert.equal(process.env.SECRET, undefined);
    assert.equal(process.env.RESEND_API_KEY, '');
    assert.equal(process.env.GH_TOKEN, '');
    assert.equal(process.env.RUN_EVIDENCE_RECONCILIATION, 'false');
    assert.equal(process.env.RUN_PRODUCTION_RECONCILIATION_EXPORT, 'false');
    assert.ok(process.env.DATABASE_URL.includes('@127.0.0.1:33407/'));
    assert.ok(process.env.AUTH_SECRET.startsWith('unit-test-auth-secret-'));
    assert.ok(!process.env.NODE_OPTIONS.includes('parent-preload'));
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'synthetic-child-ran');
    console.log('CHILD_ENV_SANITIZED');
  `;
  const safe = run(["--", process.execPath, "-e", childCode], { env: runnerParent });
  assert.equal(safe.status, 0, safe.stdout + safe.stderr);
  assert.equal(fs.readFileSync(marker, "utf8"), "synthetic-child-ran");
  assert.ok(safe.stdout.includes("CHILD_ENV_SANITIZED"));
  assert.ok(!safe.stdout.includes("parent-secret") && !safe.stderr.includes("real-mail-key"));
  groups++;

  const checked = run(["--check"], { env: runnerParent });
  assert.equal(checked.status, 0, checked.stderr);
  const summary = JSON.parse(checked.stdout);
  assert.equal(summary.environmentGuardValidated, true);
  assert.equal(summary.databaseConnectionOpened, false);
  assert.ok(!checked.stdout.includes("synthetic-only-password") && !checked.stdout.includes(explicit.AUTH_SECRET));
  groups++;

  const network = run(["--", process.execPath, "-e", `
    const assert=require('node:assert/strict');
    const net=require('node:net');
    assert.throws(()=>net.connect({host:'example.com',port:443}),{code:'SIMULATION_EXTERNAL_NETWORK_BLOCKED'});
    assert.throws(()=>net.createConnection(443,'8.8.8.8'),{code:'SIMULATION_EXTERNAL_NETWORK_BLOCKED'});
    assert.throws(()=>net.connect('/var/run/docker.sock'),{code:'SIMULATION_UNIX_SOCKET_FORBIDDEN'});
    fetch('https://example.com').then(()=>process.exit(2)).catch(error=>{
      assert.equal(error.cause?.code,'SIMULATION_EXTERNAL_NETWORK_BLOCKED');
      console.log('EXTERNAL_REQUESTS_REFUSED_BEFORE_CONNECTION');
    });
  `]);
  assert.equal(network.status, 0, network.stdout + network.stderr);
  assert.ok(network.stdout.includes("EXTERNAL_REQUESTS_REFUSED_BEFORE_CONNECTION"));
  groups++;

  const loopback = run(["--", process.execPath, "-e", `
    const assert=require('node:assert/strict');
    const server=require('node:http').createServer((_request,response)=>response.end('synthetic-local-only'));
    server.listen(0,'127.0.0.1',async()=>{
      try {
        const response=await fetch('http://127.0.0.1:'+server.address().port);
        assert.equal(await response.text(),'synthetic-local-only');
        console.log('LOOPBACK_REQUEST_ALLOWED');
      } catch(error) { console.error(error);process.exitCode=1; }
      finally { server.closeAllConnections();server.close(); }
    });
  `]);
  assert.equal(loopback.status, 0, loopback.stdout + loopback.stderr);
  assert.ok(loopback.stdout.includes("LOOPBACK_REQUEST_ALLOWED"));
  groups++;

  denied({ ...explicit, DATABASE_URL: "mysql://real:synthetic-only-password@production.invalid/production" }, "SIMULATION_DATABASE_NOT_LOCAL_MYSQL");
  denied({ ...explicit, DATABASE_URL: explicit.DATABASE_URL.replace("focus_preview_simulation_ooh_unit", "production") }, "SIMULATION_DATABASE_NAME_INVALID");
  denied({ ...explicit, DATABASE_URL: explicit.DATABASE_URL.replace("ooh_simulation_scoped:", "root:") }, "SIMULATION_SCOPED_DATABASE_USER_REQUIRED");
  denied({ ...explicit, DATABASE_URL: explicit.DATABASE_URL + "?socket=/var/run/mysql.sock" }, "SIMULATION_DATABASE_QUERY_OPTION_FORBIDDEN");
  denied({ ...explicit, APP_ENV: "production" }, "SIMULATION_NON_PRODUCTION_REQUIRED");
  denied({ ...explicit, VERCEL_ENV: "production" }, "SIMULATION_NON_PRODUCTION_REQUIRED");
  denied({ ...explicit, OOH_SIMULATION: "false" }, "SIMULATION_EXPLICIT_OPT_IN_REQUIRED");
  denied({ ...explicit, OOH_SIMULATION_DATASET_ID: "wrong-dataset" }, "SIMULATION_EXPLICIT_OPT_IN_REQUIRED");
  denied({ ...explicit, NEXT_PUBLIC_BASE_URL: "https://locatii.focusmedia.ro" }, "SIMULATION_BASE_URL_NOT_LOCAL");
  denied({ ...explicit, OOH_SMOKE_BASE_URL: "http://127.0.0.1:3040" }, "SIMULATION_APPLICATION_ORIGIN_MISMATCH");
  denied({ ...explicit, UNRECOGNIZED_SECRET: "must-not-be-loaded" }, "SIMULATION_ENV_KEY_NOT_ALLOWED");
  denied(explicit, "SIMULATION_ISOLATION_EVIDENCE_REQUIRED", { ...manifest, isolation: { ...manifest.isolation, database_scope_verified: false } });
  denied(explicit, "SIMULATION_DATABASE_MANIFEST_MISMATCH", { ...manifest, database: { ...manifest.database, port: 3306 } });
  denied(explicit, "SIMULATION_INTERNAL_NETWORK_REQUIRED", { ...manifest, network: { ...manifest.network, internal: false } });

  const clamped = buildEnvironment({ ...explicit, RESEND_API_KEY: "explicit-mail-key", COMMERCIAL_SEND_ENABLED: "true", RUN_EVIDENCE_RECONCILIATION: "true" }, inherited, manifest, manifestPath);
  assert.equal(clamped.environment.RESEND_API_KEY, "");
  assert.equal(clamped.environment.COMMERCIAL_SEND_ENABLED, "false");
  assert.equal(clamped.environment.RUN_EVIDENCE_RECONCILIATION, "false");
  assert.equal(clamped.environment.VERCEL_OIDC_TOKEN, "");
  assert.ok(!clamped.environment.NODE_OPTIONS.includes("parent-preload"));
  groups++;
  console.log(JSON.stringify({ ok: true, groupsPassed: groups, databaseConnections: 0, containersStarted: 0, externalConnectionsAttempted: 0, note: "Network calls were refused by the Node guard before connect; manifest attestations are synthetic unit fixtures, not runtime evidence." }));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
