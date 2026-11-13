import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { hashPassword, createSessionToken, ADMIN_COOKIE, type AuthSession } from "../src/lib/auth";
import { findOrCreateClientAccount, mergeClientAccounts, normalizeClientName, withAuthorizedClientMutation } from "../src/lib/clients";
import { POST as upsert } from "../src/app/api/admin/clients/route";
import { PATCH as patch } from "../src/app/api/admin/clients/[id]/route";
import { POST as contact } from "../src/app/api/admin/clients/[id]/contacts/route";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
const tag = `client-atomic-${randomUUID()}`;
const ids: string[] = [];
const clientIds: string[] = [];
const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3111";
const envMode = process.env.MFA_ENFORCEMENT_MODE;
process.env.MFA_ENFORCEMENT_MODE = "off";

async function user(role: AuthSession["role"], suffix: string): Promise<AuthSession> {
  const id = `${tag}-${suffix}`;
  ids.push(id);
  await prisma.user.create({ data: { id, name: suffix, email: `${id}@example.invalid`, role, passwordHash: await hashPassword("Synthetic-Client-Atomic-Only-2026!") } });
  return { id, name: suffix, email: `${id}@example.invalid`, role, tokenVersion: 0, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
}

function request(path: string, actor: AuthSession, input: Record<string, unknown>, method = "POST") {
  return new NextRequest(base + path, { method, headers: { origin: base, "content-type": "application/json", cookie: `${ADMIN_COOKIE}=${createSessionToken(actor)}` }, body: JSON.stringify(input) });
}

async function client(owner: AuthSession, suffix: string) {
  const row = await prisma.clientAccount.create({ data: { companyName: `${tag}-${suffix}`, normalizedName: normalizeClientName(`${tag}-${suffix}`), accountOwnerUserId: owner.id, status: "active" } });
  clientIds.push(row.id);
  return row;
}

/** Inject only an audit failure; domain SQL still runs against real MySQL and must roll back. */
async function failAudit<T>(action: string, command: () => Promise<T>) {
  const mutable = prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
  const original = mutable.$transaction;
  mutable.$transaction = (callback: unknown, options: unknown) => original.call(prisma, async (tx: Prisma.TransactionClient) => {
    const proxy = new Proxy(tx, { get(target, key) {
      if (key !== "auditLog") return Reflect.get(target, key);
      return new Proxy(tx.auditLog, { get(delegate, method) {
        if (method !== "create") return Reflect.get(delegate, method);
        return (input: { data: { action: string } }) => {
          if (input.data.action === action) throw new Error("Synthetic audit failure");
          return tx.auditLog.create(input as Parameters<typeof tx.auditLog.create>[0]);
        };
      } });
    } });
    return (callback as (tx: Prisma.TransactionClient) => Promise<unknown>)(proxy);
  }, options);
  try { return await command(); } finally { mutable.$transaction = original; }
}

async function main() {
  const coo = await user("COO", "coo");
  const a = await user("SALES_AGENT", "agent-a");
  const b = await user("SALES_AGENT", "agent-b");
  const own = await client(a, "own");
  const foreign = await client(b, "foreign");
  const path = `/api/admin/clients/${foreign.id}`;
  const denied = await patch(request(path, a, { notes: "Unauthorized" }, "PATCH"), { params: Promise.resolve({ id: foreign.id }) });
  assert.equal(denied.status, 403);
  assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: foreign.id } })).notes, null);
  const deniedContact = await contact(request(`${path}/contacts`, a, { name: "Unauthorized contact" }), { params: Promise.resolve({ id: foreign.id }) });
  assert.equal(deniedContact.status, 403);

  const name = `${tag}-upsert-rollback`;
  const failedCreate = await failAudit("client.upsert", () => upsert(request("/api/admin/clients", a, { companyName: name })));
  assert.equal(failedCreate.status, 500, "an internal audit failure must not be presented as invalid user input");
  assert.equal(JSON.stringify(await failedCreate.json()).includes("Synthetic audit failure"), false, "internal audit details stay private");
  assert.equal(await prisma.clientAccount.count({ where: { companyName: name } }), 0, "Creation and its earlier domain audit roll back when the final audit fails");
  assert.equal(await prisma.auditLog.count({ where: { action: "client.create", metadata: { path: "$.companyName", equals: name } } }), 0);

  const originalPrimary = await prisma.clientContact.create({ data: { clientId: own.id, name: "Original primary", isPrimary: true } });
  const failedContact = await failAudit("client.contact_create", () => contact(request(`/api/admin/clients/${own.id}/contacts`, a, { name: "Failed primary", isPrimary: true }), { params: Promise.resolve({ id: own.id }) }));
  assert.equal(failedContact.status, 500);
  assert.equal(await prisma.clientContact.count({ where: { clientId: own.id } }), 1);
  assert.equal((await prisma.clientContact.findUniqueOrThrow({ where: { id: originalPrimary.id } })).isPrimary, true);

  const ownerChange = { accountOwnerUserId: b.id, ownerChangeReason: "Synthetic approved transfer", notes: "Owner transfer" };
  const failedOwner = await failAudit("client.update", () => patch(request(`/api/admin/clients/${own.id}`, coo, ownerChange, "PATCH"), { params: Promise.resolve({ id: own.id }) }));
  assert.equal(failedOwner.status, 500);
  assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: own.id } })).accountOwnerUserId, a.id);
  const updatedOwner = await patch(request(`/api/admin/clients/${own.id}`, coo, ownerChange, "PATCH"), { params: Promise.resolve({ id: own.id }) });
  assert.equal(updatedOwner.status, 200);
  const event = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.update", entityId: own.id }, orderBy: { createdAt: "desc" } });
  assert.equal((event.metadata as Record<string, unknown>).previousOwnerUserId, a.id);
  assert.equal((event.metadata as Record<string, unknown>).nextOwnerUserId, b.id);
  const stalePortfolio = await patch(request(`/api/admin/clients/${own.id}`, a, { notes: "Stale portfolio" }, "PATCH"), { params: Promise.resolve({ id: own.id }) });
  assert.equal(stalePortfolio.status, 403, "Ownership is checked after locking current client state");

  // Force an ownership transfer between authentication and the authoritative
  // client read. The waiting request must see the new owner after its lock.
  const raced = await client(a, "concurrent-owner");
  const mutable = prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
  const originalTransaction = mutable.$transaction;
  let reachedLock!: () => void;
  const lockAttempted = new Promise<void>((resolve) => { reachedLock = resolve; });
  let waitingPatch!: Promise<Response>;
  try {
    await originalTransaction.call(prisma, async (blocker: Prisma.TransactionClient) => {
      await blocker.$queryRaw`SELECT id FROM portfolio_client_accounts WHERE id = ${raced.id} FOR UPDATE`;
      mutable.$transaction = (callback: unknown, options: unknown) => originalTransaction.call(prisma, async (tx: Prisma.TransactionClient) => {
        const proxy = new Proxy(tx, { get(target, key) {
          if (key !== "$queryRaw") return Reflect.get(target, key);
          return (...args: unknown[]) => {
            if (String(args[0]).includes("portfolio_client_accounts")) reachedLock();
            return (tx.$queryRaw as (...args: unknown[]) => Promise<unknown>)(...args);
          };
        } });
        return (callback as (tx: Prisma.TransactionClient) => Promise<unknown>)(proxy);
      }, options);
      waitingPatch = patch(request(`/api/admin/clients/${raced.id}`, a, { notes: "Must be refused after transfer" }, "PATCH"), { params: Promise.resolve({ id: raced.id }) });
      await lockAttempted;
      await blocker.clientAccount.update({ where: { id: raced.id }, data: { accountOwnerUserId: b.id } });
    });
    assert.equal((await waitingPatch).status, 403);
    assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: raced.id } })).notes, null);
  } finally { mutable.$transaction = originalTransaction; }

  const primary = await client(a, "primary");
  const duplicate = await client(b, "duplicate");
  const campaign = await prisma.campaign.create({ data: { clientId: duplicate.id, campaignName: tag } });
  const duplicateContact = await prisma.clientContact.create({ data: { clientId: duplicate.id, name: "Duplicate contact" } });
  await assert.rejects(failAudit("client.merge", () => mergeClientAccounts({ primaryClientId: primary.id, duplicateClientId: duplicate.id }, coo)), /Synthetic audit failure/);
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).clientId, duplicate.id);
  assert.equal((await prisma.clientContact.findUniqueOrThrow({ where: { id: duplicateContact.id } })).clientId, duplicate.id);
  assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: duplicate.id } })).status, "active");
  await assert.rejects(mergeClientAccounts({ primaryClientId: primary.id, duplicateClientId: duplicate.id }, a), /Doar COO/);
  await mergeClientAccounts({ primaryClientId: primary.id, duplicateClientId: duplicate.id, reason: "Synthetic merge review" }, coo);
  assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).clientId, primary.id);
  assert.equal((await prisma.clientAccount.findUniqueOrThrow({ where: { id: duplicate.id } })).status, "merged");
  assert.equal(await prisma.auditLog.count({ where: { action: "client.merge", entityId: primary.id } }), 1);
  await assert.rejects(mergeClientAccounts({ primaryClientId: primary.id, duplicateClientId: duplicate.id }, coo), /deja combinat/);

  await prisma.user.update({ where: { id: a.id }, data: { tokenVersion: { increment: 1 } } });
  await assert.rejects(withAuthorizedClientMutation(a, [foreign.id], async () => "should not run"), /Reia autentificarea/);
  await assert.rejects(findOrCreateClientAccount({ companyName: `${tag}-unauthenticated` }), /Autentificare necesara/);
  console.log(JSON.stringify({ ok: true, checks: ["foreign client/contact denial", "current actor and portfolio recheck", "deterministic concurrent owner transfer", "upsert audit rollback", "primary contact audit rollback", "owner transfer audit rollback", "merge multi-table audit rollback", "durable successful merge and ownership audit", "merged source replay refusal"] }, null, 2));
}

main().finally(async () => {
  if (envMode === undefined) delete process.env.MFA_ENFORCEMENT_MODE; else process.env.MFA_ENFORCEMENT_MODE = envMode;
  await prisma.campaign.deleteMany({ where: { campaignName: tag } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: clientIds } }] } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error instanceof Error ? error.message : "Client atomic mutation test failed"); process.exitCode = 1; });
