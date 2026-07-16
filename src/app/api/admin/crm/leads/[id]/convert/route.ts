import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { convertCrmLeadToClient } from "@/lib/crm-service";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const schema = z.object({
  clientId: z.string().trim().nullable().optional()
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const input = schema.parse(await request.json().catch(() => ({})));
    const converted = await convertCrmLeadToClient({ leadId: id, clientId: input.clientId }, session);
    await recordAudit({
      actor: session,
      action: "crm.lead_convert",
      entityType: "crm_lead",
      entityId: id,
      metadata: { clientId: converted.client.id },
      request
    });
    return NextResponse.json(converted, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead-ul nu a putut fi convertit.";
    return NextResponse.json({ error: message }, { status: message.includes("alt owner") ? 409 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
