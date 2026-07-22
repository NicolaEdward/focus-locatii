import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestIpHash, safeUserAgent } from "@/lib/request-security";

export const AUTH_SESSION_SECONDS = 60 * 60 * 12;

export async function createAuthSessionRecord(userId: string, request: NextRequest, mfaVerifiedAt?: Date | null) {
  const now = new Date();
  const record = await prisma.authSessionRecord.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      ipHash: requestIpHash(request),
      userAgent: safeUserAgent(request),
      mfaVerifiedAt: mfaVerifiedAt || null,
      expiresAt: new Date(now.getTime() + AUTH_SESSION_SECONDS * 1000)
    },
    select: { id: true, expiresAt: true }
  });
  return record;
}

export async function resolveRegisteredSession(session: {
  id: string;
  sessionId: string;
  tokenVersion: number;
}) {
  const record = await prisma.authSessionRecord.findFirst({
    where: {
      id: session.sessionId,
      userId: session.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { active: true, tokenVersion: session.tokenVersion }
    },
    select: {
      id: true,
      mfaVerifiedAt: true,
      user: { select: { id: true, email: true, name: true, role: true, tokenVersion: true } }
    }
  });
  return record;
}

export async function listAuthSessions(userId: string, currentSessionId?: string | null) {
  const sessions = await prisma.authSessionRecord.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      userAgent: true,
      mfaVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true
    },
    orderBy: { createdAt: "desc" },
    take: 30
  });
  return sessions.map((session) => ({
    ...session,
    current: session.id === currentSessionId,
    mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() || null,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() || null
  }));
}

export async function revokeAuthSession(userId: string, sessionId: string) {
  return prisma.authSessionRecord.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function revokeAllAuthSessions(userId: string, exceptSessionId?: string | null) {
  return prisma.authSessionRecord.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() }
  });
}
