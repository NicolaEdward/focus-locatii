import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canAssignSellerForAnotherUser } from "@/lib/seller-users";

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

const leadSchema = z.object({
  leadDate: z.string().trim().nullable().optional(),
  companyName: z.string().trim().min(2).max(191),
  clientType: z.enum(["direct_client", "agency"]).nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  contactName: z.string().trim().max(191).nullable().optional(),
  contactRole: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  source: z.string().trim().max(191).nullable().optional(),
  assignedToUserId: z.string().trim().nullable().optional(),
  status: statusSchema.default("cold"),
  estimatedValue: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.enum(["RON", "EUR"]).default("EUR"),
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.string().trim().nullable().optional(),
  nextFollowUpDate: z.string().trim().nullable().optional(),
  locationsInterested: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional()
});

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;

  const leads = await prisma.crmLead.findMany({
    where: session.role === "SALES_AGENT" ? { assignedToUserId: session.id } : {},
    include: {
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 3 },
      activities: { orderBy: { activityDate: "desc" }, take: 8 }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500
  });
  return NextResponse.json({ leads }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;

  try {
    const input = leadSchema.parse(await request.json());
    const assignedToUserId = await resolveAssignedUser(session, input.assignedToUserId);
    const lead = await prisma.crmLead.create({
      data: {
        companyName: input.companyName,
        leadDate: parseDate(input.leadDate) || new Date(),
        clientType: input.clientType,
        clientId: input.clientId,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        source: input.source,
        assignedToUserId,
        createdByUserId: session.id,
        status: input.status,
        estimatedValue: input.estimatedValue,
        currency: input.currency,
        probability: input.probability,
        expectedCloseDate: parseDate(input.expectedCloseDate),
        nextFollowUpDate: parseDate(input.nextFollowUpDate),
        locationsInterested: input.locationsInterested,
        notes: input.notes,
        contacts: input.contactName
          ? {
              create: {
                name: input.contactName,
                role: input.contactRole,
                phone: input.phone,
                email: input.email,
                isPrimary: true
              }
            }
          : undefined,
        activities: {
          create: {
            userId: session.id,
            type: "prospectare",
            actionType: "prospectare",
            statusAtTime: input.status,
            details: input.notes || "Lead creat.",
            locations: input.locationsInterested,
            nextFollowUpDate: parseDate(input.nextFollowUpDate),
            note: input.notes || "Lead creat."
          }
        }
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        activities: { orderBy: { activityDate: "desc" }, take: 8 }
      }
    });

    await recordAudit({
      actor: session,
      action: "crm.lead_create",
      entityType: "crm_lead",
      entityId: lead.id,
      metadata: { assignedToUserId },
      request
    });

    return NextResponse.json({ lead }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead-ul nu a putut fi creat." },
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
