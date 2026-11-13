import assert from "node:assert/strict";
import { createConnection } from "mysql2/promise";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import {
  ADMIN_COOKIE,
  createSessionToken,
  type AuthSession,
} from "../src/lib/auth";
import {
  allowedAssistantScopes,
  authenticateAssistantBearer,
  beginAssistantConsent,
  decideAssistantConsent,
  exchangeAssistantToken,
  registerAssistantClient,
  revokeAssistantGrant,
  validateAssistantAuthorization,
} from "../src/lib/assistant-oauth";
import {
  assistantAuthorizationMetadata,
  assistantReadBody,
  assistantResourceMetadata,
} from "../src/lib/assistant-http";
import {
  POST as mcpPost,
  GET as mcpGet,
  DELETE as mcpDelete,
} from "../src/app/api/mcp/route";
import { POST as tokenPost } from "../src/app/api/assistant/oauth/token/route";
import { POST as consentPost } from "../src/app/api/assistant/oauth/consent/route";
import { POST as connectionsPost } from "../src/app/api/admin/assistant-connections/route";
import {
  confirmRetentionCleanup,
  getOperationsControls,
  previewRetentionCleanup,
  updateOperationsPolicy,
} from "../src/lib/operations-controls";
import {
  getDocumentAuditSummary,
  getDocumentAuditSummaryForAssistant,
} from "../src/lib/document-source-service";

loadEnvFile();
assertSyntheticEnvironment();
const base = process.env.ASSISTANT_MCP_BASE_URL!;
assert.ok(
  base && new URL(base).hostname === "127.0.0.1",
  "This route test requires an isolated loopback endpoint",
);
const tag = `mcp-${randomUUID()}`,
  resource = base + "/api/mcp",
  callback = base + "/synthetic/callback";
