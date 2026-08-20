import { Prisma } from "@prisma/client";
import { z } from "zod";

const ruleModes = ["always_presume_paid", "presume_paid_if_immediate", "suggest_paid", "reconciliation_only", "never_auto"] as const;

export const supplierPaymentRuleSchema = z.object({
  legalEntityId: z.string().min(1), supplierId: z.string().min(1), ruleMode: z.enum(ruleModes),
  documentType: z.string().trim().max(80).optional().nullable(), supplierCategory: z.string().trim().max(120).optional().nullable(),
  requireSameDayDueDate: z.boolean().default(false), maxDueDays: z.number().int().min(0).max(365).optional().nullable(),
  amountLimit: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/).optional().nullable(), defaultPaymentMethod: z.string().trim().max(80).optional().nullable(),
  priority: z.number().int().min(1).max(10000).default(100), effectiveFrom: z.string().datetime().optional().nullable(), effectiveTo: z.string().datetime().optional().nullable()
});

export function supplierPaymentRuleData(body: z.infer<typeof supplierPaymentRuleSchema>, actorId: string) {
  return {
    legalEntityId: body.legalEntityId, supplierId: body.supplierId, ruleMode: body.ruleMode,
    documentType: body.documentType || null, supplierCategory: body.supplierCategory || null,
    requireSameDayDueDate: body.requireSameDayDueDate, maxDueDays: body.maxDueDays ?? null,
    amountLimit: body.amountLimit ? new Prisma.Decimal(body.amountLimit.replace(",", ".")) : null,
    defaultPaymentMethod: body.defaultPaymentMethod || null, priority: body.priority,
    effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null, effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
    createdByUserId: actorId
  };
}
