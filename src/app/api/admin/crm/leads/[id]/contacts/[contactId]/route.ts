import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { removeCrmContact, updateCrmContact } from "@/lib/crm-service";

type Context = { params: Promise<{ id: string; contactId: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(2).max(191).optional(),
  role: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id, contactId } = await context.params;
  try {
    const contact = await updateCrmContact(id, contactId, patchSchema.parse(await request.json()), session);
    await recordAudit({
      actor: session,
      action: "crm.contact_update",
      entityType: "crm_lead",
      entityId: id,
      metadata: { contactId },
      request
    });
    return NextResponse.json({ contact }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Contactul nu a putut fi actualizat." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id, contactId } = await context.params;
  try {
    const deleted = await removeCrmContact(id, contactId, session);
    await recordAudit({
      actor: session,
      action: "crm.contact_delete",
      entityType: "crm_lead",
      entityId: id,
      metadata: { contactId },
      request
    });
    return NextResponse.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Contactul nu a putut fi eliminat." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
