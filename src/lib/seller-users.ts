import { prisma } from "@/lib/prisma";
import type { AuthSession } from "@/lib/auth";

const sellerRoles = ["SALES_AGENT", "SALES_DIRECTOR"] as const;
const assignerRoles = ["SALES_DIRECTOR", "COO", "SUPER_ADMIN"] as const;

export type SellerUserDTO = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function canAssignSellerForAnotherUser(actor?: AuthSession | null) {
  return Boolean(actor && assignerRoles.includes(actor.role as never));
}

export async function listSellerUsers() {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: [...sellerRoles] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }]
  });
  return users.map((user) => ({ ...user, role: String(user.role) }));
}

export async function resolveRequiredSalesOwner(actor: AuthSession, requestedUserId?: string | null) {
  if (actor.role === "SALES_AGENT" && requestedUserId && requestedUserId !== actor.id) {
    throw new Error("Nu poti asigna inregistrarea catre alt vanzator.");
  }
  const actorIsSeller = sellerRoles.includes(actor.role as never);
  const targetUserId = requestedUserId || (actorIsSeller ? actor.id : null);
  if (!targetUserId) {
    throw new Error("Alege un agent sau director de vanzari responsabil.");
  }
  if (targetUserId !== actor.id && !canAssignSellerForAnotherUser(actor)) {
    throw new Error("Nu poti crea sau realoca pe alt vanzator.");
  }
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, active: true, role: { in: [...sellerRoles] } },
    select: { id: true, name: true, email: true, role: true }
  });
  if (!target) throw new Error("Responsabilul trebuie sa fie un utilizator comercial activ.");
  return target;
}

export async function resolveSellerForMutation(input: {
  actor?: AuthSession | null;
  sellerUserId?: string | null;
  legacySalesperson?: string | null;
  existingSellerUserId?: string | null;
  existingOwnerId?: string | null;
  existingSalesperson?: string | null;
  keepExisting?: boolean;
}) {
  const actor = input.actor;
  if (!actor) {
    return {
      sellerUserId: input.sellerUserId || input.existingSellerUserId || null,
      ownerId: input.sellerUserId || input.existingOwnerId || null,
      salesperson: input.legacySalesperson || input.existingSalesperson || null
    };
  }

  if (input.keepExisting && (input.existingSellerUserId || input.existingOwnerId || input.existingSalesperson)) {
    return {
      sellerUserId: input.existingSellerUserId || input.existingOwnerId || actor.id,
      ownerId: input.existingOwnerId || input.existingSellerUserId || actor.id,
      salesperson: input.existingSalesperson || actor.name
    };
  }

  const requestedSellerId = input.sellerUserId || null;
  if (requestedSellerId && requestedSellerId !== actor.id && !canAssignSellerForAnotherUser(actor)) {
    throw new Error("Nu poti crea sau realoca pe alt vanzator.");
  }

  const target = await resolveRequiredSalesOwner(actor, requestedSellerId);

  return {
    sellerUserId: target.id,
    ownerId: target.id,
    salesperson: target.name
  };
}
