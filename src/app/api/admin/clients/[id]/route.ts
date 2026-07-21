import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeClientName } from "@/lib/clients";
import { prisma } from "@/lib/prisma";
import { assertClientCanBeArchived } from "@/lib/ownership-integrity";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";
import { getClientOverview } from "@/lib/client-campaign-workspaces";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const patchSchema = z.object({
  companyName: z.string().trim().min(2).max(191).optional(),
  clientType: z.enum(["direct_client", "agency"]).optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
  registryNumber: z.string().trim().max(120).nullable().optional(),
  billingAddress: z.string().trim().max(2000).nullable().optional(),
  generalEmail: z.string().trim().email().nullable().optional(),
  generalPhone: z.string().trim().max(80).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  status: z.enum(["prospect", "active", "inactive", "archived"]).optional(),
  accountOwnerUserId: z.string().trim().nullable().optional(),
  ownerChangeReason: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional()
});

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const client = await getClientOverview(session, id);
  if (!client) return NextResponse.json({ error: "Clientul nu exista." }, { status: 404, headers: noStoreHeaders });
  return NextResponse.json({ client }, { headers: noStoreHeaders });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;

  try {
    const input = patchSchema.parse(await request.json());
    const existing = await prisma.clientAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Clientul nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    if (session.role === "SALES_AGENT" && existing.accountOwnerUserId !== session.id) {
      return NextResponse.json({ error: "Poti edita doar clientii tai." }, { status: 403, headers: noStoreHeaders });
    }
    if (session.role === "SALES_AGENT" && input.accountOwnerUserId && input.accountOwnerUserId !== session.id) {
      return NextResponse.json({ error: "Nu poti schimba account owner-ul." }, { status: 403, headers: noStoreHeaders });
    }
    if (input.status === "archived" && existing.status !== "archived") {
      await assertClientCanBeArchived(id);
    }
    if (input.accountOwnerUserId !== undefined && input.accountOwnerUserId !== existing.accountOwnerUserId) {
      if (!input.ownerChangeReason?.trim()) {
        return NextResponse.json({ error: "Motivul schimbarii owner-ului este obligatoriu." }, { status: 400, headers: noStoreHeaders });
      }
      await resolveRequiredSalesOwner(session, input.accountOwnerUserId);
    }

    const updated = await prisma.clientAccount.update({
      where: { id },
      data: {
        ...(input.companyName !== undefined ? {
          companyName: input.companyName,
          normalizedName: normalizeClientName(input.companyName)
        } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.clientType !== undefined ? { clientType: input.clientType } : {}),
        ...(input.registryNumber !== undefined ? { registryNumber: input.registryNumber } : {}),
        ...(input.billingAddress !== undefined ? { billingAddress: input.billingAddress } : {}),
        ...(input.generalEmail !== undefined ? { generalEmail: input.generalEmail } : {}),
        ...(input.generalPhone !== undefined ? { generalPhone: input.generalPhone } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.accountOwnerUserId !== undefined ? { accountOwnerUserId: input.accountOwnerUserId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {})
      },
      include: { accountOwner: { select: { id: true, name: true, email: true, role: true } } }
    });

    await recordAudit({
      actor: session,
      action: "client.update",
      entityType: "client_account",
      entityId: id,
      metadata: {
        changedOwner: input.accountOwnerUserId !== undefined && input.accountOwnerUserId !== existing.accountOwnerUserId,
        previousOwnerUserId: existing.accountOwnerUserId,
        nextOwnerUserId: updated.accountOwnerUserId,
        ownerChangeReason: input.ownerChangeReason || null,
        companyName: updated.companyName
      },
      request
    });

    return NextResponse.json({ client: updated }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Clientul nu a putut fi salvat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
