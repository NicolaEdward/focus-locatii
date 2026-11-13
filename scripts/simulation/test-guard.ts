import assert from "node:assert/strict";
import { assertOohSimulationEnvironment, SIMULATION_DATASET_ID } from "./guard";

// No Prisma import, DB connection, provider request, or seed is performed here.
const valid: Record<string, string> = {
  APP_ENV: "preview", VERCEL_ENV: "preview", NODE_ENV: "test", ALLOW_SYNTHETIC_SEED: "true",
  PREVIEW_DATASET_ID: "focus-media-synthetic-v1", OOH_SIMULATION: "true", OOH_SIMULATION_DATASET_ID: SIMULATION_DATASET_ID,
  DATABASE_URL: "mysql://synthetic:unused@127.0.0.1:33407/focus_preview_simulation_guard",
  AUTH_EMAIL_DELIVERY_ENABLED: "false", AI_SALES_GENERATION_ENABLED: "false", COMMERCIAL_SEND_ENABLED: "false", SAGA_SHADOW_MODE: "disabled",
  RESEND_API_KEY: "", OPENAI_API_KEY: "", AI_GATEWAY_API_KEY: "", COMMERCIAL_WEBHOOK_SECRET: "", SAGA_API_KEY: "",
};
const originals = Object.fromEntries(Object.keys(valid).map((key) => [key, process.env[key]]));
let checks = 0;
try {
  Object.assign(process.env, valid);
  assert.equal(assertOohSimulationEnvironment().database, "focus_preview_simulation_guard"); checks++;
  const refusals = [
    { APP_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production" },
    { ALLOW_SYNTHETIC_SEED: "false" }, { OOH_SIMULATION: "false" }, { OOH_SIMULATION_DATASET_ID: "other" },
    { PREVIEW_DATASET_ID: "other" }, { DATABASE_URL: "mysql://synthetic:unused@db.example.invalid/focus_preview_simulation_guard" },
    { DATABASE_URL: "mysql://synthetic:unused@127.0.0.1/live_company" },
    { DATABASE_URL: "mysql://synthetic:unused@127.0.0.1/focus_preview_local" },
    { AUTH_EMAIL_DELIVERY_ENABLED: "true" }, { COMMERCIAL_SEND_ENABLED: "true" }, { AI_SALES_GENERATION_ENABLED: "true" },
    { RESEND_API_KEY: "fake-synthetic-key" }, { OPENAI_API_KEY: "fake-synthetic-key" }, { COMMERCIAL_WEBHOOK_SECRET: "fake-synthetic-key" },
    { SAGA_SHADOW_MODE: "live" },
  ];
  for (const change of refusals) { Object.assign(process.env, valid, change); assert.throws(assertOohSimulationEnvironment, Error, Object.keys(change)[0]); checks++; }
  console.log(JSON.stringify({ suite: "ooh-simulation-guard", assertions: checks, passed: checks, databaseConnections: 0, externalRequests: 0 }));
} finally {
  for (const [key, value] of Object.entries(originals)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
