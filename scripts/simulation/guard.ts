import { createHash } from "node:crypto";

export const SIMULATION_DATASET_ID = "focus-ooh-real-company-v1";

/** Deliberately stricter than the generic preview gate: this fixture never uses a remote DB. */
export function assertOohSimulationEnvironment() {
  if (process.env.APP_ENV !== "preview" || process.env.VERCEL_ENV !== "preview") throw new Error("Simulation requires APP_ENV=preview and VERCEL_ENV=preview.");
  if (process.env.NODE_ENV === "production") throw new Error("Do not seed from a production process.");
  if (process.env.ALLOW_SYNTHETIC_SEED !== "true" || process.env.PREVIEW_DATASET_ID !== "focus-media-synthetic-v1" || process.env.OOH_SIMULATION !== "true" || process.env.OOH_SIMULATION_DATASET_ID !== SIMULATION_DATASET_ID) throw new Error("All dedicated simulation gates must be enabled.");
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== "mysql:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !/^focus_preview_simulation_[a-z0-9_]+$/.test(database)) throw new Error("Simulation database must be an explicitly named local MySQL database.");
  for (const name of ["AUTH_EMAIL_DELIVERY_ENABLED", "AI_SALES_GENERATION_ENABLED", "COMMERCIAL_SEND_ENABLED"]) if (process.env[name] !== "false") throw new Error(`${name}=false is mandatory.`);
  for (const name of ["RESEND_API_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "COMMERCIAL_WEBHOOK_SECRET", "SAGA_API_KEY"]) if (process.env[name]) throw new Error(`Remove external credential ${name} from the simulation environment.`);
  if (process.env.SAGA_SHADOW_MODE && process.env.SAGA_SHADOW_MODE !== "disabled" && process.env.SAGA_SHADOW_MODE !== "fixture") throw new Error("Only disabled or fixture SAGA mode is allowed.");
  const endpoint = `${url.protocol}//${url.hostname}:${url.port || "default"}/${database}`;
  return { datasetId: SIMULATION_DATASET_ID, database, host: url.hostname, port: url.port || "3306", fingerprint: createHash("sha256").update(endpoint).digest("hex").slice(0, 12) };
}
