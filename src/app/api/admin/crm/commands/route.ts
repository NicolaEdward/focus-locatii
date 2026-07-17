import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  addCrmCompanyContact,
  addCrmUpdate,
  createColdProspect,
  createInboundOpportunity,
  CrmDomainError,
  qualifyProspect,
  qualifyProspectAndCreateOpportunity,
  transitionOpportunity,
  transitionProspect,
  updateCrmCompany
} from "@/lib/crm-domain-service";
import { resolveCrmNotificationsForRecord } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const baseSchema = z.object({ action: z.string().min(1), idempotencyKey: z.string().trim().max(191).nullable().optional() }).passthrough();

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  try {
    const raw = baseSchema.parse(await request.json());
    const result = await executeCommand(raw, session);
    const target = commandTarget(raw);
    if (target) await resolveCrmNotificationsForRecord(target.kind, target.id, session.id);
    await recordAudit({ actor: session, action: `crm.v4.${raw.action}`, entityType: "crm_domain", entityId: recordId(result), metadata: { command: raw.action }, request });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Date CRM invalide.", code: "CRM_INPUT_INVALID" }, { status: 400 });
    if (error instanceof CrmDomainError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comanda CRM nu a putut fi executata." }, { status: 400 });
  }
}

async function executeCommand(raw: z.infer<typeof baseSchema>, session: NonNullable<Awaited<ReturnType<typeof requireAnyPermission>>["session"]>) {
  if (raw.action === "create_prospect") {
    const input = createProspectSchema.parse(raw);
    return createColdProspect({ ...input, nextActionDueAt: dateOrNull(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "create_inbound") {
    const input = createInboundSchema.parse(raw);
    return createInboundOpportunity({ ...input, desiredPeriodStart: dateOrNull(input.desiredPeriodStart), desiredPeriodEnd: dateOrNull(input.desiredPeriodEnd), nextActionDueAt: dateOrNull(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "qualify_and_create_opportunity") {
    const input = qualifySchema.parse(raw);
    return qualifyProspectAndCreateOpportunity({ ...input, desiredPeriodStart: dateOrNull(input.desiredPeriodStart), desiredPeriodEnd: dateOrNull(input.desiredPeriodEnd), nextActionDueAt: requiredDate(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "qualify_prospect") {
    const input = qualifyOnlySchema.parse(raw);
    return qualifyProspect({ ...input, nextActionDueAt: requiredDate(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "transition_prospect") {
    const input = transitionProspectSchema.parse(raw);
    return transitionProspect({ ...input, returnAt: dateOrNull(input.returnAt), nextActionDueAt: dateOrNull(input.nextActionDueAt) }, session);
  }
  if (raw.action === "transition_opportunity") {
    const input = transitionOpportunitySchema.parse(raw);
    return transitionOpportunity({ ...input, decisionDate: dateOrNull(input.decisionDate), nextActionDueAt: dateOrNull(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "add_update") {
    const input = updateSchema.parse(raw);
    return addCrmUpdate({ ...input, nextActionDueAt: dateOrNull(input.nextActionDueAt), idempotencyKey: input.idempotencyKey }, session);
  }
  if (raw.action === "update_company") return updateCrmCompany(updateCompanySchema.parse(raw), session);
  if (raw.action === "add_contact") return addCrmCompanyContact(contactSchema.parse(raw), session);
  throw new CrmDomainError("Comanda CRM nu este cunoscuta.", "CRM_COMMAND_UNKNOWN", 400);
}

const optionalText = z.string().trim().max(5000).nullable().optional();
const optionalDate = z.string().trim().nullable().optional();
const idempotency = z.string().trim().max(191).nullable().optional();

const createProspectSchema = z.object({
  action: z.literal("create_prospect"), companyName: z.string().trim().min(2).max(191), taxId: optionalText, industry: optionalText,
  website: optionalText, source: optionalText, ownerId: optionalText, contactName: optionalText, contactRole: optionalText,
  email: z.string().trim().email().nullable().optional().or(z.literal("")), phone: optionalText, nextActionType: optionalText,
  nextActionDescription: optionalText, nextActionDueAt: optionalDate, allowPotentialDuplicate: z.boolean().optional(), idempotencyKey: idempotency
});
const createInboundSchema = z.object({
  action: z.literal("create_inbound"), companyName: z.string().trim().min(2).max(191), taxId: z.string().trim().min(2).max(80),
  industry: optionalText, website: optionalText, source: optionalText, ownerId: optionalText, contactName: z.string().trim().min(2).max(191),
  contactRole: optionalText, email: z.string().trim().email().nullable().optional().or(z.literal("")), phone: optionalText,
  opportunityName: optionalText, needSummary: z.string().trim().min(3).max(5000), geography: optionalText, formats: optionalText,
  desiredPeriodStart: optionalDate, desiredPeriodEnd: optionalDate, nextActionType: optionalText, nextActionDescription: optionalText,
  nextActionDueAt: optionalDate, allowPotentialDuplicate: z.boolean().optional(), idempotencyKey: idempotency
});
const qualifySchema = z.object({
  action: z.literal("qualify_and_create_opportunity"), prospectId: z.string().min(1), version: z.number().int().nonnegative(),
  qualificationSummary: z.record(z.unknown()), opportunityName: z.string().trim().min(2).max(191), needSummary: z.string().trim().min(3).max(5000),
  desiredPeriodStart: optionalDate, desiredPeriodEnd: optionalDate, geography: optionalText, formats: optionalText, budgetStatus: optionalText,
  budgetMin: z.number().nonnegative().nullable().optional(), budgetMax: z.number().nonnegative().nullable().optional(), currency: z.enum(["EUR", "RON"]).nullable().optional(),
  nextActionType: z.string().min(1), nextActionDescription: optionalText, nextActionDueAt: z.string().min(1), idempotencyKey: idempotency
});
const qualifyOnlySchema = z.object({
  action: z.literal("qualify_prospect"), prospectId: z.string().min(1), version: z.number().int().nonnegative(),
  qualificationSummary: z.record(z.unknown()), nextActionDueAt: z.string().min(1), idempotencyKey: idempotency
});
const transitionProspectSchema = z.object({
  action: z.literal("transition_prospect"), prospectId: z.string().min(1), version: z.number().int().nonnegative(), toStatus: z.string().min(1),
  reason: optionalText, returnAt: optionalDate, nextActionType: optionalText, nextActionDescription: optionalText, nextActionDueAt: optionalDate
});
const transitionOpportunitySchema = z.object({
  action: z.literal("transition_opportunity"), opportunityId: z.string().min(1), version: z.number().int().nonnegative(), toStage: z.string().min(1),
  reason: optionalText, lostReasonCode: optionalText, competitor: optionalText, quotedValue: z.number().nonnegative().nullable().optional(), revisedValue: z.number().nonnegative().nullable().optional(),
  agreedValue: z.number().nonnegative().nullable().optional(), currency: z.enum(["EUR", "RON"]).nullable().optional(), decisionDate: optionalDate,
  nextActionType: optionalText, nextActionDescription: optionalText, nextActionDueAt: optionalDate, idempotencyKey: idempotency
});
const updateSchema = z.object({
  action: z.literal("add_update"), kind: z.enum(["prospect", "opportunity"]), id: z.string().min(1), version: z.number().int().nonnegative(),
  type: z.string().trim().min(2).max(80), summary: z.string().trim().min(2).max(5000), result: optionalText, contactState: optionalText,
  nextActionType: optionalText, nextActionDescription: optionalText, nextActionDueAt: optionalDate, idempotencyKey: idempotency
});
const updateCompanySchema = z.object({
  action: z.literal("update_company"), companyId: z.string().min(1), version: z.number().int().nonnegative(), name: z.string().trim().min(2).max(191).optional(),
  taxId: optionalText, industry: optionalText, website: optionalText, ownerId: optionalText, reason: optionalText
});
const contactSchema = z.object({
  action: z.literal("add_contact"), companyId: z.string().min(1), name: z.string().trim().min(2).max(191), role: optionalText,
  email: z.string().trim().email().nullable().optional().or(z.literal("")), phone: optionalText, preferredChannel: optionalText,
  isDecisionMaker: z.boolean().optional(), isPrimary: z.boolean().optional()
});

function dateOrNull(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CrmDomainError("Data introdusa nu este valida.");
  return parsed;
}

function requiredDate(value: string) {
  const parsed = dateOrNull(value);
  if (!parsed) throw new CrmDomainError("Data urmatoarei actiuni este obligatorie.");
  return parsed;
}

function recordId(result: unknown) {
  return result && typeof result === "object" && "id" in result ? String(result.id) : null;
}

function commandTarget(raw: z.infer<typeof baseSchema>) {
  const prospectId = typeof raw.prospectId === "string" ? raw.prospectId : raw.kind === "prospect" && typeof raw.id === "string" ? raw.id : null;
  if (prospectId) return { kind: "crm_prospect" as const, id: prospectId };
  const opportunityId = typeof raw.opportunityId === "string" ? raw.opportunityId : raw.kind === "opportunity" && typeof raw.id === "string" ? raw.id : null;
  return opportunityId ? { kind: "crm_opportunity" as const, id: opportunityId } : null;
}