const actors: AuthSession[] = [];
let checks = 0;
function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks++;
}
async function actor(role: AuthSession["role"], name: string) {
  const user = await prisma.user.create({
    data: {
      id: `${tag}-${name}`,
      name: `Synthetic ${name}`,
      email: `${tag}-${name}@example.invalid`,
      passwordHash: "synthetic-unused",
      role,
    },
  });
  const session = await prisma.authSessionRecord.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const result: AuthSession = {
    ...user,
    role,
    sessionId: session.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  actors.push(result);
  return result;
}
function cookie(a: AuthSession) {
  return `${ADMIN_COOKIE}=${createSessionToken(a)}`;
}
function request(path: string, body: unknown, a?: AuthSession, origin = base) {
  return new NextRequest(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(a ? { cookie: cookie(a) } : {}),
    },
    body: JSON.stringify(body),
  });
}
function authorization(
  clientId: string,
  scopes = "inventory.read reservations.read clients.read campaigns.read offline_access",
) {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    input: {
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: randomBytes(24).toString("base64url"),
      scope: scopes,
      resource,
    },
  };
}
async function consent(clientId: string, a: AuthSession, scopes?: string) {
  const auth = authorization(clientId, scopes),
    c = await beginAssistantConsent(auth.input, a);
  const response = await consentPost(
    new NextRequest(base + "/api/assistant/oauth/consent", {
      method: "POST",
      headers: {
        origin: base,
        cookie: cookie(a),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        id: c.id,
        nonce: c.nonce,
        decision: "allow",
      }).toString(),
    }),
  );
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get("location")!);
  assert.equal(target.origin, new URL(callback).origin);
  assert.equal(target.searchParams.get("state"), auth.input.state);
  assert.equal(target.searchParams.get("iss"), base);
  return { ...auth, code: target.searchParams.get("code")! };
}
async function exchange(
  client: { id: string; clientSecret: string | null },
  auth: Awaited<ReturnType<typeof consent>>,
) {
  const response = await tokenPost(
    new NextRequest(base + "/api/assistant/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: auth.code,
        redirect_uri: callback,
        code_verifier: auth.verifier,
        client_id: client.id,
        client_secret: client.clientSecret!,
        resource,
      }).toString(),
    }),
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  return response.json();
}
async function sdk(token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const r = new Request(input, init),
        nr = new NextRequest(r);
      return r.method === "POST"
        ? mcpPost(nr)
        : r.method === "DELETE"
          ? mcpDelete(nr)
          : mcpGet(nr);
    },
  });
  const client = new Client({
    name: "synthetic-mcp-regression",
    version: "1.0.0",
  });
  await client.connect(transport);
  return client;
}
async function main() {
  process.env.MFA_ENFORCEMENT_MODE = "off";
  process.env.ASSISTANT_MCP_ENABLED = "true";
  const admin = await actor("SUPER_ADMIN", "admin"),
    seller = await actor("SALES_AGENT", "seller"),
    other = await actor("SALES_AGENT", "other"),
    dceo = await actor("D_CEO", "dceo");
  check(
    !allowedAssistantScopes(seller.role).includes("finance.read"),
    "Seller finance scope is denied",
  );
  check(
    !allowedAssistantScopes(seller.role).includes("documents.read"),
    "Unmapped NAS audit is management-only",
  );
  check(
    allowedAssistantScopes(dceo.role).includes("documents.read"),
    "DCEO can read management document status",
  );
  const metadata = assistantResourceMetadata();
  check(
    metadata.resource === resource &&
      !metadata.scopes_supported.includes("offline_access" as never),
    "Resource audience exact and offline scope only at AS",
  );
  check(
    assistantAuthorizationMetadata().scopes_supported.includes(
      "offline_access",
    ),
    "AS advertises explicit offline consent",
  );
  const missing = await mcpPost(request("/api/mcp", {}));
  assert.equal(missing.status, 401);
  check(
    missing.headers.get("www-authenticate")?.includes("resource_metadata="),
    "MCP has OAuth discovery challenge",
  );
  const cross = await connectionsPost(
    request(
      "/api/admin/assistant-connections",
      { action: "register_client" },
      admin,
      "https://foreign.example",
    ),
  );
  assert.equal(cross.status, 403);
  const client = await registerAssistantClient(
    {
      name: "Synthetic ChatGPT",
      redirectUris: [callback],
      scopes: [
        "inventory.read",
        "reservations.read",
        "clients.read",
        "campaigns.read",
      ],
      confidential: true,
    },
    admin,
  );
  check(
    client.clientSecret?.startsWith("fm_oc_"),
    "Confidential client returns one-time secret",
  );
  const storedClient = await prisma.assistantOAuthClient.findUniqueOrThrow({
    where: { id: client.id },
  });
  check(
    storedClient.secretHash !== client.clientSecret &&
      storedClient.secretHash?.length === 64,
    "Only secret hash persisted",
  );
  await assert.rejects(() =>
    registerAssistantClient(
      {
        name: "Unprivileged",
        redirectUris: [callback],
        scopes: ["inventory.read"],
      },
      seller,
    ),
  );
  await assert.rejects(() =>
    validateAssistantAuthorization({
      ...authorization(client.id).input,
      redirect_uri: base + "/other-callback",
    }),
  );
  await assert.rejects(() =>
    validateAssistantAuthorization({
      ...authorization(client.id).input,
      resource: "https://foreign.example/api/mcp",
    }),
  );
  await assert.rejects(() =>
    validateAssistantAuthorization({
      ...authorization(client.id).input,
      code_challenge_method: "plain",
    }),
  );
  await assert.rejects(() =>
    validateAssistantAuthorization({
      ...authorization(client.id).input,
      scope: "finance.read",
    }),
  );
  await assert.rejects(() =>
    validateAssistantAuthorization({
      ...authorization(client.id).input,
      scope: "offline_access",
    }),
  );
  check(
    (
      await validateAssistantAuthorization({
        ...authorization(client.id).input,
        prompt: "consent",
      })
    ).input.client_id === client.id,
    "Unknown OAuth extension ignored",
  );
  const absentScope = authorization(client.id).input;
  delete (absentScope as Partial<typeof absentScope>).scope;
  check(
    (await validateAssistantAuthorization(absentScope)).scopes.length === 4,
    "Missing scope defaults to approved client domains",
  );
  const pending = await beginAssistantConsent(
    authorization(client.id).input,
    seller,
  );
  await assert.rejects(() =>
    decideAssistantConsent(
      { id: pending.id, nonce: pending.nonce, decision: "allow" },
      other,
    ),
  );
  await assert.rejects(() =>
    decideAssistantConsent(
      { id: pending.id, nonce: pending.nonce + "wrong", decision: "allow" },
      seller,
    ),
  );
  const denied = await decideAssistantConsent(
    { id: pending.id, nonce: pending.nonce, decision: "deny" },
    seller,
  );
  check(
    new URL(denied.redirect).searchParams.get("error") === "access_denied",
    "Consent denial returns state without code",
  );
  await assert.rejects(() =>
    decideAssistantConsent(
      { id: pending.id, nonce: pending.nonce, decision: "allow" },
      seller,
    ),
  );

  const category = await prisma.category.create({
      data: { name: tag, slug: tag },
    }),
    location = await prisma.location.create({
      data: {
        code: tag,
        categoryId: category.id,
        type: "Panou",
        city: "Synthetic",
        address: "Synthetic location",
      },
    });
  const ownClient = await prisma.clientAccount.create({
      data: { companyName: `${tag}-own`, accountOwnerUserId: seller.id },
    }),
    foreignClient = await prisma.clientAccount.create({
      data: {
        companyName: `${tag}-FOREIGN-SECRET`,
        accountOwnerUserId: other.id,
      },
    });
  await prisma.campaign.create({
    data: {
      clientId: ownClient.id,
      campaignName: `${tag}-own-campaign`,
      accountOwnerUserId: seller.id,
    },
  });
  await prisma.campaign.create({
    data: {
      clientId: foreignClient.id,
      campaignName: `${tag}-FOREIGN-campaign`,
      accountOwnerUserId: other.id,
    },
  });
  const today = new Date().toISOString().slice(0, 10),
    from = new Date(today + "T00:00:00Z"),
    to = new Date(from.getTime() + 86400000);
  await prisma.reservation.create({
    data: {
      locationId: location.id,
      clientId: foreignClient.id,
      clientName: foreignClient.companyName,
      status: "BOOKED",
      periodStart: from,
      periodEnd: to,
      ownerId: other.id,
      contractNumber: "FOREIGN-CONTRACT-SECRET",
    },
  });
  await prisma.reservation.create({
    data: {
      locationId: location.id,
      clientId: ownClient.id,
      clientName: ownClient.companyName,
      status: "CANCELLED",
      periodStart: from,
      periodEnd: to,
      ownerId: seller.id,
    },
  });
  const auth = await consent(client.id, seller),
    tokens = await exchange(client, auth);
  const context = await authenticateAssistantBearer(
    `Bearer ${tokens.access_token}`,
  );
  check(
    context.actor.id === seller.id,
    "Bearer binds real current user and session",
  );
  await assert.rejects(() =>
    beginAssistantConsent(authorization(client.id).input, {
      ...seller,
      sessionId: undefined,
    }),
  );
  await prisma.authSessionRecord.update({
    where: { id: seller.sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  check(
    (await authenticateAssistantBearer(`Bearer ${tokens.access_token}`)).actor
      .id === seller.id,
    "Explicit offline grant survives normal source-session expiry",
  );
  await prisma.authSessionRecord.update({
    where: { id: seller.sessionId },
    data: { expiresAt: new Date(Date.now() + 86400000) },
  });
  const persisted = await prisma.assistantOAuthToken.findMany({
    where: { grantId: context.grant.id },
  });
  check(
    persisted.length === 2 &&
      persisted.every(
        (t) =>
          t.tokenHash.length === 64 &&
          !JSON.stringify(t).includes(tokens.access_token),
      ),
    "Access and refresh hashes persisted",
  );
  await assert.rejects(
    () =>
      exchangeAssistantToken({
        grant_type: "refresh_token",
        client_id: client.id,
        client_secret: client.clientSecret!,
        refresh_token: tokens.refresh_token,
        resource,
        scope: "inventory.read",
      }),
    "Refresh cannot silently ignore requested narrowing",
  );
  const sdkClient = await sdk(tokens.access_token);
  const tools = await sdkClient.listTools();
  check(
    tools.tools.length === 6 &&
      tools.tools.every((t) => t.annotations?.readOnlyHint === true),
    "Only six consented read-only tools exposed",
  );
  check(
    !tools.tools.some(
      (t) =>
        t.name === "receivables_registry" || t.name === "document_audit_status",
    ),
    "Finance/NAS tools absent without consent and role",
  );
  const reservations = await sdkClient.callTool({
    name: "list_reservations",
    arguments: { query: tag },
  });
  check(
    !reservations.isError && !JSON.stringify(reservations).includes("FOREIGN"),
    "Seller reservation details obey portfolio",
  );
  const clients = await sdkClient.callTool({
    name: "search_clients",
    arguments: { query: tag },
  });
  check(
    !clients.isError &&
      JSON.stringify(clients).includes(ownClient.companyName) &&
      !JSON.stringify(clients).includes("FOREIGN"),
    "Seller clients obey portfolio",
  );
  const campaigns = await sdkClient.callTool({
    name: "search_campaigns",
    arguments: { query: tag },
  });
  check(
    !campaigns.isError && !JSON.stringify(campaigns).includes("FOREIGN"),
    "Seller campaigns obey portfolio",
  );
  const availability = await sdkClient.callTool({
    name: "check_availability",
    arguments: { locationIds: [location.id], from: today, to: today },
  });
  check(
    !availability.isError &&
      JSON.stringify(availability).includes('"isBookable":false') &&
      !JSON.stringify(availability).includes("FOREIGN"),
    "Global availability blocks foreign booking without foreign identity",
  );
  const inventory = await sdkClient.callTool({
    name: "inventory_summary",
    arguments: {},
  });
  check(
    !inventory.isError && !!inventory.structuredContent,
    "SDK end-to-end inventory has structured result/provenance",
  );
  const invalid = await sdkClient.callTool({
    name: "check_availability",
    arguments: {
      locationIds: [location.id],
      from: "2026-02-30",
      to: "2026-03-02",
    },
  });
  check(invalid.isError, "Invalid calendar days are rejected");
  const logCount = await prisma.auditLog.count({
    where: { action: "assistant.mcp.read", entityId: context.grant.id },
  });
  check(logCount >= 5, "Each successful tool invocation has durable audit");
  await sdkClient.close();

  const rotated = await exchangeAssistantToken({
    grant_type: "refresh_token",
    client_id: client.id,
    client_secret: client.clientSecret!,
    refresh_token: tokens.refresh_token,
    resource,
  });
  check(
    rotated.refresh_token !== tokens.refresh_token,
    "Refresh token rotates",
  );
  await assert.rejects(() =>
    exchangeAssistantToken({
      grant_type: "refresh_token",
      client_id: client.id,
      client_secret: client.clientSecret!,
      refresh_token: tokens.refresh_token,
      resource,
    }),
  );
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${rotated.access_token}`),
  );
  check(
    !!(
      await prisma.assistantOAuthGrant.findUniqueOrThrow({
        where: { id: context.grant.id },
      })
    ).revokedAt,
    "Refresh replay revocation commits",
  );

  const pkce = await consent(client.id, seller);
  await assert.rejects(() =>
    exchangeAssistantToken({
      grant_type: "authorization_code",
      client_id: client.id,
      client_secret: "wrong-client-secret",
      code: pkce.code,
      code_verifier: pkce.verifier,
      redirect_uri: callback,
      resource,
    }),
  );
  await assert.rejects(() =>
    exchangeAssistantToken({
      grant_type: "authorization_code",
      client_id: client.id,
      client_secret: client.clientSecret!,
      code: pkce.code,
      code_verifier: pkce.verifier,
      redirect_uri: callback,
      resource: "https://foreign.example/api/mcp",
    }),
  );
  await assert.rejects(() =>
    exchangeAssistantToken({
      grant_type: "authorization_code",
      client_id: client.id,
      client_secret: client.clientSecret!,
      code: pkce.code,
      code_verifier: randomBytes(32).toString("base64url"),
      redirect_uri: callback,
      resource,
    }),
  );
  const once = await exchange(client, pkce);
  await assert.rejects(() => exchange(client, pkce));
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${once.access_token}`),
  );
  checks++;
  const roleTokens = await exchange(client, await consent(client.id, seller));
  await prisma.user.update({
    where: { id: seller.id },
    data: { role: "FIELD_OPERATOR" },
  });
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${roleTokens.access_token}`),
  );
  await prisma.user.update({
    where: { id: seller.id },
    data: { role: "SALES_AGENT" },
  });
  checks++;
  const versionTokens = await exchange(
    client,
    await consent(client.id, seller),
  );
  await prisma.user.update({
    where: { id: seller.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${versionTokens.access_token}`),
  );
  await prisma.user.update({
    where: { id: seller.id },
    data: { tokenVersion: seller.tokenVersion },
  });
  checks++;
  const revokeTokens = await exchange(client, await consent(client.id, seller));
  const revokeContext = await authenticateAssistantBearer(
    `Bearer ${revokeTokens.access_token}`,
  );
  await revokeAssistantGrant(revokeContext.grant.id, seller);
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${revokeTokens.access_token}`),
  );
  checks++;
  const sessionTokens = await exchange(
    client,
    await consent(client.id, seller),
  );
  await prisma.authSessionRecord.update({
    where: { id: seller.sessionId },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(() =>
    authenticateAssistantBearer(`Bearer ${sessionTokens.access_token}`),
  );
  checks++;
  const snapshotSource = await prisma.documentAuditSource.create({
    data: {
      label: tag,
      lastCompletedScanAt: new Date(),
      allowedPathPrefixes: ["Contracts"],
      ownerUserId: admin.id,
      ownerTokenVersion: admin.tokenVersion,
    },
  });
  const baselineSummary = await getDocumentAuditSummary(admin);
  await prisma.documentAuditSource.update({
    where: { id: snapshotSource.id },
    data: {
      activeScanId: "synthetic-abandoned-scan",
      activeScanStartedAt: new Date(Date.now() - 3600000),
      activeScanObservedAt: new Date(Date.now() - 3600000),
      activeScanLeaseUntil: new Date(Date.now() - 1000),
    },
  });
  const incompleteSummary = await getDocumentAuditSummary(admin);
  check(
    incompleteSummary.state === "sync_required" &&
      incompleteSummary.pendingScanSources ===
        baselineSummary.pendingScanSources + 1 &&
      incompleteSummary.syncRequired === baselineSummary.syncRequired + 1,
    "An abandoned scan cannot reuse a previous complete scan to imply current verified coverage",
  );
  await prisma.documentAuditSource.update({
    where: { id: snapshotSource.id },
    data: {
      activeScanId: null,
      activeScanStartedAt: null,
      activeScanObservedAt: null,
      activeScanLeaseUntil: null,
    },
  });
  const locker = await createConnection(process.env.DATABASE_URL!);
  let blockedSummary: ReturnType<typeof getDocumentAuditSummary> | undefined;
  try {
    await locker.query("LOCK TABLES portfolio_source_documents WRITE");
    blockedSummary = getDocumentAuditSummary(admin);
    void blockedSummary.catch(() => undefined);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [rows] = await locker.query(
        "SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE INFO LIKE '%SELECT%portfolio_source_documents%' AND STATE LIKE '%lock%'",
      );
      if ((rows as unknown[]).length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(
      waiting,
      "Snapshot test must pause the actual summary count query after its first consistent read",
    );
    const documentId = `${tag}-snapshot`;
    await locker.execute(
      "INSERT INTO portfolio_source_documents (id,sourceId,pathHash,relativePath,displayName,documentType,state,lastScanId,lastSeenAt) VALUES (?,?,?,?,?,'unknown','present','synthetic-snapshot',NOW(3))",
      [
        documentId,
        snapshotSource.id,
        createHash("sha256").update(documentId).digest("hex"),
        "Contracts/snapshot.pdf",
        "snapshot.pdf",
      ],
    );
    await locker.query("UNLOCK TABLES");
    check(
      (await blockedSummary).indexedDocuments ===
        baselineSummary.indexedDocuments,
      "Document summary keeps one real MySQL repeatable-read snapshot during concurrent insert",
    );
    check(
      (await getDocumentAuditSummary(admin)).indexedDocuments ===
        baselineSummary.indexedDocuments + 1,
      "A subsequent snapshot sees the committed document",
    );
  } finally {
    await locker.query("UNLOCK TABLES").catch(() => undefined);
    await locker.end();
    await blockedSummary?.catch(() => undefined);
  }
  const documentsClient = await registerAssistantClient(
    {
      name: "Synthetic document checker",
      redirectUris: [callback],
      scopes: ["documents.read"],
      confidential: true,
    },
    admin,
  );
  const documentsTokens = await exchange(
    documentsClient,
    await consent(documentsClient.id, admin, "documents.read offline_access"),
  );
  const ordinaryDocumentsTokens = await exchange(
    documentsClient,
    await consent(documentsClient.id, admin, "documents.read"),
  );
  const inventoryOnlyAdminTokens = await exchange(
    client,
    await consent(client.id, admin, "inventory.read"),
  );
  await assert.rejects(() =>
    getDocumentAuditSummaryForAssistant(
      `Bearer ${inventoryOnlyAdminTokens.access_token}`,
    ),
  );
  await prisma.authSessionRecord.update({
    where: { id: admin.sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => getDocumentAuditSummary(admin),
    "Ordinary document UI reader must keep its natural-session-expiry check",
  );
  await assert.rejects(
    () =>
      getDocumentAuditSummaryForAssistant(
        `Bearer ${ordinaryDocumentsTokens.access_token}`,
      ),
    "Non-offline document grant must expire with source session",
  );
  const documentSummary = await getDocumentAuditSummaryForAssistant(
    `Bearer ${documentsTokens.access_token}`,
  );
  check(
    typeof documentSummary.state === "string" &&
      !JSON.stringify(documentSummary).includes("relativePath"),
    "Offline document summary remains minimal after natural source-session expiry",
  );
  const maintainer = await actor("SUPER_ADMIN", "retention-maintainer");
  const controls = await getOperationsControls();
  const {
    version: policyVersion,
    configured: policyConfigured,
    ...policy
  } = controls.policy;
  void policyConfigured;
  await updateOperationsPolicy(
    {
      expectedVersion: policyVersion,
      policy: { ...policy, sessionRetentionDays: 30 },
    },
    maintainer,
  );
  const oldSessionId = `${tag}-obsolete-session`;
  await prisma.authSessionRecord.create({
    data: {
      id: oldSessionId,
      userId: admin.id,
      expiresAt: new Date(Date.now() - 40 * 86400000),
    },
  });
  const cleanup = await previewRetentionCleanup(maintainer);
  await confirmRetentionCleanup(cleanup.previewToken, maintainer);
  check(
    !(await prisma.authSessionRecord.findUnique({
      where: { id: oldSessionId },
    })),
    "Approved retention cleanup removes obsolete unreferenced sessions",
  );
  check(
    !!(await prisma.authSessionRecord.findUnique({
      where: { id: admin.sessionId },
    })),
    "Minimum production retention preserves naturally expired source sessions throughout seven-day delegation",
  );
  check(
    !!(await getDocumentAuditSummaryForAssistant(
      `Bearer ${documentsTokens.access_token}`,
    )),
    "Offline document checks still work after actual preview/confirm retention cleanup",
  );
  const documentSdk = await sdk(documentsTokens.access_token);
  check(
    (await documentSdk.listTools()).tools.map((tool) => tool.name).join(",") ===
      "document_audit_status",
    "Document consent exposes only its one typed tool",
  );
  const documentTool = await documentSdk.callTool({
    name: "document_audit_status",
    arguments: {},
  });
  check(
    !documentTool.isError && !!documentTool.structuredContent,
    "Real document summary works through official MCP client with offline delegation",
  );
  await documentSdk.close();
  await prisma.authSessionRecord.update({
    where: { id: admin.sessionId },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(
    () =>
      getDocumentAuditSummaryForAssistant(
        `Bearer ${documentsTokens.access_token}`,
      ),
    "Offline document helper still rejects revoked source sessions",
  );
  checks++;
  const bounded = new Request(base, {
    method: "POST",
    body: "x".repeat(40000),
  });
  await assert.rejects(() => assistantReadBody(bounded));
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      coverage:
        "synthetic MySQL; OAuth consent/PKCE/token; official SDK Streamable HTTP; portfolio; revocation/replay; body limit; no business writes in MCP",
    }),
  );
}
main()
  .finally(async () => {
    const ids = actors.map((a) => a.id);
    const documentSources = await prisma.documentAuditSource.findMany({
      where: { ownerUserId: { in: ids } },
      select: { id: true },
    });
    await prisma.sourceDocument.deleteMany({
      where: { sourceId: { in: documentSources.map((source) => source.id) } },
    });
    await prisma.documentAuditSource.deleteMany({
      where: { id: { in: documentSources.map((source) => source.id) } },
    });
    const grants = await prisma.assistantOAuthGrant.findMany({
        where: { userId: { in: ids } },
        select: { id: true },
      }),
      grantIds = grants.map((g) => g.id);
    await prisma.assistantOAuthToken.deleteMany({
      where: { grantId: { in: grantIds } },
    });
    await prisma.assistantOAuthCode.deleteMany({
      where: { grantId: { in: grantIds } },
    });
    await prisma.assistantOAuthGrant.deleteMany({
      where: { id: { in: grantIds } },
    });
    await prisma.assistantOAuthConsent.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.assistantOAuthClient.deleteMany({
      where: { createdByUserId: { in: ids } },
    });
    await prisma.reservation.deleteMany({ where: { location: { code: tag } } });
    await prisma.campaign.deleteMany({
      where: { campaignName: { startsWith: tag } },
    });
    await prisma.clientAccount.deleteMany({
      where: { companyName: { startsWith: tag } },
    });
    await prisma.location.deleteMany({ where: { code: tag } });
    await prisma.category.deleteMany({ where: { slug: tag } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.authSessionRecord.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
