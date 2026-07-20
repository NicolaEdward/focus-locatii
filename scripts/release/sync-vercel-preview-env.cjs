const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const fileName = process.env.PREVIEW_ENV_FILE || ".env.preview.local";
const values = parseEnv(readFileSync(resolve(process.cwd(), fileName), "utf8"));
const sensitive = ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "PREVIEW_TEST_PASSWORD"];
const regular = ["APP_ENV", "ALLOW_SYNTHETIC_SEED", "PREVIEW_DATASET_ID", "OPERATIONAL_ASSIGNMENT_ENABLED"];
const forbidden = [
  "RESEND_API_KEY",
  "NOTIFICATION_FROM_EMAIL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "OPERATION_TASKS_ENABLED",
  "OPERATION_TASK_READS_ENABLED",
  "ENABLE_LEGACY_RESERVATION_SYNC",
];

for (const key of forbidden) {
  if (values[key]) throw new Error(`${key} is forbidden in the Preview environment file.`);
}
for (const key of [...sensitive, ...regular]) {
  if (!values[key]) throw new Error(`${key} is required in the Preview environment file.`);
}
const database = new URL(values.DATABASE_URL).pathname.replace(/^\//, "");
if (!/(preview|staging|test|ci)/i.test(database)) throw new Error("DATABASE_URL is not an isolated Preview database.");

for (const key of sensitive) add(key, values[key], true);
for (const key of regular) add(key, values[key], false);

console.log(JSON.stringify({
  ok: true,
  target: "preview",
  variables: [...sensitive, ...regular],
  omitted: forbidden,
}, null, 2));

function add(key, value, isSensitive) {
  const args = ["dlx", "vercel", "env", "add", key, "preview", "--force", "--yes", isSensitive ? "--sensitive" : "--no-sensitive"];
  const pnpmScript = process.env.npm_execpath;
  if (!pnpmScript) throw new Error("Run this command through pnpm so npm_execpath is available.");
  const result = spawnSync(process.execPath, [pnpmScript, ...args], {
    cwd: process.cwd(),
    env: process.env,
    input: `${value}\n`,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Vercel rejected ${key}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  console.log(`Configured Preview variable: ${key}`);
}

function parseEnv(raw) {
  const output = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}
