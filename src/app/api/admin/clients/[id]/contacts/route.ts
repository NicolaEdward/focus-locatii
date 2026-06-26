import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const contactSchema = z.object({
  name: z.string().trim().min(2).max(191),
  role: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;

  try {
    const input = contactSchema.parse(await request.json());
    const client = await prisma.clientAccount.findUnique({ where: { id }, select: { id: true, accountOwnerUserId: true } });
    if (!client) return NextResponse.json({ error: "Clientul nu exista." }, { status: 404, headers: noStoreHeaders });
    if (session.role === "SALES_AGENT" && client.accountOwnerUserId !== session.id) {
      return NextResponse.json({ error: "Poti edita doar clientii tai." }, { status: 403, headers: noStoreHeaders });
    }
    const contact = await prisma.clientContact.create({
      data: {
        clientId: id,
        name: input.name,
        role: input.role || null,
        email: input.email || null,
        phone: input.phone || null,
        isPrimary: Boolean(input.isPrimary),
        notes: input.notes || null
      }
    });
    if (input.isPrimary) {
      await prisma.clientContact.updateMany({
        where: { clientId: id, id: { not: contact.id } },
        data: { isPrimary: false }
      });
    }
    await recordAudit({
      actor: session,
      action: "client.contact_create",
      entityType: "client_contact",
      entityId: contact.id,
      metadata: { clientId: id, name: input.name },
      request
    });
    return NextResponse.json({ contact }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Contactul nu a putut fi salvat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
