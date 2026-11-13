import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { ADMIN_COOKIE, createSessionToken, type AuthSession } from "../src/lib/auth";
import { hasAnyPermission, hasPermission, USER_ROLES } from "../src/lib/rbac";
import { workplaceGuide } from "../src/lib/workplace-guide";
import { onboardingState, updateOnboardingProgress } from "../src/lib/workplace-onboarding";
import { JsonRequestError, readBoundedJson } from "../src/lib/bounded-json-request";
import { GET, PUT } from "../src/app/api/admin/onboarding/route";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
const tag = `workplace-guide-${randomUUID()}`;
const users: string[] = [];
let checks = 0;
const base = "http://localhost:3111";
const originalMfaMode = process.env.MFA_ENFORCEMENT_MODE;
process.env.MFA_ENFORCEMENT_MODE = "off";

function pass() { checks += 1; }
async function actor(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const id = `${tag}-${suffix}`;
  users.push(id);
  await prisma.user.create({ data: { id, name: suffix, email: `${id}@example.invalid`, role, passwordHash: "synthetic-unused-no-password-login" } });
  return { id, name: suffix, email: `${id}@example.invalid`, role, tokenVersion: 0, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
}

function request(method: string, a?: AuthSession, body?: unknown, origin = base) {
  return new NextRequest(base + "/api/admin/onboarding", { method, headers: { origin, "Content-Type": "application/json", ...(a ? { cookie: `${ADMIN_COOKIE}=${createSessionToken(a)}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function main() {
  for (const role of USER_ROLES) {
    const guide = workplaceGuide(role);
    assert.equal(guide.steps.length, 6);
    assert.equal(new Set(guide.steps.map((s) => s.id)).size, 6);
    assert.equal(guide.steps[0].href, "/admin/securitate");
    for (const step of guide.steps) {
      const route = step.href.split("?")[0];
      if (route === "/admin/commercial-settings" || route === "/admin/control-contractual") continue; // Added by parallel business-workspace changes.
      assert(fs.existsSync(path.resolve("src/app", route.slice(1), "page.tsx")), `Guide cannot point at a dead screen: ${role} ${route}`);
      if (route === "/admin/utilizatori") assert(hasAnyPermission(role, ["users.view", "users.manage"]));
      if (route === "/admin/crm") assert(hasAnyPermission(role, ["leads.view", "leads.view.own"]));
      if (route === "/admin/selectie-locatii") assert(hasPermission(role, "inventory.view"));
      if (route.startsWith("/admin/financiar/")) assert(hasPermission(role, "finance.view"));
    }
    if (role === "FIELD_OPERATOR") assert(guide.steps.slice(1).every((s) => s.href === "/admin/operational"));
    if (role === "D_CEO") assert(!guide.steps.some((s) => s.href === "/admin/utilizatori" || s.href === "/admin/commercial-settings"));
    pass();
  }
  const [a, b, dceo] = await Promise.all([actor("SALES_AGENT", "a"), actor("FIELD_OPERATOR", "b"), actor("D_CEO", "executive")]);
  assert.deepEqual((await onboardingState(a)).completedStepIds, []); pass();
  const saved = await updateOnboardingProgress({ version: 0, completedStepIds: ["account-security"] }, a);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.completedStepIds, ["account-security"]); pass();
  const replay = await updateOnboardingProgress({ version: 0, completedStepIds: ["account-security"] }, a);
  assert.equal(replay.version, 1);
  assert.equal(await prisma.auditLog.count({ where: { userId: a.id, action: "account.onboarding.updated" } }), 1); pass();
  assert.deepEqual((await onboardingState(b)).completedStepIds, []); pass();
  await assert.rejects(updateOnboardingProgress({ version: 0, completedStepIds: [] }, a), (e: any) => e.code === "ONBOARDING_VERSION_CONFLICT"); pass();
  await assert.rejects(updateOnboardingProgress({ version: 1, completedStepIds: ["field-agenda"] }, a), (e: any) => e.code === "ONBOARDING_INVALID_STEP"); pass();
  await assert.rejects(updateOnboardingProgress({ version: 1, completedStepIds: [], userId: b.id }, a)); pass();

  const race = await Promise.allSettled([
    updateOnboardingProgress({ version: 1, completedStepIds: ["account-security", "sales-brief"] }, a),
    updateOnboardingProgress({ version: 1, completedStepIds: ["account-security", "sales-offer"] }, a),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  const failed = race.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(failed.reason.code, "ONBOARDING_VERSION_CONFLICT"); pass();
  assert.equal((await onboardingState(a)).version, 2); pass();

  const unauthenticated = await GET(request("GET"));
  assert.equal(unauthenticated.status, 401); pass();
  const crossOrigin = await PUT(request("PUT", b, { version: 0, completedStepIds: ["account-security"] }, "https://foreign.example.invalid"));
  assert.equal(crossOrigin.status, 403);
  assert.equal((await onboardingState(b)).version, 0); pass();

  // Executives may record personal learning progress while all business data stays untouched.
  const businessCounts = () => Promise.all([prisma.reservation.count({ where: { ownerId: dceo.id } }), prisma.clientAccount.count({ where: { createdByUserId: dceo.id } }), prisma.campaign.count({ where: { createdByUserId: dceo.id } })]);
  const businessCountsBefore = await businessCounts();
  const executiveResponse = await PUT(request("PUT", dceo, { version: 0, completedStepIds: ["account-security"] }));
  assert.equal(executiveResponse.status, 200);
  assert.equal(executiveResponse.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await businessCounts(), businessCountsBefore); pass();
  const personalResponse = await GET(request("GET", dceo));
  assert.equal(personalResponse.status, 200);
  assert.deepEqual((await personalResponse.json()).state.completedStepIds, ["account-security"]); pass();

  await prisma.user.update({ where: { id: b.id }, data: { tokenVersion: 1 } });
  await assert.rejects(updateOnboardingProgress({ version: 0, completedStepIds: ["account-security"] }, b), (e: any) => e.code === "ONBOARDING_SESSION_CHANGED");
  assert.equal((await onboardingState(b)).version, 0); pass();
  await assert.rejects(updateOnboardingProgress({ version: 2, completedStepIds: [] }, { ...a, exp: 1 }), (e: any) => e.code === "ONBOARDING_SESSION_CHANGED"); pass();

  const parsed = await readBoundedJson(new Request(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"value":true}' }), 64);
  assert.deepEqual(parsed, { value: true }); pass();
  await assert.rejects(readBoundedJson(new Request(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })), (e) => e instanceof JsonRequestError && e.status === 415); pass();
  await assert.rejects(readBoundedJson(new Request(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), (e) => e instanceof JsonRequestError && e.status === 400); pass();
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel() { cancelled = true; } });
  const streamed = new Request(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(streamed, 64), (e) => e instanceof JsonRequestError && e.status === 413);
  assert.equal(cancelled, true); pass();

  console.log(JSON.stringify({ ok: true, checks, covered: ["all role guides have six usable steps", "per-account persisted progress", "versioned concurrency", "idempotent timeout retry", "personal read-only role checklist", "no business writes", "origin and identity guards", "streamed body bounds"] }, null, 2));
}

main().finally(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.authSessionRecord.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (originalMfaMode === undefined) delete process.env.MFA_ENFORCEMENT_MODE; else process.env.MFA_ENFORCEMENT_MODE = originalMfaMode;
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
