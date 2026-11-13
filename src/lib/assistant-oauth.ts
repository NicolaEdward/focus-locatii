import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  hasAnyPermission,
  hasPermission,
  isUserRole,
  type UserRole,
} from "@/lib/rbac";
import { mfaEnrollmentRequired } from "@/lib/mfa-policy";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

export const ASSISTANT_SCOPES = [
  "inventory.read",
  "reservations.read",
  "clients.read",
  "campaigns.read",
  "finance.read",
  "operations.read",
  "documents.read",
] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];
const scopesSchema = z
  .array(z.enum(ASSISTANT_SCOPES))
  .min(1)
  .max(ASSISTANT_SCOPES.length);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5000,
  timeout: 15000,
};
type Tx = Prisma.TransactionClient;
export class AssistantOAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(
  code: string,
  message = "Cererea de conectare nu este validă.",
  status = 400,
): never {
  throw new AssistantOAuthError(code, message, status);
}
export function assistantEnabled() {
  return process.env.ASSISTANT_MCP_ENABLED === "true";
}
export function assistantBaseUrl() {
  const supplied =
    process.env.ASSISTANT_MCP_BASE_URL ||
    (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL);
  if (!supplied)
    return fail(
      "server_configuration",
      "Adresa publică a conexiunii nu este configurată.",
      503,
    );
  let url: URL;
  try {
    url = new URL(supplied);
  } catch {
    return fail("server_configuration", "Adresa publică nu este validă.", 503);
  }
  const synthetic =
    ["ci", "test", "preview"].includes(process.env.APP_ENV || "") &&
    process.env.VERCEL_ENV !== "production";
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        synthetic &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    return fail("server_configuration", "Conexiunea necesită HTTPS.", 503);
  return url.origin;
}
export const assistantResource = () => assistantBaseUrl() + "/api/mcp";
export function scopeAllowed(role: UserRole, scope: AssistantScope) {
  switch (scope) {
    case "inventory.read":
      return hasPermission(role, "inventory.view");
    case "reservations.read":
      return hasAnyPermission(role, [
        "reservations.view",
        "reservations.view.own",
      ]);
    case "clients.read":
      return hasAnyPermission(role, ["clients.view", "clients.view.own"]);
    case "campaigns.read":
      return hasAnyPermission(role, ["campaigns.view", "campaigns.view.own"]);
    case "finance.read":
      return hasPermission(role, "finance.view");
    case "operations.read":
      return hasPermission(role, "audit.view");
    case "documents.read":
      return ["SUPER_ADMIN", "COO", "D_CEO"].includes(role);
  }
}
export function allowedAssistantScopes(role: UserRole) {
  return ASSISTANT_SCOPES.filter((scope) => scopeAllowed(role, scope));
}
function manager(actor: AuthSession) {
  if (!["SUPER_ADMIN", "COO"].includes(actor.role))
    fail(
      "access_denied",
      "Numai administrarea autorizată poate înregistra o conexiune.",
      403,
    );
}
function strings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}
function exactString(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function validRedirect(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    fail("invalid_redirect_uri", "Adresa de revenire nu este validă.");
  }
  const synthetic =
    ["ci", "test", "preview"].includes(process.env.APP_ENV || "") &&
    process.env.VERCEL_ENV !== "production";
  if (
    u.username ||
    u.password ||
    u.hash ||
    value.length > 1000 ||
    (u.protocol !== "https:" &&
      !(
        synthetic &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      ))
  )
    fail(
      "invalid_redirect_uri",
      "Folosește adresa HTTPS exactă din configurarea ChatGPT.",
    );
  return u.toString();
}
async function currentActor(
  tx: Tx,
  actor: Pick<
    AuthSession,
    "id" | "role" | "tokenVersion" | "sessionId" | "exp"
  >,
) {
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id=${actor.id} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tokenVersion: true,
      active: true,
    },
  });
  if (
    !user?.active ||
    user.role !== actor.role ||
    user.tokenVersion !== actor.tokenVersion ||
    actor.exp <= Date.now() / 1000
  )
    fail(
      "access_denied",
      "Sesiunea sau rolul s-a schimbat. Autentifică-te din nou.",
      401,
    );
  if (actor.sessionId) {
    const session = await tx.authSessionRecord.findUnique({
      where: { id: actor.sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== actor.id ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      fail("access_denied", "Sesiunea a fost închisă.", 401);
  }
  return user;
}
export async function registerAssistantClient(
  raw: unknown,
  actor: AuthSession,
) {
  manager(actor);
  const input = z
    .object({
      name: z.string().trim().min(3).max(160),
      redirectUris: z.array(z.string().min(1).max(1000)).min(1).max(5),
      scopes: scopesSchema,
      confidential: z.boolean().default(true),
    })
    .strict()
    .parse(raw);
  const redirectUris = [...new Set(input.redirectUris.map(validRedirect))];
  const secret = input.confidential ? opaque("fm_oc_") : null;
  const row = await prisma.$transaction(async (tx) => {
    await currentActor(tx, actor);
    const client = await tx.assistantOAuthClient.create({
      data: {
        name: input.name,
        redirectUris,
        allowedScopes: [...new Set(input.scopes)],
        secretHash: secret ? hash(secret) : null,
        createdByUserId: actor.id,
      },
    });
    await recordTransactionalAudit(tx, {
      actor,
      action: "assistant.oauth.client.registered",
      entityType: "assistant_client",
      entityId: client.id,
      metadata: {
        name: client.name,
        redirectOrigins: redirectUris.map((u) => new URL(u).origin),
        scopes: input.scopes,
        confidential: Boolean(secret),
      },
    });
    return client;
  }, options);
  return {
    id: row.id,
    name: row.name,
    clientSecret: secret,
    redirectUris,
    scopes: input.scopes,
    secretShownOnce: Boolean(secret),
  };
}
const authorizationSchema = z.object({
  client_id: z.string().min(1).max(191),
  redirect_uri: z.string().max(1000),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(8).max(512),
  scope: z.string().max(500).default(""),
  resource: z.string().max(1000),
});
export type AuthorizationRequest = z.infer<typeof authorizationSchema>;
export async function validateAssistantAuthorization(raw: unknown) {
  if (!assistantEnabled())
    fail(
      "temporarily_unavailable",
      "Conexiunea ChatGPT nu este încă activată.",
      503,
    );
  const input = authorizationSchema.parse(raw);
  if (input.resource !== assistantResource())
    fail("invalid_target", "Resursa solicitată nu corespunde aplicației.");
  const client = await prisma.assistantOAuthClient.findUnique({
    where: { id: input.client_id },
  });
  if (!client || client.disabledAt)
    fail(
      "unauthorized_client",
      "Conexiunea nu este înregistrată sau a fost revocată.",
    );
  if (
    !strings(client.redirectUris).includes(input.redirect_uri) ||
    validRedirect(input.redirect_uri) !== input.redirect_uri
  )
    fail(
      "invalid_redirect_uri",
      "Adresa de revenire nu este înregistrată exact.",
    );
  const requested = [
    ...new Set(
      (input.scope || strings(client.allowedScopes).join(" "))
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
  if (
    !requested.some((scope) => scope !== "offline_access") ||
    requested.some(
      (scope) =>
        scope !== "offline_access" &&
        !strings(client.allowedScopes).includes(scope),
    )
  )
    fail("invalid_scope", "Domeniul de acces solicitat nu este permis.");
  input.scope = requested.join(" ");
  return {
    input,
    client,
    scopes: requested.filter(
      (scope): scope is AssistantScope => scope !== "offline_access",
    ),
  };
}
export async function beginAssistantConsent(raw: unknown, actor: AuthSession) {
  if (!actor.sessionId)
    fail(
      "access_denied",
      "Sesiunea este veche. Deconectează-te și autentifică-te din nou înainte de conectarea ChatGPT.",
      401,
    );
  const validated = await validateAssistantAuthorization(raw);
  if (validated.scopes.some((scope) => !scopeAllowed(actor.role, scope)))
    fail("invalid_scope", "Rolul curent nu permite accesul solicitat.", 403);
  const nonce = opaque("fm_cs_");
  const row = await prisma.$transaction(async (tx) => {
    await currentActor(tx, actor);
    return tx.assistantOAuthConsent.create({
      data: {
        nonceHash: hash(nonce),
        userId: actor.id,
        sessionId: actor.sessionId || null,
        tokenVersion: actor.tokenVersion,
        clientId: validated.client.id,
        request: validated.input,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
  }, options);
  return {
    id: row.id,
    nonce,
    name: validated.client.name,
    redirectOrigin: new URL(validated.input.redirect_uri).origin,
    scopes: validated.scopes,
    offline: validated.input.scope.split(/\s+/).includes("offline_access"),
    expiresAt: row.expiresAt.toISOString(),
  };
}
export async function decideAssistantConsent(raw: unknown, actor: AuthSession) {
  if (!actor.sessionId)
    fail(
      "access_denied",
      "Reautentificarea este necesară pentru această delegare.",
      401,
    );
  const input = z
    .object({
      id: z.string().min(1).max(191),
      nonce: z.string().min(20).max(100),
      decision: z.enum(["allow", "deny"]),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await currentActor(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_assistant_oauth_consents WHERE id=${input.id} FOR UPDATE`;
    const consent = await tx.assistantOAuthConsent.findUnique({
      where: { id: input.id },
    });
    if (
      !consent ||
      consent.userId !== actor.id ||
      consent.tokenVersion !== actor.tokenVersion ||
      consent.sessionId !== (actor.sessionId || null) ||
      !exactString(consent.nonceHash, hash(input.nonce)) ||
      consent.consumedAt ||
      consent.expiresAt <= new Date()
    )
      fail(
        "invalid_request",
        "Confirmarea a expirat sau a fost deja folosită.",
      );
    const request = authorizationSchema.parse(consent.request),
      client = await tx.assistantOAuthClient.findUnique({
        where: { id: request.client_id },
      });
    if (
      !client ||
      client.disabledAt ||
      !strings(client.redirectUris).includes(request.redirect_uri) ||
      request.resource !== assistantResource()
    )
      fail("unauthorized_client");
    const requested = request.scope.split(/\s+/),
      scopes = requested.filter((scope): scope is AssistantScope =>
        ASSISTANT_SCOPES.includes(scope as AssistantScope),
      );
    if (
      !scopes.length ||
      scopes.some(
        (scope) =>
          !scopeAllowed(actor.role, scope) ||
          !strings(client.allowedScopes).includes(scope),
      )
    )
      fail("invalid_scope");
    await tx.assistantOAuthConsent.update({
      where: { id: consent.id },
      data: { consumedAt: new Date() },
    });
    const redirect = new URL(request.redirect_uri);
    redirect.searchParams.set("state", request.state);
    redirect.searchParams.set("iss", assistantBaseUrl());
    if (input.decision === "deny") {
      redirect.searchParams.set("error", "access_denied");
      await recordTransactionalAudit(tx, {
        actor,
        action: "assistant.oauth.consent.denied",
        entityType: "assistant_client",
        entityId: client.id,
      });
      return { redirect: redirect.toString() };
    }
    const offline = requested.includes("offline_access"),
      code = opaque("fm_ac_");
    const grant = await tx.assistantOAuthGrant.create({
      data: {
        clientId: client.id,
        userId: actor.id,
        sessionId: actor.sessionId || null,
        roleAtConsent: actor.role,
        tokenVersion: actor.tokenVersion,
        mfaVerifiedAt: actor.mfaVerifiedAt
          ? new Date(actor.mfaVerifiedAt)
          : null,
        scopes,
        resource: request.resource,
        offline,
        expiresAt: new Date(
          Date.now() + (offline ? 7 * 86400_000 : 15 * 60_000),
        ),
      },
    });
    await tx.assistantOAuthCode.create({
      data: {
        codeHash: hash(code),
        grantId: grant.id,
        clientId: client.id,
        redirectUri: request.redirect_uri,
        challenge: request.code_challenge,
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
    await recordTransactionalAudit(tx, {
      actor,
      action: "assistant.oauth.consent.approved",
      entityType: "assistant_grant",
      entityId: grant.id,
      metadata: {
        clientId: client.id,
        scopes,
        offline,
        expiresAt: grant.expiresAt,
      },
    });
    redirect.searchParams.set("code", code);
    return { redirect: redirect.toString() };
  }, options);
}
async function clientCredentials(
  tx: Tx,
  id: string,
  secret: string | undefined,
) {
  const client = await tx.assistantOAuthClient.findUnique({ where: { id } });
  if (
    !client ||
    client.disabledAt ||
    (client.secretHash
      ? !secret || !exactString(client.secretHash, hash(secret))
      : Boolean(secret))
  )
    fail("invalid_client", "Datele conexiunii nu sunt valide.", 401);
  return client;
}
async function liveGrant(tx: Tx, grantId: string) {
  await tx.$queryRaw`SELECT id FROM portfolio_assistant_oauth_grants WHERE id=${grantId} FOR UPDATE`;
  const grant = await tx.assistantOAuthGrant.findUnique({
    where: { id: grantId },
  });
  if (
    !grant ||
    !grant.sessionId ||
    grant.revokedAt ||
    grant.expiresAt <= new Date() ||
    grant.resource !== assistantResource()
  )
    fail("invalid_grant", "Delegarea a expirat sau a fost revocată.", 401);
  const [client, user, session] = await Promise.all([
    tx.assistantOAuthClient.findUnique({ where: { id: grant.clientId } }),
    tx.user.findUnique({
      where: { id: grant.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenVersion: true,
        active: true,
      },
    }),
    grant.sessionId
      ? tx.authSessionRecord.findUnique({
          where: { id: grant.sessionId },
          select: { userId: true, revokedAt: true, expiresAt: true },
        })
      : Promise.resolve(null),
  ]);
  if (
    !client ||
    client.disabledAt ||
    !user?.active ||
    !isUserRole(user.role) ||
    user.tokenVersion !== grant.tokenVersion ||
    user.role !== grant.roleAtConsent ||
    (grant.sessionId &&
      (!session ||
        session.userId !== user.id ||
        session.revokedAt ||
        (!grant.offline && session.expiresAt <= new Date()))) ||
    (mfaEnrollmentRequired(user.role) && !grant.mfaVerifiedAt)
  )
    fail("invalid_grant", "Contul sau sesiunea delegată s-a schimbat.", 401);
  const scopes = strings(grant.scopes).filter(
    (scope): scope is AssistantScope =>
      ASSISTANT_SCOPES.includes(scope as AssistantScope),
  );
  if (
    !scopes.length ||
    scopes.some(
      (scope) =>
        !scopeAllowed(user.role, scope) ||
        !strings(client.allowedScopes).includes(scope),
    )
  )
    fail("invalid_grant", "Permisiunile delegării s-au schimbat.", 401);
  const actor: AuthSession = {
    ...user,
    role: user.role,
    sessionId: grant.sessionId || undefined,
    mfaVerifiedAt: grant.mfaVerifiedAt?.toISOString(),
    iat: Math.floor(grant.createdAt.getTime() / 1000),
    exp: Math.floor(grant.expiresAt.getTime() / 1000),
  };
  return { grant, client, actor, scopes };
}
async function issueTokens(
  tx: Tx,
  context: Awaited<ReturnType<typeof liveGrant>>,
) {
  const access = opaque("fm_at_"),
    refresh = context.grant.offline ? opaque("fm_rt_") : null;
  const accessExpiry = new Date(
    Math.min(Date.now() + 15 * 60_000, context.grant.expiresAt.getTime()),
  );
  await tx.assistantOAuthToken.create({
    data: {
      tokenHash: hash(access),
      grantId: context.grant.id,
      kind: "access",
      expiresAt: accessExpiry,
    },
  });
  if (refresh)
    await tx.assistantOAuthToken.create({
      data: {
        tokenHash: hash(refresh),
        grantId: context.grant.id,
        kind: "refresh",
        expiresAt: context.grant.expiresAt,
      },
    });
  await recordTransactionalAudit(tx, {
    actor: context.actor,
    action: "assistant.oauth.credentials.issued",
    entityType: "assistant_grant",
    entityId: context.grant.id,
    metadata: {
      clientId: context.client.id,
      scopes: context.scopes,
      offline: context.grant.offline,
    },
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(
      1,
      Math.floor((accessExpiry.getTime() - Date.now()) / 1000),
    ),
    scope: [
      ...context.scopes,
      ...(context.grant.offline ? ["offline_access"] : []),
    ].join(" "),
    ...(refresh ? { refresh_token: refresh } : {}),
  };
}
export async function exchangeAssistantToken(raw: Record<string, string>) {
  if (!assistantEnabled())
    fail("temporarily_unavailable", "Conexiunea nu este activată.", 503);
  const grantType = raw.grant_type;
  if (!["authorization_code", "refresh_token"].includes(grantType))
    fail("unsupported_grant_type");
  if (
    !raw.client_id ||
    raw.client_id.length > 191 ||
    raw.resource !== assistantResource()
  )
    fail("invalid_target");
  const candidate =
    grantType === "authorization_code"
      ? await prisma.assistantOAuthCode.findUnique({
          where: { codeHash: hash(raw.code || "") },
          select: { grantId: true },
        })
      : await prisma.assistantOAuthToken.findUnique({
          where: { tokenHash: hash(raw.refresh_token || "") },
          select: { grantId: true },
        });
  if (!candidate) fail("invalid_grant");
  const result = await prisma.$transaction(async (tx) => {
    await clientCredentials(tx, raw.client_id, raw.client_secret);
    const context = await liveGrant(tx, candidate.grantId);
    if (context.grant.clientId !== raw.client_id) fail("invalid_grant");
    if (grantType === "authorization_code") {
      const row = await tx.assistantOAuthCode.findUnique({
        where: { codeHash: hash(raw.code || "") },
      });
      if (
        !row ||
        row.clientId !== raw.client_id ||
        row.redirectUri !== raw.redirect_uri ||
        row.expiresAt <= new Date() ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(raw.code_verifier || "") ||
        !exactString(
          row.challenge,
          createHash("sha256").update(raw.code_verifier).digest("base64url"),
        )
      )
        fail("invalid_grant");
      if (row.consumedAt) {
        await tx.assistantOAuthGrant.update({
          where: { id: context.grant.id },
          data: { revokedAt: new Date() },
        });
        await recordTransactionalAudit(tx, {
          actor: context.actor,
          action: "assistant.oauth.code.replay_denied",
          entityType: "assistant_grant",
          entityId: context.grant.id,
        });
        return null;
      }
      await tx.assistantOAuthCode.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
    } else {
      const row = await tx.assistantOAuthToken.findUnique({
        where: { tokenHash: hash(raw.refresh_token || "") },
      });
      if (
        !row ||
        row.kind !== "refresh" ||
        !context.grant.offline ||
        row.expiresAt <= new Date()
      )
        fail("invalid_grant");
      if (raw.scope) {
        const requested = [
          ...new Set(raw.scope.split(/\s+/).filter(Boolean)),
        ].sort();
        const original = [...context.scopes, "offline_access"].sort();
        if (JSON.stringify(requested) !== JSON.stringify(original))
          fail(
            "invalid_scope",
            "Schimbarea domeniilor necesită reconectare și un consimțământ nou.",
          );
      }
      if (row.consumedAt) {
        await tx.assistantOAuthGrant.update({
          where: { id: context.grant.id },
          data: { revokedAt: new Date() },
        });
        await recordTransactionalAudit(tx, {
          actor: context.actor,
          action: "assistant.oauth.refresh.replay_denied",
          entityType: "assistant_grant",
          entityId: context.grant.id,
        });
        return null;
      }
      await tx.assistantOAuthToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
    }
    return issueTokens(tx, context);
  }, options);
  if (!result)
    fail(
      "invalid_grant",
      "Reutilizarea credențialelor a revocat această delegare. Reconectează ChatGPT.",
      401,
    );
  return result;
}
export async function authenticateAssistantBearer(header: string | null) {
  if (!assistantEnabled())
    fail("temporarily_unavailable", "Conexiunea nu este activată.", 503);
  const value = header?.match(/^Bearer (fm_at_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!value) fail("invalid_token", "Autentificare OAuth necesară.", 401);
  const token = await prisma.assistantOAuthToken.findUnique({
    where: { tokenHash: hash(value) },
    select: { grantId: true, kind: true, expiresAt: true },
  });
  if (!token || token.kind !== "access" || token.expiresAt <= new Date())
    fail("invalid_token", "Tokenul a expirat.", 401);
  return prisma.$transaction((tx) => liveGrant(tx, token.grantId), options);
}
export async function revokeAssistantGrant(
  grantId: string,
  actor: AuthSession,
) {
  return prisma.$transaction(async (tx) => {
    await currentActor(tx, actor);
    await tx.$queryRaw`SELECT id FROM portfolio_assistant_oauth_grants WHERE id=${grantId} FOR UPDATE`;
    const grant = await tx.assistantOAuthGrant.findUnique({
      where: { id: grantId },
    });
    if (
      !grant ||
      (grant.userId !== actor.id &&
        !["SUPER_ADMIN", "COO"].includes(actor.role))
    )
      fail("access_denied", "Delegarea nu este accesibilă.", 403);
    await tx.assistantOAuthGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    });
    await recordTransactionalAudit(tx, {
      actor,
      action: "assistant.oauth.grant.revoked",
      entityType: "assistant_grant",
      entityId: grant.id,
    });
    return { revoked: true };
  }, options);
}
export async function disableAssistantClient(
  clientId: string,
  actor: AuthSession,
) {
  manager(actor);
  return prisma.$transaction(async (tx) => {
    await currentActor(tx, actor);
    await tx.assistantOAuthClient.update({
      where: { id: clientId },
      data: { disabledAt: new Date() },
    });
    await tx.assistantOAuthGrant.updateMany({
      where: { clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordTransactionalAudit(tx, {
      actor,
      action: "assistant.oauth.client.disabled",
      entityType: "assistant_client",
      entityId: clientId,
    });
    return { disabled: true };
  }, options);
}
export async function revokeAssistantToken(raw: Record<string, string>) {
  await prisma.$transaction(async (tx) => {
    await clientCredentials(tx, raw.client_id || "", raw.client_secret);
    const token = await tx.assistantOAuthToken.findUnique({
      where: { tokenHash: hash(raw.token || "") },
    });
    if (!token) return;
    await tx.$queryRaw`SELECT id FROM portfolio_assistant_oauth_grants WHERE id=${token.grantId} FOR UPDATE`;
    const grant = await tx.assistantOAuthGrant.findUnique({
      where: { id: token.grantId },
    });
    if (!grant || grant.clientId !== raw.client_id) return;
    await tx.assistantOAuthGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await recordTransactionalAudit(tx, {
      actor: { id: grant.userId },
      action: "assistant.oauth.token.revoked",
      entityType: "assistant_grant",
      entityId: grant.id,
    });
  }, options);
}
export async function assistantConnectionsState(actor: AuthSession) {
  const manage = ["SUPER_ADMIN", "COO"].includes(actor.role);
  const [clients, grants] = await Promise.all([
    manage
      ? prisma.assistantOAuthClient.findMany({
          select: {
            id: true,
            name: true,
            redirectUris: true,
            allowedScopes: true,
            disabledAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : Promise.resolve([]),
    prisma.assistantOAuthGrant.findMany({
      where: { userId: actor.id },
      select: {
        id: true,
        clientId: true,
        scopes: true,
        offline: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    enabled: assistantEnabled(),
    mcpUrl: assistantResource(),
    issuer: assistantBaseUrl(),
    allowedScopes: allowedAssistantScopes(actor.role),
    canManage: manage,
    clients,
    grants,
  };
}
