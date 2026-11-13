import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { prisma } from "../src/lib/prisma";
import { hashPassword, getAuthSessionFromRequest, ADMIN_COOKIE, requirePermission } from "../src/lib/auth";
import { issueAuthActionToken } from "../src/lib/auth-action-tokens";
import { syntheticAuthFlowAllowed } from "../src/lib/auth-workflows";
import { beginMfaEnrollment, confirmMfaEnrollment, generateTotpForStep, issueMfaLoginChallenge, verifyMfaLoginChallenge } from "../src/lib/mfa";
import { updateUser } from "../src/lib/users";
import { createAuthSessionRecord } from "../src/lib/auth-sessions";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as beginRequired } from "../src/app/api/auth/mfa/enroll-required/route";
import { POST as confirmRequired } from "../src/app/api/auth/mfa/confirm-required/route";
import { POST as verifyLogin } from "../src/app/api/auth/mfa/verify-login/route";
import { POST as resetMfa } from "../src/app/api/admin/users/[id]/reset-mfa/route";
import { GET as notifications } from "../src/app/api/admin/notifications/route";
import { PATCH as updateNotification } from "../src/app/api/admin/notifications/[id]/route";
import { GET as security } from "../src/app/api/auth/security/route";

loadEnvFile();
assertSyntheticEnvironment();
const base = process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3111";
const tag = `auth-remediation-${randomUUID()}`;
const password = "Synthetic-Auth-Remediation-2026!";
const ids: string[] = [];
let requestCount = 0;
const snapshotEnv = { APP_ENV: process.env.APP_ENV, VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV, MFA_ENFORCEMENT_MODE: process.env.MFA_ENFORCEMENT_MODE, MFA_REQUIRED_ROLES: process.env.MFA_REQUIRED_ROLES, MFA_GRACE_UNTIL: process.env.MFA_GRACE_UNTIL };

