import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import {
  findExistingClientAccountByNormalizedName,
  findOrCreateClientAccount,
  hasClientOwnershipConflict,
  normalizeClientName,
  ClientMutationError,
  withAuthorizedClientMutation,
  lockClientAccounts,
  assertClientEditable
} from "@/lib/clients";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";
import { getClientsPage } from "@/lib/client-campaign-workspaces";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const schema = z.object({
  companyName: z.string().trim().min(2).max(191),
  clientType: z.enum(["direct_client", "agency"]).optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
  registryNumber: z.string().trim().max(120).nullable().optional(),
  billingAddress: z.string().trim().max(2000).nullable().optional(),
  generalEmail: z.string().trim().email().nullable().optional(),
  generalPhone: z.string().trim().max(80).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  status: z.enum(["prospect", "active", "inactive", "archived"]).optional(),
  accountOwnerUserId: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional()
});

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/clients", operation: "clients.list" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    const cursor = request.nextUrl.searchParams.get("cursor");
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    try {
      const page = await getClientsPage(session, { query, cursor, limit });
      return NextResponse.json({ clients: page.items, page }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json({ error: publicBusinessErrorMessage(error, "Lista clienților nu poate fi încărcată.", "clients", request) }, { status: publicBusinessErrorStatus(error, 503), headers: noStoreHeaders });
    }
  });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;
  try {
    const input = schema.parse(await request.json());
    if (session.role === "SALES_AGENT" && input.accountOwnerUserId && input.accountOwnerUserId !== session.id) {
      return NextResponse.json({ error: "Nu poti crea client pentru alt owner." }, { status: 403, headers: noStoreHeaders });
    }
    return await withAuthorizedClientMutation(session, [], async (tx) => {
      const candidate = await findExistingClientAccountByNormalizedName(input.companyName, tx);
      if (candidate) await lockClientAccounts(tx, [candidate.id]);
      const existingClient = candidate ? await tx.clientAccount.findUnique({ where: { id: candidate.id } }) : null;
      if (existingClient?.status === "merged") throw new ClientMutationError("Clientul a fost combinat. Reia cautarea.", 409);
      if (hasClientOwnershipConflict(existingClient, session)) {
        return NextResponse.json(
          { error: "Clientul exista deja la alt owner. Cere reasignare sau merge de la COO/SUPER_ADMIN." },
          { status: 409, headers: noStoreHeaders }
        );
      }
      if (existingClient) assertClientEditable(existingClient, session);
      const owner = await resolveRequiredSalesOwner(session, input.accountOwnerUserId ?? existingClient?.accountOwnerUserId, tx);
      const client = await findOrCreateClientAccount({
        companyName: input.companyName,
        email: input.generalEmail,
        phone: input.generalPhone,
        accountOwnerUserId: owner.id
      }, session, tx);
      if (!client) throw new Error("Clientul nu a putut fi creat.");
      const canIntentionallyReassign = ["SUPER_ADMIN", "COO"].includes(session.role);
      const nextOwnerUserId = existingClient
        ? canIntentionallyReassign && input.accountOwnerUserId !== undefined
          ? owner.id
          : client.accountOwnerUserId
        : owner.id;
      const updated = await tx.clientAccount.update({
        where: { id: client.id },
        data: {
          companyName: input.companyName,
          normalizedName: normalizeClientName(input.companyName),
          status: input.status && input.status !== "archived" ? input.status : "active",
          taxId: input.taxId,
          clientType: input.clientType || "direct_client",
          registryNumber: input.registryNumber,
          billingAddress: input.billingAddress,
          generalEmail: input.generalEmail,
          generalPhone: input.generalPhone,
          website: input.website,
          accountOwnerUserId: nextOwnerUserId,
          notes: input.notes
        },
        include: { accountOwner: { select: { id: true, name: true, email: true, role: true } } }
      });
      await recordTransactionalAudit(tx, {
        actor: session,
        action: "client.upsert",
        entityType: "client_account",
        entityId: updated.id,
        metadata: { companyName: input.companyName, previousOwnerUserId: existingClient?.accountOwnerUserId || null, nextOwnerUserId: updated.accountOwnerUserId },
      });
      return NextResponse.json({ client: updated }, { status: 201, headers: noStoreHeaders });
    });
  } catch (error) {
    return NextResponse.json(
      { error: publicBusinessErrorMessage(error, "Clientul nu a putut fi salvat.", "clients", request) },
      { status: publicBusinessErrorStatus(error, 400), headers: noStoreHeaders }
    );
  }
}
