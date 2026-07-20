import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  findExistingClientAccountByNormalizedName,
  findOrCreateClientAccount,
  hasClientOwnershipConflict,
  normalizeClientName
} from "@/lib/clients";
import { prisma } from "@/lib/prisma";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { resolveRequiredSalesOwner } from "@/lib/seller-users";

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
    const clients = await prisma.clientAccount.findMany({
    where: {
      status: { notIn: ["merged", "archived"] },
      ...(query ? {
        OR: [
          { companyName: { contains: query } },
          { normalizedName: { contains: normalizeClientName(query) } },
          { taxId: { contains: query } }
        ]
      } : {})
    },
    include: {
      accountOwner: { select: { id: true, name: true, email: true, role: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 3 }
    },
    orderBy: { companyName: "asc" },
    take: 5000
  });
    const visibleClients = clients.map((client) => {
      const isOwnClient = session.role !== "SALES_AGENT" || client.accountOwnerUserId === session.id;
      if (isOwnClient) return client;
      return {
        ...client,
        billingAddress: null,
        generalEmail: null,
        generalPhone: null,
        notes: null,
        contacts: []
      };
    });
    return NextResponse.json({ clients: visibleClients }, { headers: noStoreHeaders });
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
    const existingClient = await findExistingClientAccountByNormalizedName(input.companyName);
    const owner = await resolveRequiredSalesOwner(session, input.accountOwnerUserId ?? existingClient?.accountOwnerUserId);
    if (hasClientOwnershipConflict(existingClient, session)) {
      return NextResponse.json(
        { error: "Clientul exista deja la alt owner. Cere reasignare sau merge de la COO/SUPER_ADMIN." },
        { status: 409, headers: noStoreHeaders }
      );
    }
    const client = await findOrCreateClientAccount({
      companyName: input.companyName,
      email: input.generalEmail,
      phone: input.generalPhone,
      accountOwnerUserId: owner.id
    }, session);
    if (!client) throw new Error("Clientul nu a putut fi creat.");
    const canIntentionallyReassign = ["SUPER_ADMIN", "COO"].includes(session.role);
    const nextOwnerUserId = existingClient
      ? canIntentionallyReassign && input.accountOwnerUserId !== undefined
        ? owner.id
        : client.accountOwnerUserId
      : owner.id;
    const updated = await prisma.clientAccount.update({
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
    await recordAudit({
      actor: session,
      action: "client.upsert",
      entityType: "client_account",
      entityId: updated.id,
      metadata: { companyName: input.companyName },
      request
    });
    return NextResponse.json({ client: updated }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Clientul nu a putut fi salvat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
