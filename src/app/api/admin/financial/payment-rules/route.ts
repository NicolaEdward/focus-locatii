import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { supplierPaymentRuleData, supplierPaymentRuleSchema } from "@/lib/supplier-payment-rules";

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const legalEntityId = request.nextUrl.searchParams.get("legalEntityId") || undefined;
  const supplierId = request.nextUrl.searchParams.get("supplierId") || undefined;
  const rules = await prisma.supplierPaymentRule.findMany({
    where: { ...(legalEntityId ? { legalEntityId } : {}), ...(supplierId ? { supplierId } : {}) },
    include: { legalEntity: { select: { legalName: true, code: true } }, supplier: { select: { supplierName: true, taxId: true } } },
    orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "desc" }], take: 500
  });
  return NextResponse.json({ rules: rules.map((rule) => ({ ...rule, amountLimit: rule.amountLimit?.toFixed(2) || null })) }, { headers });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  try {
    const body = supplierPaymentRuleSchema.parse(await request.json());
    const [entity, supplier] = await Promise.all([
      prisma.financialLegalEntity.findUnique({ where: { id: body.legalEntityId } }),
      prisma.supplier.findUnique({ where: { id: body.supplierId } })
    ]);
    if (!entity || !supplier) throw new Error("Entitatea juridica sau furnizorul nu exista.");
    const rule = await prisma.supplierPaymentRule.create({ data: supplierPaymentRuleData(body, session.id) });
    await recordAudit({ actor: session, action: "financial.supplier_payment_rule_created", entityType: "supplier_payment_rule", entityId: rule.id, metadata: { legalEntityId: rule.legalEntityId, supplierId: rule.supplierId, ruleMode: rule.ruleMode }, request });
    return NextResponse.json({ ok: true, rule: { ...rule, amountLimit: rule.amountLimit?.toFixed(2) || null } }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Regula nu a putut fi creata." }, { status: 400, headers });
  }
}
