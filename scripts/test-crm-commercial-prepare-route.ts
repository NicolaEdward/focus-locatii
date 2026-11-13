import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { ADMIN_COOKIE, createSessionToken, type AuthSession } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { POST } from "../src/app/api/admin/crm/opportunities/[id]/handoff/route";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
assert(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname));
const tag = `crm-prepare-route-${randomUUID()}`;
const userIds: string[] = [];
let companyId = "", opportunityId = "", clientId = "", campaignId = "";
const previousMfa = process.env.MFA_ENFORCEMENT_MODE;
process.env.MFA_ENFORCEMENT_MODE = "off";
let groups = 0;
const base = "http://localhost:3111";

async function user(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const row = await prisma.user.create({ data: { id: `${tag}-${suffix}`, role, name: suffix, email: `${tag}-${suffix}@example.invalid`, passwordHash: "synthetic-unused-password" } });
  userIds.push(row.id);
  return { ...row, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
}

function request(actor: AuthSession | null, body: unknown, origin = base) {
  return new NextRequest(`${base}/api/admin/crm/opportunities/${opportunityId}/handoff`, { method: "POST", headers: { "Content-Type": "application/json", origin, ...(actor ? { cookie: `${ADMIN_COOKIE}=${createSessionToken(actor)}` } : {}) }, body: JSON.stringify(body) });
}

async function main() {
  const [seller, other, executive] = await Promise.all([user("SALES_AGENT", "seller"), user("SALES_AGENT", "other"), user("D_CEO", "executive")]);
  const company = await prisma.crmCompany.create({ data: { name: tag, normalizedName: tag, taxId: "RO" + String(10000000 + Math.floor(Math.random() * 80000000)), ownerId: seller.id, contacts: { create: { name: "Synthetic contact", email: "synthetic@example.invalid", isPrimary: true } } } });
  companyId = company.id;
  const opportunity = await prisma.crmOpportunity.create({ data: { companyId, ownerId: seller.id, name: `${tag}-campaign`, stage: "opportunity", currency: "EUR", initialSnapshot: {}, desiredPeriodStart: new Date("2093-02-01"), desiredPeriodEnd: new Date("2093-02-28") } });
  opportunityId = opportunity.id;
  const context = { params: Promise.resolve({ id: opportunityId }) };
  const body = { action: "prepare", version: opportunity.version, currency: "EUR", companyEntity: "Focus Media", idempotencyKey: randomUUID() };

  assert.equal((await POST(request(null, body), context)).status, 401);
  assert.equal((await POST(request(seller, body, "https://foreign.example.invalid"), context)).status, 403);
  assert.equal((await POST(request(executive, body), context)).status, 403);
  assert.equal((await POST(request(other, body), context)).status, 404);
  assert.equal(await prisma.clientAccount.count({ where: { companyName: tag } }), 0);
  groups++;

  const invalid = await POST(request(seller, { ...body, currency: "USD" }), context);
  assert.equal(invalid.status, 400);
  const stale = await POST(request(seller, { ...body, version: opportunity.version + 1 }), context);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "CRM_VERSION_CONFLICT");
  groups++;

  const response = await POST(request(seller, body), context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const prepared = (await response.json()).result;
  clientId = prepared.clientId; campaignId = prepared.campaignId;
  assert.equal(prepared.repeated, false);
  const destination = new URL(prepared.href, base);
  assert.equal(destination.pathname, "/admin/commercial-quotes");
  assert.equal(destination.searchParams.get("opportunityId"), opportunityId);
  assert.equal(destination.searchParams.get("clientId"), clientId);
  assert.equal(destination.searchParams.get("campaignId"), campaignId);
  const source = await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  assert.equal(source.stage, "opportunity");
  assert.equal(source.version, opportunity.version);
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  assert.equal(campaign.status, "draft");
  assert.equal(campaign.currency, "EUR");
  assert.equal(campaign.totalContractValue, null);
  assert.equal(await prisma.reservation.count({ where: { campaignId } }), 0);
  groups++;

  const replay = await POST(request(seller, body), context);
  assert.equal(replay.status, 200);
  const repeated = (await replay.json()).result;
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.clientId, clientId);
  assert.equal(repeated.campaignId, campaignId);
  assert.equal(await prisma.clientAccount.count({ where: { companyName: tag } }), 1);
  assert.equal(await prisma.campaign.count({ where: { clientId } }), 1);
  assert.equal(await prisma.crmEvent.count({ where: { opportunityId, type: "COMMERCIAL_DRAFT_PREPARED" } }), 1);
  assert.equal((await POST(request(seller, { ...body, currency: "RON" }), context)).status, 409);
  groups++;

  console.log(JSON.stringify({ ok: true, groups, covered: ["authentication/origin/portfolio/read-only role denial", "explicit valid terms and optimistic version", "CRM to quote HTTP response and persistence", "unchanged opportunity stage and no BOOKED", "stable retry without duplicate commercial records"] }, null, 2));
}

main().finally(async () => {
  await prisma.crmEvent.deleteMany({ where: { companyId: companyId || "none" } });
  await prisma.crmOpportunity.deleteMany({ where: { id: opportunityId || "none" } });
  await prisma.crmCompanyContact.deleteMany({ where: { companyId: companyId || "none" } });
  await prisma.crmCompany.deleteMany({ where: { id: companyId || "none" } });
  await prisma.campaign.deleteMany({ where: { id: campaignId || "none" } });
  await prisma.clientContact.deleteMany({ where: { clientId: clientId || "none" } });
  await prisma.clientAccount.deleteMany({ where: { id: clientId || "none" } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authSessionRecord.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (previousMfa === undefined) delete process.env.MFA_ENFORCEMENT_MODE; else process.env.MFA_ENFORCEMENT_MODE = previousMfa;
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
