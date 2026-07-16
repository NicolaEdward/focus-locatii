import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { addCrmContact } from "@/lib/crm-service";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(2).max(191),
  role: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const input = schema.parse(await request.json());
    const contact = await addCrmContact(id, input, session);
    await recordAudit({
      actor: session,
      action: "crm.contact_create",
      entityType: "crm_lead",
      entityId: id,
      metadata: { contactId: contact.id },
      request
    });
    return NextResponse.json({ contact }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Contactul nu a putut fi adaugat." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
