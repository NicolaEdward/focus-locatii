import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeClientName } from "@/lib/clients";
import type { AuthSession } from "@/lib/auth";

const optionalText = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return text || null;
}, z.string().nullable().optional());

export const supplierInputSchema = z.object({
  supplierName: z.string().trim().min(2).max(191),
  taxId: optionalText,
  registryNumber: optionalText,
  billingAddress: optionalText,
  generalEmail: optionalText,
  generalPhone: optionalText,
  website: optionalText,
  notes: optionalText
});

export async function createSupplier(input: unknown, actor: AuthSession) {
  const parsed = supplierInputSchema.parse(input);
  const normalizedName = normalizeClientName(parsed.supplierName);
  const existing = await prisma.supplier.findFirst({
    where: { normalizedName, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" }
  });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      ...parsed,
      normalizedName,
      status: "active",
      createdByUserId: actor.id
    }
  });
}

export async function updateSupplier(id: string, input: unknown) {
  const parsed = supplierInputSchema.partial().extend({
    status: z.enum(["active", "inactive", "archived"]).optional()
  }).parse(input);
  return prisma.supplier.update({
    where: { id },
    data: {
      ...parsed,
      ...(parsed.supplierName ? { normalizedName: normalizeClientName(parsed.supplierName) } : {}),
      ...(parsed.status === "archived" ? { archivedAt: new Date() } : {})
    }
  });
}
