import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { isKnownCrmStatus } from "@/lib/crm";
import { addCrmActivity, listCrmActivities } from "@/lib/crm-service";
import { resolveCrmNotificationsForLead } from "@/lib/notifications";
import { crmLegacyWriteDisabledResponse } from "@/lib/crm-legacy";

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
  actionType: z.enum([
    "prospectare",
    "telefon",
    "email",
    "vizita",
    "whatsapp",
    "meeting",
    "note",
    "offer_sent",
    "follow_up",
    "call_connected",
    "call_no_answer",
    "email_sent",
    "meeting_held",
    "qualification",
    "brief_received"
  ]),
  details: z.string().trim().min(2).max(5000),
  locations: z.string().trim().max(5000).nullable().optional(),
  nextStep: z.string().trim().max(2000).nullable().optional(),
  nextFollowUpDate: z.string().trim().nullable().optional(),
  status: z.string().trim().refine(isKnownCrmStatus, "Etapa CRM nu este valida.").nullable().optional()
});

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const activities = await listCrmActivities(id, session, Number(request.nextUrl.searchParams.get("limit") || 50));
    return NextResponse.json({ activities }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Activitatile nu au putut fi incarcate." },
      { status: 403, headers: noStoreHeaders }
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  return crmLegacyWriteDisabledResponse();
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data introdusa nu este valida.");
  return date;
}
