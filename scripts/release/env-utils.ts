import crypto from "crypto";
import fs from "fs";
import path from "path";

export function loadEnvFile(fileName = process.env.ENV_FILE) {
  if (!fileName) return;
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Environment file does not exist: ${filePath}`);

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function databaseIdentity(value = process.env.DATABASE_URL) {
  if (!value) throw new Error("DATABASE_URL is missing.");
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const endpoint = `${parsed.protocol}//${parsed.hostname}:${parsed.port || "default"}/${database}`;
  return {
    database,
    fingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 12),
  };
}

export function assertSyntheticEnvironment() {
  const appEnv = String(process.env.APP_ENV || "").toLowerCase();
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  const allowed = new Set(["preview", "staging", "ci", "test"]);
  if (!allowed.has(appEnv)) throw new Error(`APP_ENV=${appEnv || "<missing>"} does not allow synthetic data.`);
  if (vercelEnv === "production") throw new Error("Synthetic seed is forbidden in Vercel Production.");
  if (process.env.ALLOW_SYNTHETIC_SEED !== "true") throw new Error("ALLOW_SYNTHETIC_SEED=true is required.");
  if (process.env.PREVIEW_DATASET_ID !== "focus-media-synthetic-v1") throw new Error("PREVIEW_DATASET_ID is invalid.");

  const identity = databaseIdentity();
  if (!/(preview|staging|test|ci)/i.test(identity.database)) {
    throw new Error(`Database ${identity.fingerprint} is not named as Preview/Staging/Test.`);
  }
  return identity;
}
