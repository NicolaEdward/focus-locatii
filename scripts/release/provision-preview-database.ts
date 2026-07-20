import crypto from "crypto";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { databaseIdentity, loadEnvFile } from "./env-utils";

const databaseName = "focus_preview";
const databaseUser = "focus_preview_app";
const outputFile = path.resolve(process.cwd(), ".env.preview.local");

loadEnvFile(process.env.PRODUCTION_ENV_FILE || ".env");

if (process.env.PROVISION_PREVIEW_DATABASE !== "true") {
  throw new Error("PROVISION_PREVIEW_DATABASE=true is required.");
}
if (String(process.env.VERCEL_ENV || "").toLowerCase() === "production") {
  throw new Error("Preview database provisioning cannot run in Vercel Production.");
}
const productionAdminUrl = process.env.DATABASE_URL || "";
if (!productionAdminUrl) throw new Error("Production admin DATABASE_URL is required for provisioning.");

async function main() {
const productionUrl = new URL(productionAdminUrl);
const previous = readEnv(outputFile);
const previousUrl = previous.DATABASE_URL ? new URL(previous.DATABASE_URL) : null;
const password = previousUrl && decodeURIComponent(previousUrl.username) === databaseUser
  ? decodeURIComponent(previousUrl.password)
  : crypto.randomBytes(30).toString("base64url");
const authSecret = previous.AUTH_SECRET || crypto.randomBytes(48).toString("base64url");
const cronSecret = previous.CRON_SECRET || crypto.randomBytes(48).toString("base64url");
const testPassword = previous.PREVIEW_TEST_PASSWORD || `Preview-${crypto.randomBytes(18).toString("base64url")}!`;

const connection = await mysql.createConnection({
  host: productionUrl.hostname,
  port: Number(productionUrl.port || 3306),
  user: decodeURIComponent(productionUrl.username),
  password: decodeURIComponent(productionUrl.password),
  database: productionUrl.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
});

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`CREATE USER IF NOT EXISTS ${connection.escape(databaseUser)}@'%' IDENTIFIED BY ${connection.escape(password)}`);
  await connection.query(`ALTER USER ${connection.escape(databaseUser)}@'%' IDENTIFIED BY ${connection.escape(password)}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW, TRIGGER ON \`${databaseName}\`.* TO ${connection.escape(databaseUser)}@'%'`);
} finally {
  await connection.end();
}

const previewUrl = new URL(productionUrl.toString());
previewUrl.username = databaseUser;
previewUrl.password = password;
previewUrl.pathname = `/${databaseName}`;

const contents = [
  "# Generated locally for the isolated Focus Media Preview environment.",
  "# This file is gitignored. Never copy these values to Production.",
  `DATABASE_URL=${quote(previewUrl.toString())}`,
  "APP_ENV=preview",
  "VERCEL_ENV=preview",
  "ALLOW_SYNTHETIC_SEED=true",
  "PREVIEW_DATASET_ID=focus-media-synthetic-v1",
  `PREVIEW_TEST_PASSWORD=${quote(testPassword)}`,
  `AUTH_SECRET=${quote(authSecret)}`,
  `CRON_SECRET=${quote(cronSecret)}`,
  "OPERATIONAL_PROOF_STORAGE_ENABLED=true",
  "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3000",
  "",
].join("\n");

fs.writeFileSync(outputFile, contents, { encoding: "utf8", mode: 0o600 });
const identity = databaseIdentity(previewUrl.toString());
console.log(JSON.stringify({
  ok: true,
  database: identity.database,
  fingerprint: identity.fingerprint,
  environmentFile: path.basename(outputFile),
  sharedInfrastructureHost: true,
}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function quote(value: string) {
  return JSON.stringify(value);
}

function readEnv(filePath: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}
