const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const [, , envFile, command, ...args] = process.argv;

if (!envFile || !command) {
  console.error("Usage: node run-with-env.cjs <env-file> <command> [...args]");
  process.exit(1);
}

const environment = { ...process.env };
environment.ENV_FILE = envFile;
const raw = readFileSync(resolve(process.cwd(), envFile), "utf8");

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  environment[key] = value;
}

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  env: environment,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
