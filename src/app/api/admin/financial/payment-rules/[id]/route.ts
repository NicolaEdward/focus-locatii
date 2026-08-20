import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { supplierPaymentRuleData, supplierPaymentRuleSchema } from "@/lib/supplier-payment-rules";

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const existing = await prisma.supplierPaymentRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Regula nu exista." }, { status: 404, headers });
    const body = supplierPaymentRuleSchema.parse(await request.json());
    const data = supplierPaymentRuleData(body, existing.createdByUserId || session.id);
    const rule = await prisma.supplierPaymentRule.update({ where: { id }, data: { ...data, createdByUserId: existing.createdByUserId, active: true } });
    await recordAudit({ actor: session, action: "financial.supplier_payment_rule_updated", entityType: "supplier_payment_rule", entityId: id, metadata: { before: { ruleMode: existing.ruleMode, active: existing.active }, after: { ruleMode: rule.ruleMode, active: rule.active } }, request });
    return NextResponse.json({ ok: true, rule: { ...rule, amountLimit: rule.amountLimit?.toFixed(2) || null } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Regula nu a putut fi actualizata." }, { status: 400, headers });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const existing = await prisma.supplierPaymentRule.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Regula nu exista." }, { status: 404, headers });
  const rule = await prisma.supplierPaymentRule.update({ where: { id }, data: { active: false } });
  await recordAudit({ actor: session, action: "financial.supplier_payment_rule_disabled", entityType: "supplier_payment_rule", entityId: id, metadata: { before: { active: existing.active }, after: { active: false } }, request });
  return NextResponse.json({ ok: true, rule: { id: rule.id, active: rule.active } }, { headers });
}
