import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { assertRoleAssignmentAllowed, USER_ROLES, type UserRole } from "@/lib/rbac";
import { assertUserCanBeDeactivated } from "@/lib/ownership-integrity";
import { isSellerCapableRole } from "@/lib/sales-roles";

const roleSchema = z.enum(USER_ROLES);

const createUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
  role: roleSchema
});

const updateUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(12).max(128).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional()
});

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserAuditEventDTO = {
  id: string;
  action: string;
  actorLabel: string;
  reason: string | null;
  before: { role?: UserRole; active?: boolean } | null;
  after: { role?: UserRole; active?: boolean } | null;
  sessionsRevoked: boolean;
  createdAt: string;
};

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      authMfaCredential: { select: { enabledAt: true } }
    }
  });
  return users.map(serializeUser);
}

export async function getUserAccessState(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { role: true, active: true }
  });
  if (!user) throw new Error("Utilizatorul nu exista.");
  return { role: user.role as UserRole, active: user.active };
}

export async function createUser(input: unknown, actorRole: UserRole = "SUPER_ADMIN") {
  const parsed = createUserSchema.parse(input);
  assertRoleAssignmentAllowed(actorRole, null, parsed.role);
  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) throw new Error("Exista deja un utilizator cu acest email.");
  const user = await prisma.user.create({
    data: {
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      passwordHash: await hashPassword(parsed.password)
    },
    include: { authMfaCredential: { select: { enabledAt: true } } }
  });
  return serializeUser(user);
}

export async function updateUser(id: string, input: unknown, actorId: string, actorRole: UserRole = "SUPER_ADMIN") {
  const parsed = updateUserSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new Error("Utilizatorul nu exista.");
  assertRoleAssignmentAllowed(actorRole, existing.role as UserRole, parsed.role ?? existing.role as UserRole);

  const removesSuperAdmin =
    existing.role === "SUPER_ADMIN" && (parsed.role !== undefined && parsed.role !== "SUPER_ADMIN" || parsed.active === false);
  if (removesSuperAdmin && (await activeSuperAdminCount()) <= 1) {
    throw new Error("Aplicatia trebuie sa pastreze cel putin un SUPER_ADMIN activ.");
  }
  if (id === actorId && parsed.active === false) {
    throw new Error("Nu iti poti dezactiva propriul cont.");
  }
  if (id === actorId && parsed.role !== undefined && parsed.role !== existing.role) {
    throw new Error("Nu iti poti schimba propriul rol.");
  }
  const removesCommercialOwnershipRole =
    isSellerCapableRole(existing.role) &&
    parsed.role !== undefined &&
    !isSellerCapableRole(parsed.role);
  if (existing.active && (parsed.active === false || removesCommercialOwnershipRole)) {
    await assertUserCanBeDeactivated(id);
  }

  const securityChanged = parsed.password !== undefined || parsed.role !== undefined || parsed.active !== undefined;
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(parsed.email !== undefined ? { email: parsed.email } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.role !== undefined ? { role: parsed.role } : {}),
      ...(parsed.active !== undefined ? { active: parsed.active } : {}),
      ...(parsed.password !== undefined ? { passwordHash: await hashPassword(parsed.password) } : {}),
      ...(securityChanged ? { tokenVersion: { increment: 1 } } : {})
    },
    include: { authMfaCredential: { select: { enabledAt: true } } }
  });
  return serializeUser(user);
}

export async function getUserAuditEvents(userId: string, limit = 50): Promise<UserAuditEventDTO[]> {
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw new Error("Utilizatorul nu exista.");

  const rows = await prisma.auditLog.findMany({
    where: { entityType: "user", entityId: userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      action: true,
      metadata: true,
      createdAt: true,
      user: { select: { name: true } }
    }
  });

  return rows.map((row) => {
    const metadata = auditMetadata(row.metadata);
    return {
      id: row.id,
      action: row.action,
      actorLabel: row.user?.name || "Sistem",
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
      before: auditAccessState(metadata.before),
      after: auditAccessState(metadata.after),
      sessionsRevoked: metadata.sessionsRevoked === true,
      createdAt: row.createdAt.toISOString()
    };
  });
}

async function activeSuperAdminCount() {
  return prisma.user.count({ where: { role: "SUPER_ADMIN", active: true } });
}

function serializeUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authMfaCredential?: { enabledAt: Date | null } | null;
}): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    active: user.active,
    mfaEnabled: Boolean(user.authMfaCredential?.enabledAt),
    lastLoginAt: user.lastLoginAt?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function auditMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function auditAccessState(value: unknown): UserAuditEventDTO["before"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const state: { role?: UserRole; active?: boolean } = {};
  if (USER_ROLES.includes(String(raw.role) as UserRole)) state.role = String(raw.role) as UserRole;
  if (typeof raw.active === "boolean") state.active = raw.active;
  return Object.keys(state).length > 0 ? state : null;
}
