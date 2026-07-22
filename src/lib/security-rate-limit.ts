import { prisma } from "@/lib/prisma";
import { securityHash } from "@/lib/security-secrets";

export type RateLimitRule = {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
};

export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + rule.windowSeconds * 1000);
  const keyHash = securityHash("distributed-rate-limit", `${rule.scope}:${rule.identifier}`);

  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO portfolio_security_rate_limits
        (keyHash, scope, count, windowStartedAt, expiresAt, updatedAt)
      VALUES
        (${keyHash}, ${rule.scope}, 1, ${now}, ${expiresAt}, ${now})
      ON DUPLICATE KEY UPDATE
        count = IF(expiresAt <= ${now}, 1, count + 1),
        windowStartedAt = IF(expiresAt <= ${now}, ${now}, windowStartedAt),
        expiresAt = IF(expiresAt <= ${now}, ${expiresAt}, expiresAt),
        updatedAt = ${now}
    `;
    return tx.securityRateLimit.findUniqueOrThrow({ where: { keyHash } });
  });
  const allowed = row.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000))
  };
}

export async function clearRateLimit(scope: string, identifier: string) {
  const keyHash = securityHash("distributed-rate-limit", `${scope}:${identifier}`);
  await prisma.securityRateLimit.deleteMany({ where: { keyHash } });
}

export async function purgeExpiredRateLimits(now = new Date()) {
  return prisma.securityRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
}

export function rateLimitKey(scope: string, identifier: string) {
  return securityHash("distributed-rate-limit", `${scope}:${identifier}`);
}
