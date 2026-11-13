import { publicBusinessErrorMessage, publicBusinessErrorStatus } from "@/lib/public-business-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { withAuthorizedClientMutation, assertClientEditable, ClientMutationError } from "@/lib/clients";
import { getClientContacts } from "@/lib/client-campaign-workspaces";

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

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.view", "clients.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ contacts: await getClientContacts(session, id) }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: publicBusinessErrorMessage(error, "Contactele nu pot fi afisate.", "clients.detail.contacts", request) }, { status: publicBusinessErrorStatus(error, 403), headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["clients.manage", "clients.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;

  try {
    const input = contactSchema.parse(await request.json());
    return await withAuthorizedClientMutation(session, [id], async (tx) => {
      const client = await tx.clientAccount.findUnique({ where: { id }, select: { id: true, accountOwnerUserId: true, status: true } });
      if (!client) return NextResponse.json({ error: "Clientul nu exista." }, { status: 404, headers: noStoreHeaders });
      assertClientEditable(client, session);
      const contact = await tx.clientContact.create({
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
        await tx.clientContact.updateMany({
          where: { clientId: id, id: { not: contact.id } },
          data: { isPrimary: false }
        });
      }
      await recordTransactionalAudit(tx, {
        actor: session,
        action: "client.contact_create",
        entityType: "client_contact",
        entityId: contact.id,
        metadata: { clientId: id, name: input.name },
      });
      return NextResponse.json({ contact }, { status: 201, headers: noStoreHeaders });
    });
  } catch (error) {
    return NextResponse.json(
      { error: publicBusinessErrorMessage(error, "Contactul nu a putut fi salvat.", "clients.detail.contacts", request) },
      { status: publicBusinessErrorStatus(error, 400), headers: noStoreHeaders }
    );
  }
}
