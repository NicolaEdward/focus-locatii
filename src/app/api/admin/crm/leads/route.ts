import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { createCrmLead, listCrmLeads } from "@/lib/crm-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

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
  status: z.string().trim().default("new"),
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
  try {
    const result = await listCrmLeads({
      query: request.nextUrl.searchParams.get("q") || "",
      status: request.nextUrl.searchParams.get("status") || "",
      assignee: request.nextUrl.searchParams.get("assignee") || "",
      due: (request.nextUrl.searchParams.get("due") || "all") as never,
      clientType: request.nextUrl.searchParams.get("clientType") || "",
      source: request.nextUrl.searchParams.get("source") || "",
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      limit: Number(request.nextUrl.searchParams.get("limit") || 30)
    }, session);
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead-urile nu au putut fi incarcate." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  try {
    const input = leadSchema.parse(await request.json());
    const lead = await createCrmLead({
      ...input,
      leadDate: parseDate(input.leadDate),
      expectedCloseDate: parseDate(input.expectedCloseDate),
      nextFollowUpDate: parseDate(input.nextFollowUpDate)
    }, session);
    await recordAudit({
      actor: session,
      action: "crm.lead_create",
      entityType: "crm_lead",
      entityId: lead.id,
      metadata: { assignedToUserId: lead.assignedToUserId, status: lead.status },
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

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data introdusa nu este valida.");
  return date;
}
