import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { normalizeClientName } from "@/lib/clients";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ aliasName: z.string().trim().min(2).max(191), clientId: z.string().trim().min(1) }).strict();

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const alias = await prisma.financialClientAlias.update({
      where: { id },
      data: { aliasName: body.aliasName, normalizedAlias: normalizeClientName(body.aliasName), clientId: body.clientId }
    });
    await prisma.auditLog.create({ data: { userId: session.id, action: "receivables.alias_updated", entityType: "financial_client_alias", entityId: id, metadata: body } });
    return NextResponse.json({ alias });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Aliasul nu a putut fi actualizat." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    await prisma.$transaction([
      prisma.financialClientAlias.delete({ where: { id } }),
      prisma.auditLog.create({ data: { userId: session.id, action: "receivables.alias_deleted", entityType: "financial_client_alias", entityId: id } })
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Aliasul nu a putut fi șters." }, { status: 400 });
  }
}
