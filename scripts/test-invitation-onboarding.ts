import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { createUserInvite } from "../src/lib/auth-workflows";
import { getAuthSessionFromRequest } from "../src/lib/auth";
import { ONBOARDING_LOGIN_HREF, onboardingLoginTarget, safeLoginContinuation } from "../src/lib/login-continuation";
import { POST as acceptInvite } from "../src/app/api/auth/invite/accept/route";
import { POST as login } from "../src/app/api/auth/login/route";
import { GET as readProgress } from "../src/app/api/admin/onboarding/route";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
assert(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname));
const tag = `invite-guide-${randomUUID()}`;
const oldMode = process.env.MFA_ENFORCEMENT_MODE;
const oldDelivery = process.env.AUTH_EMAIL_DELIVERY_ENABLED;
const oldAppEnv = process.env.APP_ENV;
const oldVercelEnv = process.env.VERCEL_ENV;
const oldBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
// Only after rejecting production and non-local databases, emulate the preview
// invitation transport in this test process. No email provider is called.
process.env.APP_ENV = "preview";
process.env.VERCEL_ENV = "preview";
process.env.MFA_ENFORCEMENT_MODE = "off";
process.env.AUTH_EMAIL_DELIVERY_ENABLED = "false";
const base = "http://localhost:3111";
process.env.NEXT_PUBLIC_BASE_URL = base;
let managerId = "", invitedUserId = "";
const invitedEmail = `${tag}@example.invalid`;
let groups = 0;

function request(route: string, body: unknown) {
  return new NextRequest(base + route, { method: "POST", headers: { origin: base, "Content-Type": "application/json", "x-forwarded-for": tag }, body: JSON.stringify(body) });
}

async function main() {
  assert.equal(onboardingLoginTarget("/admin/onboarding"), "/admin/onboarding");
  for (const destination of ["https://evil.invalid", "//evil.invalid", "/admin/onboarding?next=https://evil.invalid", "/admin/onboarding/../users", "/admin/onboarding#extra", "%2Fadmin%2Fonboarding", ["/admin/onboarding"], undefined]) assert.equal(onboardingLoginTarget(destination), undefined);
  assert.equal(safeLoginContinuation("/admin/onboarding"), "/admin/onboarding");
  assert.equal(safeLoginContinuation("/oauth/authorize?client_id=validated-local-consent"), "/oauth/authorize?client_id=validated-local-consent");
  for (const destination of ["https://evil.invalid", "//evil.invalid", "/oauth/authorize\\?client_id=x", "/oauth/authorize?x=\r\nhttps://evil.invalid", "/admin/dashboard"]) assert.equal(safeLoginContinuation(destination), undefined);
  const welcome = new URL(ONBOARDING_LOGIN_HREF, base);
  assert.equal(welcome.pathname, "/admin/login");
  assert.equal(onboardingLoginTarget(welcome.searchParams.get("next")), "/admin/onboarding");
  groups++;

  const manager = await prisma.user.create({ data: { name: tag, email: `${tag}-manager@example.invalid`, role: "SUPER_ADMIN", passwordHash: "synthetic-manager-no-password-login" } });
  managerId = manager.id;
  const invitation = await createUserInvite({ name: "Synthetic new colleague", email: invitedEmail, role: "SALES_AGENT" }, manager);
  assert(invitation.syntheticLink);
  const token = new URL(invitation.syntheticLink).searchParams.get("token");
  assert(token);
  const password = `Synthetic-Welcome-${randomUUID()}!`;
  const accepted = await acceptInvite(request("/api/auth/invite/accept", { token, password }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).ok, true);
  const invited = await prisma.user.findUniqueOrThrow({ where: { email: invitedEmail } });
  invitedUserId = invited.id;
  assert.equal(invited.role, "SALES_AGENT");
  assert.equal((await acceptInvite(request("/api/auth/invite/accept", { token, password }))).status, 400);
  groups++;

  const authenticated = await login(request("/api/auth/login", { email: invitedEmail, password }));
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).ok, true);
  const cookie = authenticated.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  const guideRequest = new NextRequest(base + "/api/admin/onboarding", { headers: { cookie } });
  const principal = await getAuthSessionFromRequest(guideRequest);
  assert.equal(principal?.id, invitedUserId);
  const progress = await readProgress(guideRequest);
  assert.equal(progress.status, 200);
  const state = (await progress.json()).state;
  assert.equal(state.role, "SALES_AGENT");
  assert.equal(state.version, 0);
  assert.deepEqual(state.completedStepIds, []);
  assert.equal(safeLoginContinuation(welcome.searchParams.get("next")), "/admin/onboarding");
  groups++;

  console.log(JSON.stringify({ ok: true, groups, covered: ["exact same-origin welcome continuation and external redirect rejection", "genuine one-time invitation acceptance", "initial password login and authenticated empty role guide"], externalMessages: 0, exposedTokens: 0 }));
}

main().finally(async () => {
  const ids = [managerId, invitedUserId].filter(Boolean);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authSessionRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authActionToken.deleteMany({ where: { OR: [{ email: invitedEmail }, { createdByUserId: managerId || "none" }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (oldMode === undefined) delete process.env.MFA_ENFORCEMENT_MODE; else process.env.MFA_ENFORCEMENT_MODE = oldMode;
  if (oldDelivery === undefined) delete process.env.AUTH_EMAIL_DELIVERY_ENABLED; else process.env.AUTH_EMAIL_DELIVERY_ENABLED = oldDelivery;
  if (oldAppEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldAppEnv;
  if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldVercelEnv;
  if (oldBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL; else process.env.NEXT_PUBLIC_BASE_URL = oldBaseUrl;
  await prisma.$disconnect();
}).catch((error) => { console.error(error instanceof Error ? error.message : "Invitation onboarding failed"); process.exitCode = 1; });
