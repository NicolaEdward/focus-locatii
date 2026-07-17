import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { isKnownCrmStatus } from "@/lib/crm";
import { createCrmLead, listCrmLeads } from "@/lib/crm-service";
import { crmLegacyWriteDisabledResponse } from "@/lib/crm-legacy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().email().nullable().optional()
);

const qualificationSchema = z.object({
  needConfirmed: z.boolean().optional(),
  periodKnown: z.boolean().optional(),
  geographyKnown: z.boolean().optional(),
  formatsKnown: z.boolean().optional(),
  budgetKnown: z.boolean().optional(),
  decisionMakerKnown: z.boolean().optional()
}).nullable().optional();

const leadSchema = z.object({
  leadDate: z.string().trim().nullable().optional(),
  companyName: z.string().trim().min(2).max(191),
  taxId: z.string().trim().min(2, "Completeaza CUI / CIF-ul firmei.").max(80),
  industry: z.string().trim().min(2, "Alege domeniul de activitate.").max(120),
  opportunityName: z.string().trim().max(191).nullable().optional(),
  clientType: z.enum(["direct_client", "agency"]).nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  contactName: z.string().trim().max(191).nullable().optional(),
  contactRole: z.string().trim().max(191).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  email: optionalEmail,
  source: z.string().trim().max(191).nullable().optional(),
  assignedToUserId: z.string().trim().nullable().optional(),
  status: z.string().trim().refine(isKnownCrmStatus, "Etapa CRM nu este valida.").default("cold"),
  estimatedValue: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.enum(["RON", "EUR"]).default("EUR"),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.string().trim().nullable().optional(),
  nextFollowUpDate: z.string().trim().nullable().optional(),
  nextStep: z.string().trim().max(2000).nullable().optional(),
  qualificationData: qualificationSchema,
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
      industry: request.nextUrl.searchParams.get("industry") || "",
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
  return crmLegacyWriteDisabledResponse();
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Data introdusa nu este valida.");
  return date;
}
