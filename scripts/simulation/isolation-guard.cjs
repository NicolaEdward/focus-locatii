"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATASET_ID = "focus-ooh-real-company-v1";
const PREVIEW_DATASET_ID = "focus-media-synthetic-v1";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FALSE_KEYS = [
  "AUTH_EMAIL_DELIVERY_ENABLED", "AI_SALES_GENERATION_ENABLED", "COMMERCIAL_SEND_ENABLED",
  "ASSISTANT_MCP_ENABLED", "NEXT_PUBLIC_DOOH_ENABLED", "EXTERNAL_MONITORING_CONFIGURED",
  "ENABLE_LEGACY_RESERVATION_SYNC", "OPERATION_TASKS_ENABLED", "OPERATION_TASK_READS_ENABLED",
  "APPLY_REMEDIATION_SCHEMA", "RUN_REMEDIATION_SCHEMA_CHECK", "RUN_REMEDIATION_HISTORY_AUDIT",
  "RUN_INVENTORY_AVAILABILITY_DIAGNOSTICS", "RUN_PRODUCTION_RECONCILIATION_EXPORT",
  "RUN_EVIDENCE_RECONCILIATION", "APPLY_EVIDENCE_RECONCILIATION", "ALLOW_PRODUCTION_BACKUP",
  "ALLOW_PRODUCTION_AGGREGATE_INVENTORY", "CREATE_ISOLATED_RESTORE_DATABASE",
  "OWNERSHIP_REMEDIATION_WRITES_ENABLED", "PROVISION_PREVIEW_DATABASE",
  "CRM_SMOKE_BYPASS_CSP", "UI_TEST_BROWSER_BYPASS_CSP",
];
const EMPTY_KEYS = [
  "RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL", "COMMERCIAL_FROM_EMAIL", "COMMERCIAL_WEBHOOK_SECRET",
  "AI_GATEWAY_API_KEY", "AI_SALES_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "VERCEL_AUTOMATION_BYPASS_SECRET", "VERCEL_SHARE_TOKEN",
  "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_URL", "VERCEL", "GH_TOKEN", "GITHUB_TOKEN",
  "ADMIN_EMAIL", "ADMIN_PASSWORD", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD",
  "NEXTAUTH_SECRET", "NEXT_PUBLIC_WHATSAPP_PHONE", "ASSISTANT_MCP_BASE_URL",
  "PRODUCTION_DATABASE_URL", "PRODUCTION_ENV_FILE", "BACKUP_ENCRYPTION_KEY", "BACKUP_MYSQL_CA_FILE",
  "DATABASE_CA_PEM", "DATABASE_TLS_CA_FILE", "REMEDIATION_MYSQL_CA_FILE",
  "REMEDIATION_DATABASE_FINGERPRINT", "REMEDIATION_RESOLVED_PLAN_SHA256",
  "RECONCILIATION_DATABASE_FINGERPRINT", "RECONCILIATION_EXPORT_PUBLIC_KEY", "RECONCILIATION_JOB_KEY",
  "RECONCILIATION_PLAN_SHA256", "INVENTORY_DATABASE_FINGERPRINT", "RESTORE_ALLOWED_HOSTS",
  "RESTORE_DATABASE_CONFIRM", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
];
const BASE_URL_KEYS = new Set([
  "NEXT_PUBLIC_BASE_URL", "BASE_URL", "CAPTURE_BASE_URL", "MEASURE_BASE_URL", "OBSERVABILITY_BASE_URL",
  "OCCUPANCY_UI_BASE_URL", "OOH_SMOKE_BASE_URL", "OOH_WORKSPACE_BROWSER_BASE_URL", "PREVIEW_BASE_URL",
  "SMOKE_BASE_URL", "UI_SMOKE_BASE_URL",
]);
const EXPLICIT_KEYS = new Set([
  "DATABASE_URL", "AUTH_SECRET", "AUTH_MFA_ENCRYPTION_KEY", "CRON_SECRET", "FINANCIAL_IMPORT_TOKEN_SECRET",
  "APP_ENV", "VERCEL_ENV", "NODE_ENV", "ALLOW_SYNTHETIC_SEED", "PREVIEW_DATASET_ID", "PREVIEW_TEST_PASSWORD",
  "OOH_SIMULATION", "OOH_SIMULATION_DATASET_ID", "OOH_SIMULATION_OUT_DIR", "OOH_SIMULATION_FIXTURE_FILE",
  "OOH_SIMULATION_MANIFEST", "OOH_SIMULATION_CLOCK", "OOH_SIMULATION_SCENARIO", "OOH_SIMULATION_RUN_ID",
  "OPERATIONAL_ASSIGNMENT_ENABLED", "SAGA_SHADOW_MODE", "SAGA_PRODUCT", "AUTH_TRUSTED_ORIGINS",
  "MFA_ENFORCEMENT_MODE", "MFA_REQUIRED_ROLES", "MFA_GRACE_UNTIL", "PLAYWRIGHT_CHROMIUM_EXECUTABLE", "CHROME_PATH",
  "CAPTURE_CHROME_PORT", "CAPTURE_OUT_DIR", "CAPTURE_PAGE_FILTER", "CAPTURE_PERFORMANCE_RUNS", "CAPTURE_THEMES",
  "CAPTURE_WORKFLOW_CHECKS", "OOH_SMOKE_OUT_DIR", "OCCUPANCY_UI_OUT_DIR", "UI_SMOKE_OUT_DIR", "UI_SMOKE_CHROME_PORT",
  "SNAPSHOT_LABEL", "SNAPSHOT_OUT", "PRISMA_SLOW_QUERY_MS", "WORKSPACE_LIST_BUDGET_BYTES", "PORT", "HOSTNAME",
  "RUN_DATABASE_DIAGNOSTICS", "RUN_DATABASE_TLS_PROBE", "NEXT_TELEMETRY_DISABLED",
  ...BASE_URL_KEYS, ...FALSE_KEYS, ...EMPTY_KEYS,
]);
const SYSTEM_KEYS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "CI", "FORCE_COLOR", "NO_COLOR", "TMPDIR", "TMP", "TEMP"];

