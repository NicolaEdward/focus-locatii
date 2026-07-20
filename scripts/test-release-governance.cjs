const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const envUtils = read("scripts/release/env-utils.ts");
const previewSeed = read("prisma/seed-preview.ts");
const snapshot = read("scripts/release/snapshot-sensitive-counts.ts");
const isolation = read("scripts/release/verify-preview-isolation.ts");
const smoke = read("scripts/release/smoke-role-routes.cjs");
const capture = read("scripts/release/capture-role-pages.cjs");
const provisioner = read("scripts/release/provision-preview-database.ts");
const vercelEnvSync = read("scripts/release/sync-vercel-preview-env.cjs");
const snapshotCompare = read("scripts/release/compare-sensitive-snapshots.cjs");
const workflow = read(".github/workflows/release-governance.yml");
const docs = read("docs/release-governance.md");
const packageJson = JSON.parse(read("package.json"));
const pnpmWorkspace = read("pnpm-workspace.yaml");

assert.match(envUtils, /ALLOW_SYNTHETIC_SEED/);
assert.match(envUtils, /PREVIEW_DATASET_ID/);
assert.match(envUtils, /VERCEL_ENV.*production/s);
assert.match(envUtils, /preview|staging|ci|test/);
assert.match(envUtils, /process\.env\[key\] = value/);
assert.match(provisioner, /PROVISION_PREVIEW_DATABASE/);
assert.match(provisioner, /focus_preview/);
assert.match(provisioner, /GRANT SELECT, INSERT, UPDATE, DELETE/);
assert.doesNotMatch(provisioner, /GRANT ALL/);
assert.match(vercelEnvSync, /"DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "PREVIEW_TEST_PASSWORD"/);
assert.match(vercelEnvSync, /RESEND_API_KEY/);
assert.match(vercelEnvSync, /OPERATION_TASKS_ENABLED/);
assert.match(vercelEnvSync, /OPERATIONAL_ASSIGNMENT_ENABLED/);
assert.match(vercelEnvSync, /"preview"/);
assert.match(previewSeed, /operationTask\.upsert/);
assert.match(previewSeed, /reservation:\$\{ids\.reservationBooked\}:DECORATION:base/);
assert.match(previewSeed, /assignedToUserId: field\.id/);
assert.doesNotMatch(previewSeed, /operationTask\.(create|update)/);
assert.match(previewSeed, /FIELD_OPERATOR/);
assert.match(previewSeed, /FINANCE_OPERATOR/);

assert.doesNotMatch(snapshot, /\.(create|update|upsert|delete|executeRaw)/);
assert.match(snapshot, /reservation\.count/);
assert.match(snapshot, /financialReceivable\.count/);
assert.match(snapshot, /financialReceivablePayment\.count/);
assert.match(snapshot, /appNotification\.count/);
assert.match(snapshot, /clientDocument\.count/);
assert.match(snapshot, /operationTask\.count/);
assert.match(snapshotCompare, /databaseFingerprint/);
assert.match(snapshotCompare, /Sensitive counts changed/);

assert.match(isolation, /Production database changed during Preview isolation test/);
assert.match(isolation, /preview\.appNotification\.create/);
assert.doesNotMatch(isolation, /production\.[\s\S]*?\.(create|update|upsert|delete)\(/);
assert.match(isolation, /RESEND_API_KEY/);
assert.match(isolation, /ADMIN_PASSWORD/);

for (const route of [
  "/admin/dashboard",
  "/admin/locatii",
  "/admin/selectie-locatii",
  "/admin/clienti",
  "/admin/campanii",
  "/admin/crm",
  "/admin/operational",
  "/admin/financiar/incasari",
  "/locatii",
]) {
  assert.ok(smoke.includes(route), `Missing smoke route ${route}`);
}

for (const viewport of ["1440", "1366", "768", "390"]) {
  assert.ok(capture.includes(viewport), `Missing screenshot viewport ${viewport}`);
}

assert.match(workflow, /mysql:/);
assert.match(workflow, /preview:prepare/);
assert.match(workflow, /smoke:roles/);
assert.match(workflow, /smoke:capture/);
assert.match(workflow, /SMOKE_BASE_URL: http:\/\/localhost:3000/);
assert.match(workflow, /CAPTURE_BASE_URL: http:\/\/localhost:3000/);
assert.match(docs, /Production/);
assert.match(docs, /Preview/);
assert.match(docs, /rollback/i);
assert.match(docs, /count/i);
assert.equal(packageJson.packageManager, "pnpm@10.28.0");
for (const dependency of ["@prisma/client", "@prisma/engines", "esbuild", "prisma", "sharp"]) {
  assert.ok(pnpmWorkspace.includes(dependency), `Missing pnpm build-script allow-list entry: ${dependency}`);
}

console.log("Release governance checks passed.");
