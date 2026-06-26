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

export const ADMIN_COOKIE = "focus_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;

export type AuthSession = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
  iat: number;
  exp: number;
};

function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sessionSecret() {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "focus-media-local-development-secret-change-me";
  throw new Error("AUTH_SECRET trebuie sa aiba minimum 32 de caractere.");
}

function sign(payload: string) {
  return base64url(crypto.createHmac("sha256", sessionSecret()).update(payload).digest());
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionToken(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tokenVersion: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const session: AuthSession = { ...user, iat: now, exp: now + SESSION_SECONDS };
  const payload = base64url(JSON.stringify(session));
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
  const originError = mutationOriginError(request);
  if (originError) return { session: null, response: originError };
  const session = await getAuthSessionFromRequest(request);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Autentificare necesara." }, { status: 401 }) };
  }
  if (!hasPermission(session.role, permission)) {
    return { session, response: NextResponse.json({ error: "Nu ai permisiunea necesara." }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function requireAnyPermission(request: NextRequest, permissions: readonly Permission[]) {
  const originError = mutationOriginError(request);
  if (originError) return { session: null, response: originError };
  const session = await getAuthSessionFromRequest(request);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Autentificare necesara." }, { status: 401 }) };
  }
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
    "dashboard.operations.view",
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
    maxAge: SESSION_SECONDS
  });
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
  return `scrypt$${base64url(salt)}$${base64url(derived)}`;
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
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user && (await prisma.user.count()) === 0 && legacyAdminMatches(email, password)) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Administrator Focus Media",
        passwordHash: await hashPassword(password),
        role: "SUPER_ADMIN"
      }
    });
  }

  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) return null;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    tokenVersion: user.tokenVersion,
    dashboardPath: dashboardPathForRole(user.role as UserRole)
  };
}

function legacyAdminMatches(email: string, password: string) {
  const expectedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedEmail || !expectedPassword) return false;
  return secureEqual(email, expectedEmail) && secureEqual(password, expectedPassword);
}

function mutationOriginError(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host === request.nextUrl.host) return null;
  } catch {
    // Invalid Origin is rejected below.
  }
  return NextResponse.json({ error: "Origine nepermisa." }, { status: 403 });
}

function scrypt(password: string, salt: Buffer, keyLength = 64) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
