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

const activitySchema = z.object({
  activityDate: z.string().trim().nullable().optional(),
  actionType: z.enum(["prospectare", "telefon", "email", "vizita", "whatsapp", "meeting", "note", "offer_sent", "follow_up", "status_change"]).default("note"),
  statusAtTime: z.string().trim().max(80).nullable().optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  locations: z.string().trim().max(5000).nullable().optional(),
  nextStep: z.string().trim().max(2000).nullable().optional(),
  nextFollowUpDate: z.string().trim().nullable().optional()
});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const lead = await prisma.crmLead.findUnique({ where: { id } });
    if (!lead) return NextResponse.json({ error: "Lead-ul nu exista." }, { status: 404, headers: noStoreHeaders });
    if (session.role === "SALES_AGENT" && lead.assignedToUserId !== session.id) {
      return NextResponse.json({ error: "Poti adauga activitati doar pe lead-urile tale." }, { status: 403, headers: noStoreHeaders });
    }
    const input = activitySchema.parse(await request.json());
    const activity = await prisma.crmActivity.create({
      data: {
        leadId: id,
        userId: session.id,
        type: input.actionType,
        actionType: input.actionType,
        activityDate: parseDate(input.activityDate) || new Date(),
        statusAtTime: input.statusAtTime || lead.status,
        details: input.details,
        locations: input.locations,
        nextStep: input.nextStep,
        nextFollowUpDate: parseDate(input.nextFollowUpDate),
        note: input.details
      }
    });
    await prisma.crmLead.update({
      where: { id },
      data: {
        ...(input.statusAtTime ? { status: input.statusAtTime } : {}),
        ...(input.nextFollowUpDate !== undefined ? { nextFollowUpDate: parseDate(input.nextFollowUpDate) } : {}),
        ...(input.locations !== undefined ? { locationsInterested: input.locations } : {})
      }
    });
    await recordAudit({
      actor: session,
      action: "crm.activity_create",
      entityType: "crm_lead",
      entityId: id,
      metadata: input,
      request
    });
    return NextResponse.json({ activity }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Activitatea CRM nu a putut fi salvata." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
