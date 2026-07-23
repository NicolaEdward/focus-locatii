import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  dashboardPathForRole,
  hasAnyPermission,
  hasPermission,
  isUserRole,
  type Permission,
  type UserRole
} from "@/lib/rbac";
import { AUTH_SESSION_SECONDS, createAuthSessionRecord, resolveRegisteredSession } from "@/lib/auth-sessions";
import { mutationRequestError } from "@/lib/request-security";
import { authSecret, base64Url, secureEqual } from "@/lib/security-secrets";
import { dceoBusinessMutationError } from "@/lib/business-mutation-policy";

export const ADMIN_COOKIE = "focus_admin_session";

export type AuthSession = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
  sessionId?: string;
  mfaVerifiedAt?: string;
  iat: number;
  exp: number;
};

function sign(payload: string) {
  return base64Url(crypto.createHmac("sha256", authSecret()).update(payload).digest());
}

export function createSessionToken(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
  sessionId?: string;
  mfaVerifiedAt?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const session: AuthSession = { ...user, iat: now, exp: now + AUTH_SESSION_SECONDS };
  const payload = base64Url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): AuthSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secureEqual(sign(payload), signature)) return null;

  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    const session = JSON.parse(json) as AuthSession;
    if (
      !session.id ||
      !session.email ||
      !session.name ||
      !isUserRole(session.role) ||
      !Number.isInteger(session.tokenVersion) ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function resolveSession(session: AuthSession | null) {
  if (!session) return null;
  if (session.sessionId) {
    const record = await resolveRegisteredSession({ id: session.id, sessionId: session.sessionId, tokenVersion: session.tokenVersion });
    if (!record || !isUserRole(record.user.role)) return null;
    return {
      ...session,
      ...record.user,
      role: record.user.role as UserRole,
      mfaVerifiedAt: record.mfaVerifiedAt?.toISOString() || session.mfaVerifiedAt
    };
  }
  const user = await prisma.user.findFirst({
    where: { id: session.id, active: true, tokenVersion: session.tokenVersion },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true }
  });
  if (!user || !isUserRole(user.role)) return null;
  return { ...session, ...user, role: user.role as UserRole };
}

export async function getAuthSession() {
  const store = await cookies();
  return resolveSession(verifySessionToken(store.get(ADMIN_COOKIE)?.value));
}

export const getAdminSession = getAuthSession;

export async function getAuthSessionFromRequest(request: NextRequest) {
  return resolveSession(verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value));
}

export async function requirePermission(request: NextRequest, permission: Permission) {
  const originError = mutationRequestError(request);
  if (originError) return { session: null, response: originError };
  const session = await getAuthSessionFromRequest(request);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Autentificare necesara." }, { status: 401 }) };
  }
  const businessMutationError = dceoBusinessMutationError(request, session.role);
  if (businessMutationError) return { session, response: businessMutationError };
  if (!hasPermission(session.role, permission)) {
    return { session, response: NextResponse.json({ error: "Nu ai permisiunea necesara." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function requireAnyPermission(request: NextRequest, permissions: readonly Permission[]) {
  const originError = mutationRequestError(request);
  if (originError) return { session: null, response: originError };
  const session = await getAuthSessionFromRequest(request);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Autentificare necesara." }, { status: 401 }) };
  }
  const businessMutationError = dceoBusinessMutationError(request, session.role);
  if (businessMutationError) return { session, response: businessMutationError };
  if (!hasAnyPermission(session.role, permissions)) {
    return { session, response: NextResponse.json({ error: "Nu ai permisiunea necesara." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function requireAdmin(request: NextRequest) {
  return requireAnyPermission(request, [
    "dashboard.admin.view",
    "dashboard.executive.view",
    "dashboard.sales.view",
    "dashboard.agent.view",
    "dashboard.finance.view"
  ]);
}

export function setSessionCookie(response: NextResponse, user: Parameters<typeof createSessionToken>[0]) {
  response.cookies.set(ADMIN_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_SECONDS
  });
}

export async function establishAuthenticatedSession(
  response: NextResponse,
  user: Parameters<typeof createSessionToken>[0],
  request: NextRequest,
  mfaVerifiedAt?: Date | null
) {
  const record = await createAuthSessionRecord(user.id, request, mfaVerifiedAt);
  setSessionCookie(response, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion,
    sessionId: record.id,
    mfaVerifiedAt: mfaVerifiedAt?.toISOString()
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return record;
}

export function clearAdminCookie(response: NextResponse) {
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt);
  return `scrypt$${base64Url(salt)}$${base64Url(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, hashValue] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  try {
    const salt = Buffer.from(saltValue.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const expected = Buffer.from(hashValue.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const actual = await scrypt(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function authenticateCredentials(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { authMfaCredential: { select: { enabledAt: true } } }
  });

  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    tokenVersion: user.tokenVersion,
    mfaEnrolled: Boolean(user.authMfaCredential?.enabledAt),
    dashboardPath: dashboardPathForRole(user.role as UserRole)
  };
}

function scrypt(password: string, salt: Buffer, keyLength = 64) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
