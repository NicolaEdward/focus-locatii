import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { normalizeClientName, withAuthorizedClientMutation, assertClientEditable, ClientMutationError } from "@/lib/clients";
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
    return await withAuthorizedClientMutation(session, [id], async (tx) => {
      const existing = await tx.clientAccount.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "Clientul nu exista." }, { status: 404, headers: noStoreHeaders });
      }
      assertClientEditable(existing, session);
      if (session.role === "SALES_AGENT" && input.accountOwnerUserId && input.accountOwnerUserId !== session.id) {
        return NextResponse.json({ error: "Nu poti schimba account owner-ul." }, { status: 403, headers: noStoreHeaders });
      }
      if (input.status === "archived" && existing.status !== "archived") {
        const [campaigns, reservations, receivables] = await Promise.all([
          tx.campaign.count({ where: { clientId: id, archivedAt: null, status: { not: "archived" } } }),
          tx.reservation.count({ where: { clientId: id, status: { in: ["HOLD", "RESERVED", "BOOKED"] }, periodEnd: { gte: new Date() } } }),
          tx.financialReceivable.count({ where: { clientId: id, includedInReport: true, remainingAmount: { gt: 0 } } })
        ]);
        if (campaigns || reservations || receivables) throw new ClientMutationError(`Clientul are dependente active (campanii ${campaigns}, rezervari ${reservations}, facturi deschise ${receivables}) si nu poate fi arhivat.`, 400);
      }
      if (input.accountOwnerUserId !== undefined && input.accountOwnerUserId !== existing.accountOwnerUserId) {
        if (!input.ownerChangeReason?.trim()) {
          return NextResponse.json({ error: "Motivul schimbarii owner-ului este obligatoriu." }, { status: 400, headers: noStoreHeaders });
        }
        if (!input.accountOwnerUserId) throw new ClientMutationError("Alege un vanzator responsabil.", 400);
        await resolveRequiredSalesOwner(session, input.accountOwnerUserId, tx);
      }

      const updated = await tx.clientAccount.update({
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

      await recordTransactionalAudit(tx, {
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
      });

      return NextResponse.json({ client: updated }, { headers: noStoreHeaders });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Clientul nu a putut fi salvat." },
      { status: error instanceof ClientMutationError ? error.status : 400, headers: noStoreHeaders }
    );
  }
}
