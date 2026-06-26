import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canAssignSellerForAnotherUser } from "@/lib/seller-users";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const statusSchema = z.enum([
  "cold",
  "qualified",
  "in_analysis",
  "in_offer",
  "in_negotiation",
  "in_contracting",
  "on_hold",
  "no_response",
  "account_management",
  "won",
  "lost",
  "inactive",
  "new",
  "contacted",
  "brief_received",
  "offer_sent",
  "negotiation",
  "hold_created"
]);

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
  status: statusSchema.optional(),
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

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;

  const { id } = await context.params;
  try {
    const existing = await prisma.crmLead.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Lead-ul nu exista." }, { status: 404, headers: noStoreHeaders });
    if (session.role === "SALES_AGENT" && existing.assignedToUserId !== session.id) {
      return NextResponse.json({ error: "Poti modifica doar lead-urile tale." }, { status: 403, headers: noStoreHeaders });
    }

    const input = patchSchema.parse(await request.json());
    const assignedToUserId = input.assignedToUserId === undefined
      ? existing.assignedToUserId
      : await resolveAssignedUser(session, input.assignedToUserId);
    const statusChanged = input.status && input.status !== existing.status;

    const lead = await prisma.crmLead.update({
      where: { id },
      data: {
        ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
        ...(input.leadDate !== undefined ? { leadDate: parseDate(input.leadDate) } : {}),
        ...(input.clientType !== undefined ? { clientType: input.clientType } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.assignedToUserId !== undefined ? { assignedToUserId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.estimatedValue !== undefined ? { estimatedValue: input.estimatedValue } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.probability !== undefined ? { probability: input.probability } : {}),
        ...(input.expectedCloseDate !== undefined ? { expectedCloseDate: parseDate(input.expectedCloseDate) } : {}),
        ...(input.nextFollowUpDate !== undefined ? { nextFollowUpDate: parseDate(input.nextFollowUpDate) } : {}),
        ...(input.locationsInterested !== undefined ? { locationsInterested: input.locationsInterested } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
        activities: statusChanged || input.activityNote
          ? {
              create: {
                userId: session.id,
                type: statusChanged ? "status_change" : "note",
                actionType: statusChanged ? "status_change" : "note",
                statusAtTime: input.status || existing.status,
                details: input.activityNote || input.notes,
                locations: input.locationsInterested,
                nextFollowUpDate: parseDate(input.nextFollowUpDate),
                note: input.activityNote || (statusChanged ? `Status schimbat din ${existing.status} in ${input.status}.` : "Actualizare lead.")
              }
            }
          : undefined
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 3 },
        activities: { orderBy: { activityDate: "desc" }, take: 8 }
      }
    });

    await recordAudit({
      actor: session,
      action: "crm.lead_update",
      entityType: "crm_lead",
      entityId: id,
      metadata: { input, previousStatus: existing.status, previousAssignedToUserId: existing.assignedToUserId },
      request
    });

    return NextResponse.json({ lead }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead-ul nu a putut fi actualizat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

async function resolveAssignedUser(session: { id: string; role: string }, requestedId?: string | null) {
  if (requestedId && requestedId !== session.id && !canAssignSellerForAnotherUser(session as never)) {
    throw new Error("Nu poti asigna lead-ul catre alt vanzator.");
  }
  const targetId = requestedId || session.id;
  const target = await prisma.user.findFirst({
    where: { id: targetId, active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
    select: { id: true }
  });
  if (!target) {
    if (targetId === session.id && ["COO", "SUPER_ADMIN"].includes(session.role)) return session.id;
    throw new Error("Responsabilul ales nu este un vanzator valid.");
  }
  return target.id;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
