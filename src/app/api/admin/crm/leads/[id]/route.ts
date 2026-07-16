import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getCrmLead, updateCrmLead } from "@/lib/crm-service";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const patchSchema = z.object({
  leadDate: z.string().trim().nullable().optional(),
  companyName: z.string().trim().min(2).max(191).optional(),
  clientType: z.enum(["direct_client", "agency"]).nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  contactName: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  source: z.string().trim().max(191).nullable().optional(),
  assignedToUserId: z.string().trim().nullable().optional(),
  status: z.string().trim().optional(),
  estimatedValue: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.enum(["RON", "EUR"]).nullable().optional(),
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.string().trim().nullable().optional(),
  nextFollowUpDate: z.string().trim().nullable().optional(),
  locationsInterested: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  lostReason: z.string().trim().max(1000).nullable().optional(),
  activityNote: z.string().trim().max(2000).nullable().optional()
});

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const lead = await getCrmLead(id, session);
    if (!lead) return NextResponse.json({ error: "Lead-ul nu exista sau nu este accesibil." }, { status: 404, headers: noStoreHeaders });
    return NextResponse.json({ lead }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead-ul nu a putut fi incarcat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const input = patchSchema.parse(await request.json());
    const { leadDate, expectedCloseDate, nextFollowUpDate, ...patch } = input;
    const lead = await updateCrmLead(id, {
      ...patch,
      ...(leadDate !== undefined ? { leadDate: parseDate(leadDate) } : {}),
      ...(expectedCloseDate !== undefined ? { expectedCloseDate: parseDate(expectedCloseDate) } : {}),
      ...(nextFollowUpDate !== undefined ? { nextFollowUpDate: parseDate(nextFollowUpDate) } : {})
    }, session);
    await recordAudit({
      actor: session,
      action: "crm.lead_update",
      entityType: "crm_lead",
      entityId: id,
      metadata: {
        fields: Object.keys(input),
        status: input.status,
        assignedToUserId: input.assignedToUserId
      },
      request
    });
    return NextResponse.json({ lead }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead-ul nu a putut fi actualizat.";
    return NextResponse.json({ error: message }, { status: message.includes("doar lead-urile tale") ? 403 : 400, headers: noStoreHeaders });
  }
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data introdusa nu este valida.");
  return date;
}
