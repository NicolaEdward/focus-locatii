import { prisma } from "../src/lib/prisma";

const tables = ["portfolio_auth_mfa_credentials", "portfolio_auth_recovery_codes", "portfolio_auth_action_tokens", "portfolio_auth_sessions", "portfolio_security_rate_limits"];

async function main() {
  const [activeSuperAdmins, totalSuperAdmins, loggedInSuperAdmins, existingTables] = await Promise.all([
    prisma.user.count({ where: { role: "SUPER_ADMIN", active: true } }),
    prisma.user.count({ where: { role: "SUPER_ADMIN" } }),
    prisma.user.count({ where: { role: "SUPER_ADMIN", active: true, lastLoginAt: { not: null } } }),
    prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`,
      ...tables
    )
  ]);
  const existing = existingTables.map((row) => row.TABLE_NAME).sort();
  console.log(JSON.stringify({
    activeSuperAdmins,
    totalSuperAdmins,
    activeSuperAdminsWithSuccessfulLogin: loggedInSuperAdmins,
    authTables: existing,
    schemaReady: tables.every((table) => existing.includes(table)),
    runtimeBootstrapCodeRemoved: true,
    legacyBootstrapEnvironmentPresent: Boolean(process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD),
    email: {
      providerConfigured: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL),
      authDeliveryEnabled: process.env.AUTH_EMAIL_DELIVERY_ENABLED === "true"
    },
    mfa: {
      enforcementMode: process.env.MFA_ENFORCEMENT_MODE || "off",
      requiredRoles: process.env.MFA_REQUIRED_ROLES || "SUPER_ADMIN,COO",
      dedicatedEncryptionKey: Boolean(process.env.AUTH_MFA_ENCRYPTION_KEY)
    }
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