function failure(code) { const error = new Error(code); error.code = code; return error; }
function requireCondition(condition, code) { if (!condition) throw failure(code); }
function readJson(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  requireCondition(Buffer.byteLength(source) <= 65536, "SIMULATION_MANIFEST_TOO_LARGE");
  try { return JSON.parse(source); } catch { throw failure("SIMULATION_MANIFEST_INVALID_JSON"); }
}

function readEnvironmentFile(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  requireCondition(Buffer.byteLength(source) <= 65536 && !source.includes("\0"), "SIMULATION_ENV_INVALID");
  const environment = Object.create(null);
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    requireCondition(Boolean(match), "SIMULATION_ENV_LINE_INVALID");
    const [, key, rawValue] = match;
    requireCondition(EXPLICIT_KEYS.has(key), "SIMULATION_ENV_KEY_NOT_ALLOWED");
    requireCondition(!Object.hasOwn(environment, key), "SIMULATION_ENV_DUPLICATE_KEY");
    let value = rawValue.trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      requireCondition(value.length >= 2 && value.endsWith(value[0]), "SIMULATION_ENV_QUOTING_INVALID");
      value = value.slice(1, -1);
    }
    environment[key] = value;
  }
  return environment;
}

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw failure("SIMULATION_BASE_URL_INVALID"); }
  requireCondition(["http:", "https:"].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname), "SIMULATION_BASE_URL_NOT_LOCAL");
  requireCondition(!url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname), "SIMULATION_BASE_URL_INVALID");
  return url.origin;
}

function validateIsolation(environment, manifest) {
  requireCondition(environment.OOH_SIMULATION === "true" && environment.OOH_SIMULATION_DATASET_ID === DATASET_ID, "SIMULATION_EXPLICIT_OPT_IN_REQUIRED");
  requireCondition(["test", "preview", "ci", "staging"].includes(environment.APP_ENV) && environment.VERCEL_ENV === "preview", "SIMULATION_NON_PRODUCTION_REQUIRED");
  requireCondition(environment.ALLOW_SYNTHETIC_SEED === "true" && environment.PREVIEW_DATASET_ID === PREVIEW_DATASET_ID, "SIMULATION_SYNTHETIC_DATASET_REQUIRED");
  requireCondition(manifest?.schema_version === "1.0" && manifest.dataset_id === DATASET_ID, "SIMULATION_MANIFEST_DATASET_INVALID");
  requireCondition(manifest.isolation?.database_scope_verified === true && manifest.isolation?.network_internal_verified === true && manifest.isolation?.clean_runtime_verified === true, "SIMULATION_ISOLATION_EVIDENCE_REQUIRED");
  requireCondition(manifest.network?.internal === true && typeof manifest.network.name === "string" && manifest.network.name.length > 0, "SIMULATION_INTERNAL_NETWORK_REQUIRED");
  let url;
  try { url = new URL(environment.DATABASE_URL); } catch { throw failure("SIMULATION_DATABASE_URL_INVALID"); }
  requireCondition(url.protocol === "mysql:" && LOOPBACK_HOSTS.has(url.hostname), "SIMULATION_DATABASE_NOT_LOCAL_MYSQL");
  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const port = Number(url.port || "3306");
  requireCondition(Number.isInteger(port) && port > 0 && port <= 65535, "SIMULATION_DATABASE_PORT_INVALID");
  requireCondition(/^focus_preview_simulation_ooh_[A-Za-z0-9_]+$/.test(database), "SIMULATION_DATABASE_NAME_INVALID");
  requireCondition(user.length > 0 && !/^(root|admin|aivenadmin|mysql|mariadb)$/i.test(user) && url.password.length > 0, "SIMULATION_SCOPED_DATABASE_USER_REQUIRED");
  requireCondition(!url.hash, "SIMULATION_DATABASE_URL_INVALID");
  const allowedQuery = new Set(["connection_limit", "pool_timeout", "connect_timeout", "socket_timeout"]);
  for (const key of url.searchParams.keys()) requireCondition(allowedQuery.has(key), "SIMULATION_DATABASE_QUERY_OPTION_FORBIDDEN");
  requireCondition(manifest.database?.host === url.hostname && manifest.database?.name === database && manifest.database?.user === user && manifest.database?.port === port, "SIMULATION_DATABASE_MANIFEST_MISMATCH");
  const origin = localOrigin(environment.NEXT_PUBLIC_BASE_URL);
  if (manifest.application?.origin) requireCondition(localOrigin(manifest.application.origin) === origin, "SIMULATION_APPLICATION_MANIFEST_MISMATCH");
  for (const key of BASE_URL_KEYS) if (environment[key]) requireCondition(localOrigin(environment[key]) === origin, "SIMULATION_APPLICATION_ORIGIN_MISMATCH");
  for (const item of (environment.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean)) localOrigin(item.trim());
  requireCondition((environment.AUTH_SECRET || "").length >= 32 && (environment.AUTH_MFA_ENCRYPTION_KEY || "").length >= 32 && (environment.CRON_SECRET || "").length >= 24, "SIMULATION_FRESH_AUTH_SECRETS_REQUIRED");
  requireCondition(["test", "development", "production"].includes(environment.NODE_ENV), "SIMULATION_NODE_ENV_INVALID");
  for (const key of FALSE_KEYS) requireCondition(environment[key] === "false", "SIMULATION_UNSAFE_FEATURE_FLAG");
  for (const key of EMPTY_KEYS) requireCondition(environment[key] === "", "SIMULATION_EXTERNAL_CREDENTIAL_PRESENT");
  requireCondition(["disabled", "fixture"].includes(environment.SAGA_SHADOW_MODE), "SIMULATION_SAGA_MODE_INVALID");
  requireCondition(environment.MFA_ENFORCEMENT_MODE === "off", "SIMULATION_MFA_MODE_INVALID");
  const fingerprint = crypto.createHash("sha256").update(`${url.protocol}//${url.hostname}:${port}/${database}`).digest("hex").slice(0, 12);
  return { datasetId: DATASET_ID, databaseFingerprint: fingerprint, database: { host: url.hostname, port, name: database, user }, applicationOrigin: origin, networkName: manifest.network.name };
}

