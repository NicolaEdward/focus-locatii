import { prisma } from "@/lib/prisma";
import { randomOpaqueToken, securityHash } from "@/lib/security-secrets";
import type { Prisma } from "@prisma/client";

export const AUTH_ACTION_TYPES = ["MFA_LOGIN", "PASSWORD_RESET", "USER_INVITE"] as const;
export type AuthActionType = typeof AUTH_ACTION_TYPES[number];

export async function issueAuthActionToken(input: {
  type: AuthActionType;
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  createdByUserId?: string | null;
  ttlSeconds: number;
  metadata?: Record<string, unknown> | null;
}) {
  const token = randomOpaqueToken();
  const tokenHash = authActionTokenHash(input.type, token);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.authActionToken.updateMany({
      where: {
        type: input.type,
        usedAt: null,
        ...(input.userId ? { userId: input.userId } : input.email ? { email: input.email.toLowerCase() } : {})
      },
      data: { usedAt: now }
    });
    await tx.authActionToken.create({
      data: {
        tokenHash,
        type: input.type,
        userId: input.userId || null,
        email: input.email?.toLowerCase() || null,
        name: input.name || null,
        role: input.role || null,
        createdByUserId: input.createdByUserId || null,
        expiresAt,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      }
    });
  });

  return { token, expiresAt };
}

export async function findUsableAuthActionToken(type: AuthActionType, token: string) {
  if (!token || token.length > 256) return null;
  return prisma.authActionToken.findFirst({
    where: {
      type,
      tokenHash: authActionTokenHash(type, token),
      usedAt: null,
      expiresAt: { gt: new Date() }
    }
  });
}

export function authActionTokenHash(type: AuthActionType, token: string) {
  return securityHash(`auth-action:${type}`, token);
}