function request(path: string, body?: Record<string, unknown>, cookie?: string, method?: string) {
  return new NextRequest(base + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { origin: base, "content-type": "application/json", "x-forwarded-for": `198.51.100.${++requestCount}`, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}
const cookieFrom = (r: NextResponse | Response) => r.headers.get("set-cookie")?.split(";")[0];
async function normalLogin(email: string) {
  const r = await login(request("/api/auth/login", { email, password }));
  assert.equal(r.status, 200); const cookie = cookieFrom(r); assert.ok(cookie); return cookie;
}
async function fixture(role: "SUPER_ADMIN" | "COO" | "D_CEO" | "FIELD_OPERATOR", suffix: string) {
  const id = `${tag}-${suffix}`;ids.push(id);
  return prisma.user.create({ data: { id, email: `${id}@example.invalid`, name: `Synthetic ${suffix}`, role, passwordHash: await hashPassword(password) } });
}
async function main() {
  process.env.MFA_ENFORCEMENT_MODE = "off";
  process.env.APP_ENV = "preview";
  process.env.VERCEL_ENV = "production";
  assert.equal(syntheticAuthFlowAllowed(), false, "Production cannot disclose synthetic invitation/reset links");
  process.env.VERCEL_ENV = "preview";
  assert.equal(syntheticAuthFlowAllowed(), true, "An explicitly isolated Preview can still exercise reset/invitation links");
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(syntheticAuthFlowAllowed(), false, "Unknown production runtime is denied even with preview markers");
  process.env.VERCEL_ENV = "preview";
  if (snapshotEnv.NODE_ENV === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: snapshotEnv.NODE_ENV });

  const admin = await fixture("SUPER_ADMIN", "admin");
  const coo = await fixture("COO", "coo");
  const director = await fixture("D_CEO", "dceo");
  const field = await fixture("FIELD_OPERATOR", "field");
  const pending = await fixture("COO", "pending");
  const resetPending = await fixture("COO", "reset-pending");
  const adminCookie = await normalLogin(admin.email);
  const fieldCookie = await normalLogin(field.email);
  const pendingOldCookie = await normalLogin(pending.email);

  const ownNotification = await prisma.appNotification.create({ data: { userId: field.id, type: "operation_assigned", title: "Synthetic own task", message: "Synthetic", entityType: "reservation", entityId: tag, status: "open" } });
  const foreignNotification = await prisma.appNotification.create({ data: { userId: coo.id, type: "operation_assigned", title: "Synthetic foreign task", message: "Synthetic", entityType: "reservation", entityId: tag, status: "open" } });
  const list = await notifications(request("/api/admin/notifications", undefined, fieldCookie));
  assert.equal(list.status, 200, "Field operators can read their assignment inbox");
  const inbox = (await list.json()).notifications;
  assert.ok(inbox.some((r: { id: string }) => r.id === ownNotification.id));
  assert.ok(!inbox.some((r: { id: string }) => r.id === foreignNotification.id), "Field cannot read another user's inbox");
  const ownUpdate = await updateNotification(request(`/api/admin/notifications/${ownNotification.id}`, { action: "note", note: "Synthetic acknowledgement" }, fieldCookie, "PATCH"), { params: Promise.resolve({ id: ownNotification.id }) });
  assert.equal(ownUpdate.status, 200);
  const foreignUpdate = await updateNotification(request(`/api/admin/notifications/${foreignNotification.id}`, { action: "resolve" }, fieldCookie, "PATCH"), { params: Promise.resolve({ id: foreignNotification.id }) });
  assert.notEqual(foreignUpdate.status, 200);
  assert.equal((await prisma.appNotification.findUniqueOrThrow({ where: { id: foreignNotification.id } })).status, "open");

  const enrollment = await beginMfaEnrollment(coo, password);
  const step = BigInt(Math.floor(Date.now() / 30_000));
  const recovery = await confirmMfaEnrollment(coo.id, generateTotpForStep(enrollment.secret, step));
  const cooFirstFactor = await login(request("/api/auth/login", { email: coo.email, password }));
  const challenge = (await cooFirstFactor.json()).challengeToken;
  assert.ok(challenge);
  await updateUser(coo.id, { password: "Changed-Synthetic-Password-2026!" }, admin.id, "SUPER_ADMIN");
  const stale = await verifyLogin(request("/api/auth/mfa/verify-login", { challengeToken: challenge, code: recovery[0] }));
  assert.equal(stale.status, 401);assert.equal(cookieFrom(stale), undefined);
  assert.equal(await prisma.authRecoveryCode.count({ where: { credential: { userId: coo.id }, usedAt: null } }), 10, "Stale challenge cannot consume a valid recovery code");
  assert.equal((await prisma.authActionToken.findFirstOrThrow({ where: { type: "MFA_LOGIN", userId: coo.id } })).usedAt instanceof Date, true);
  await assert.rejects(createAuthSessionRecord(coo.id, request("/api/test"), new Date(), 0), /expirat|schimbat/, "No session is minted from a stale credential snapshot");

  const roleChallenge = await issueMfaLoginChallenge(coo.id, 1);
  await updateUser(coo.id, { role: "SALES_DIRECTOR" }, admin.id, "SUPER_ADMIN");
  await assert.rejects(verifyMfaLoginChallenge(roleChallenge.token, recovery[0]), /expirat|schimbat/);
  await updateUser(coo.id, { role: "COO" }, admin.id, "SUPER_ADMIN");
  const legacyChallenge = await issueAuthActionToken({ type: "MFA_LOGIN", userId: coo.id, ttlSeconds: 60 });
  await assert.rejects(verifyMfaLoginChallenge(legacyChallenge.token, recovery[0]), /expirat|schimbat/, "Pre-binding challenges fail closed");

  const cooFresh = await issueMfaLoginChallenge(coo.id);
  const cooLogin = await verifyLogin(request("/api/auth/mfa/verify-login", { challengeToken: cooFresh.token, code: recovery[0] }));
  assert.equal(cooLogin.status, 200);const cooCookie = cookieFrom(cooLogin);assert.ok(cooCookie);
  await prisma.authMfaCredential.create({ data: { userId: director.id, secretCiphertext: "synthetic-only", secretIv: "synthetic-only", secretTag: "synthetic-only", enabledAt: new Date() } });
  const forbiddenReset = await resetMfa(request(`/api/admin/users/${director.id}/reset-mfa`, {}, cooCookie), { params: Promise.resolve({ id: director.id }) });
  assert.equal(forbiddenReset.status, 403);
  assert.equal(await prisma.authMfaCredential.count({ where: { userId: director.id } }), 1, "COO cannot remove protected D-CEO MFA");

  process.env.MFA_ENFORCEMENT_MODE = "required";
  process.env.MFA_REQUIRED_ROLES = "COO";
  delete process.env.MFA_GRACE_UNTIL;
  const oldAccess = await getAuthSessionFromRequest(request("/api/test", undefined, pendingOldCookie));
  assert.equal(oldAccess, null, "Pre-rollout password-only sessions cannot bypass required MFA");
  const firstFactor = await login(request("/api/auth/login", { email: pending.email, password }));
  assert.equal(firstFactor.status, 200);assert.equal(cookieFrom(firstFactor), undefined);
  const firstData = await firstFactor.json();assert.equal(firstData.mfaEnrollmentRequired, true);assert.ok(firstData.enrollmentToken);
  const opaqueCookie = `${ADMIN_COOKIE}=${firstData.enrollmentToken}`;
  assert.equal((await requirePermission(request("/api/test", undefined, opaqueCookie), "users.manage")).response?.status, 401, "Enrollment token is never a business session");
  const begin = await beginRequired(request("/api/auth/mfa/enroll-required", { enrollmentToken: firstData.enrollmentToken, userId: admin.id }));
  assert.equal(begin.status, 200);assert.equal(cookieFrom(begin), undefined);assert.equal(begin.headers.get("cache-control"), "no-store");
  const setup = await begin.json();assert.ok(setup.secret && setup.uri);
  assert.equal(await prisma.authMfaCredential.count({ where: { userId: admin.id } }), 0, "Caller cannot retarget enrollment to another account");
  const confirmed = await confirmRequired(request("/api/auth/mfa/confirm-required", { enrollmentToken: firstData.enrollmentToken, code: generateTotpForStep(setup.secret, BigInt(Math.floor(Date.now() / 30_000))) }));
  assert.equal(confirmed.status, 200);const requiredCookie = cookieFrom(confirmed);assert.ok(requiredCookie);
  const confirmedData = await confirmed.json();assert.equal(confirmedData.recoveryCodes.length, 10);
  const confirmedSecurity = await security(request("/api/auth/security", undefined, requiredCookie));
  assert.equal(confirmedSecurity.status, 200);assert.equal((await confirmedSecurity.json()).mfa.enrolled, true);
  const replay = await confirmRequired(request("/api/auth/mfa/confirm-required", { enrollmentToken: firstData.enrollmentToken, code: generateTotpForStep(setup.secret, BigInt(Math.floor(Date.now() / 30_000))) }));
  assert.equal(replay.status, 401);assert.equal(cookieFrom(replay), undefined);

  const resettingLogin = await login(request("/api/auth/login", { email: resetPending.email, password }));
  const resettingData = await resettingLogin.json();assert.ok(resettingData.enrollmentToken);
  const resettingBegin = await beginRequired(request("/api/auth/mfa/enroll-required", { enrollmentToken: resettingData.enrollmentToken }));
  const resettingSetup = await resettingBegin.json();assert.ok(resettingSetup.secret);
  await updateUser(resetPending.id, { password: "Changed-Synthetic-Password-2026!" }, admin.id, "SUPER_ADMIN");
  const cancelledSetup = await confirmRequired(request("/api/auth/mfa/confirm-required", { enrollmentToken: resettingData.enrollmentToken, code: generateTotpForStep(resettingSetup.secret, BigInt(Math.floor(Date.now() / 30_000))) }));
  assert.equal(cancelledSetup.status, 401);assert.equal(cookieFrom(cancelledSetup), undefined);
  assert.equal((await prisma.authMfaCredential.findUniqueOrThrow({ where: { userId: resetPending.id } })).enabledAt, null);

  const oneTime = await issueMfaLoginChallenge(pending.id, 0);
  const concurrent = await Promise.all([0, 1].map(() => verifyLogin(request("/api/auth/mfa/verify-login", { challengeToken: oneTime.token, code: confirmedData.recoveryCodes[0] }))));
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 401], "Concurrent verification has one winner and no partial consumption");
  assert.equal(await prisma.authRecoveryCode.count({ where: { credential: { userId: pending.id }, usedAt: null } }), 9);
  const auditCount = await prisma.auditLog.count({ where: { userId: { in: ids }, action: { in: ["auth.mfa.enroll.started", "auth.mfa.enroll.completed", "auth.mfa.challenge.verified", "user.access.updated", "auth.session.created"] } } });
  assert.ok(auditCount >= 10, "Security transitions have durable transactional audit evidence");
  const missingRecoveryReason = await resetMfa(request(`/api/admin/users/${coo.id}/reset-mfa`, {}, adminCookie), { params: Promise.resolve({ id: coo.id }) });
  assert.equal(missingRecoveryReason.status, 400);
  assert.equal(await prisma.authMfaCredential.count({ where: { userId: coo.id } }), 1);
  const pendingBeforeAdminReset = await issueMfaLoginChallenge(coo.id);
  const allowedReset = await resetMfa(request(`/api/admin/users/${coo.id}/reset-mfa`, { reason: "Synthetic verified recovery", identityVerified: true }, adminCookie), { params: Promise.resolve({ id: coo.id }) });
  assert.equal(allowedReset.status, 200);assert.equal(await prisma.authMfaCredential.count({ where: { userId: coo.id } }), 0);
  await assert.rejects(verifyMfaLoginChallenge(pendingBeforeAdminReset.token, recovery[1]), /expirat|schimbat/, "Administrative reset invalidates pending login challenges");
  assert.equal(await getAuthSessionFromRequest(request("/api/test", undefined, cooCookie)), null, "Administrative recovery revokes the previous session");
  const deactivationChallenge = await issueMfaLoginChallenge(pending.id);
  await updateUser(pending.id, { active: false }, admin.id, "SUPER_ADMIN");
  await assert.rejects(verifyMfaLoginChallenge(deactivationChallenge.token, confirmedData.recoveryCodes[1]), /expirat|schimbat/, "Inactive users cannot complete pending login");

  const mutable = prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
  const transact = mutable.$transaction;
  try {
    mutable.$transaction = async () => { throw new Error("Synthetic audit store unavailable"); };
    const stopped = await requirePermission(request("/api/admin/users", { synthetic: true }, adminCookie), "users.manage");
    assert.equal(stopped.response?.status, 503);
    assert.equal((await stopped.response!.json()).code, "AUDIT_UNAVAILABLE", "No authorized mutation can proceed without durable audit intent");
  } finally { mutable.$transaction = transact; }

  console.log(JSON.stringify({ ok: true, checks: ["production synthetic guard", "required MFA enrollment without general session", "existing session enforcement", "credential-bound challenge and session", "role/reset invalidation", "one-time concurrent recovery", "protected MFA administration", "Field own inbox", "durable security audits"], data: "isolated synthetic only" }, null, 2));
}

main().finally(async () => {
  for (const [key, value] of Object.entries(snapshotEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await prisma.appNotification.deleteMany({ where: { entityId: tag } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: ids } }, { action: "mutation.request.accepted", userId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error instanceof Error ? error.message : "Auth remediation tests failed"); process.exitCode = 1; });