function buildEnvironment(explicit, inherited, manifest, manifestPath) {
  const environment = {};
  for (const key of SYSTEM_KEYS) if (typeof inherited[key] === "string") environment[key] = inherited[key];
  for (const [key, value] of Object.entries(explicit)) {
    requireCondition(EXPLICIT_KEYS.has(key), "SIMULATION_ENV_KEY_NOT_ALLOWED");
    environment[key] = value;
  }
  for (const key of EMPTY_KEYS) environment[key] = "";
  for (const key of FALSE_KEYS) environment[key] = "false";
  environment.NODE_ENV = explicit.NODE_ENV || "test";
  environment.TZ = "Europe/Bucharest";
  environment.SAGA_SHADOW_MODE = explicit.SAGA_SHADOW_MODE || "disabled";
  environment.MFA_ENFORCEMENT_MODE = "off";
  environment.MFA_REQUIRED_ROLES = "";
  environment.MFA_GRACE_UNTIL = "";
  environment.NO_PROXY = "localhost,127.0.0.1,::1";
  environment.no_proxy = environment.NO_PROXY;
  environment.NEXT_TELEMETRY_DISABLED = "1";
  environment.OOH_SIMULATION_MANIFEST = path.resolve(manifestPath);
  environment.OOH_SIMULATION_GUARD_REQUIRED = "true";
  environment.NODE_OPTIONS = `--require=${JSON.stringify(__filename)}`;
  const summary = validateIsolation(environment, manifest);
  return { environment, summary };
}

let installed = false;
function installEgressGuard() {
  if (installed) return;
  const manifest = readJson(process.env.OOH_SIMULATION_MANIFEST || "");
  validateIsolation(process.env, manifest);
  const net = require("node:net");
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node's net.createConnection can forward its normalized [options, callback].
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    let host;
    if (first && typeof first === "object") {
      requireCondition(!first.path && first.fd === undefined, "SIMULATION_UNIX_SOCKET_FORBIDDEN");
      host = first.host || "localhost";
    } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
      host = typeof normalized[1] === "string" ? normalized[1] : "localhost";
    } else {
      throw failure("SIMULATION_UNIX_SOCKET_FORBIDDEN");
    }
    requireCondition(LOOPBACK_HOSTS.has(String(host).toLowerCase()), "SIMULATION_EXTERNAL_NETWORK_BLOCKED");
    return originalConnect.apply(this, args);
  };
  installed = true;
}

module.exports = { DATASET_ID, PREVIEW_DATASET_ID, FALSE_KEYS, EMPTY_KEYS, readEnvironmentFile, readJson, buildEnvironment, validateIsolation, installEgressGuard };

if (process.env.OOH_SIMULATION_GUARD_REQUIRED === "true") installEgressGuard();
