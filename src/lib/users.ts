import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { USER_ROLES, type UserRole } from "@/lib/rbac";
import { assertUserCanBeDeactivated } from "@/lib/ownership-integrity";

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
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return users.map(serializeUser);
}

export async function createUser(input: unknown, actorRole: UserRole = "SUPER_ADMIN") {
  const parsed = createUserSchema.parse(input);
  assertUserRoleChangeAllowed(null, parsed.role, actorRole);
  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) throw new Error("Exista deja un utilizator cu acest email.");
  const user = await prisma.user.create({
    data: {
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      passwordHash: await hashPassword(parsed.password)
    }
  });
  return serializeUser(user);
}

export async function updateUser(id: string, input: unknown, actorId: string, actorRole: UserRole = "SUPER_ADMIN") {
  const parsed = updateUserSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new Error("Utilizatorul nu exista.");
  assertUserRoleChangeAllowed(existing.role as UserRole, parsed.role ?? existing.role as UserRole, actorRole);

  const removesSuperAdmin =
    existing.role === "SUPER_ADMIN" && (parsed.role !== undefined && parsed.role !== "SUPER_ADMIN" || parsed.active === false);
  if (removesSuperAdmin && (await activeSuperAdminCount()) <= 1) {
    throw new Error("Aplicatia trebuie sa pastreze cel putin un SUPER_ADMIN activ.");
  }
  if (id === actorId && parsed.active === false) {
    throw new Error("Nu iti poti dezactiva propriul cont.");
  }
  const removesCommercialOwnershipRole =
    ["SALES_AGENT", "SALES_DIRECTOR"].includes(existing.role) &&
    parsed.role !== undefined &&
    !["SALES_AGENT", "SALES_DIRECTOR"].includes(parsed.role);
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
    }
  });
  return serializeUser(user);
}

function assertUserRoleChangeAllowed(currentRole: UserRole | null, nextRole: UserRole, actorRole: UserRole) {
  if (actorRole === "SUPER_ADMIN") return;
  if (currentRole === "SUPER_ADMIN" || nextRole === "SUPER_ADMIN" || currentRole === "D_CEO" || nextRole === "D_CEO") {
    throw new Error("Doar SUPER_ADMIN poate crea sau modifica un cont SUPER_ADMIN sau D-CEO.");
  }
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
}): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    active: user.active,
    lastLoginAt: user.lastLoginAt?.toISOString() || null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}
