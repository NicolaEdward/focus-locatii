#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readEnvironmentFile, readJson, buildEnvironment } = require("./isolation-guard.cjs");

const usage = `Usage:
  node scripts/simulation/run-isolated.cjs --env <synthetic.env> --manifest <isolation.json> [--cwd <clean-runtime>] -- <command> [args...]
  node scripts/simulation/run-isolated.cjs --env <synthetic.env> --manifest <isolation.json> --check

The child receives an allowlisted environment, explicit blank outbound credentials,
disabled delivery/build jobs, and a preloaded Node loopback-only connection guard.
An independently verified internal Docker network and scoped database are required.
--check validates the files/environment; it does not inspect Docker or connect to DB.
`;

function main(args) {
  if (args.length === 0 || ["--help", "-h"].includes(args[0])) { process.stdout.write(usage); return 0; }
  const options = {};
  let command = [];
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (item === "--") { command = args.slice(index + 1); break; }
    if (item === "--check") { options.check = true; continue; }
    if (!["--env", "--manifest", "--cwd"].includes(item) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("SIMULATION_RUNNER_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (options[key]) throw new Error("SIMULATION_RUNNER_DUPLICATE_ARGUMENT");
    options[key] = args[++index];
  }
  if (!options.env || !options.manifest || (!options.check && command.length === 0) || (options.check && command.length > 0)) throw new Error("SIMULATION_RUNNER_ARGUMENT_REQUIRED");
  const envFile = path.resolve(options.env);
  const manifestPath = path.resolve(options.manifest);
  const explicit = readEnvironmentFile(envFile);
  const manifest = readJson(manifestPath);
  const { environment, summary } = buildEnvironment(explicit, process.env, manifest, manifestPath);
  if (options.check) {
    process.stdout.write(JSON.stringify({ ok: true, environmentGuardValidated: true, ...summary, independentlyVerifiedManifestRequired: true, databaseConnectionOpened: false, nodeNetworkGuard: "loopback-only; native subprocess egress must also be contained by the internal Docker network" }) + "\n");
    return 0;
  }
  const result = spawnSync(command[0], command.slice(1), { cwd: options.cwd ? path.resolve(options.cwd) : process.cwd(), env: environment, stdio: "inherit", shell: false });
  if (result.error) throw new Error("SIMULATION_CHILD_START_FAILED");
  if (result.signal) { process.stderr.write(JSON.stringify({ ok: false, code: "SIMULATION_CHILD_TERMINATED", signal: result.signal }) + "\n"); return 1; }
  return result.status ?? 1;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) {
  // Never echo env values, URLs, credentials, or raw filesystem/provider errors.
  const code = /^[A-Z][A-Z0-9_]+$/.test(error?.message || "") ? error.message : "SIMULATION_RUNNER_FAILED";
  process.stderr.write(JSON.stringify({ ok: false, code }) + "\n");
  process.exitCode = 1;
}
