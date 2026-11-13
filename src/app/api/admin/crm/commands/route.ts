import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { claimCrmCommandIntention, crmDomainIntentionKey, CrmIntentionConflict, markCrmIntentionRejected, type CrmIntentionClaim } from "@/lib/crm-command-intents";
import { emitStructuredLog, safeErrorCode } from "@/lib/observability";
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
import { crmParseDateInput, CrmDateInputError } from "@/lib/crm-time";
import { resolveCrmNotificationsForRecord } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const baseSchema = z.object({ action: z.string().min(1), idempotencyKey: z.string().trim().max(191).nullable().optional() }).passthrough();

const noStore = { "Cache-Control": "no-store" };

// A lookup is evidence of an issued command only. No event is not proof of rollback.
export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
  if (response || !session) return response;
  const parsed = z.string().trim().min(1).max(191).safeParse(request.nextUrl.searchParams.get("intentKey"));
  if (!parsed.success) return NextResponse.json({ error: "Identificatorul intentiei este necesar." }, { status: 400, headers: noStore });
  try {
    const key = parsed.data;
    const domainKey = crmDomainIntentionKey(session.id, key);
    const keys = [domainKey, key];
    const rows = await prisma.crmEvent.findMany({
      where: {
        actorUserId: session.id,
        idempotencyKey: { in: keys.flatMap((k) => [k, `${k}:prospect`, `${k}:opportunity`]) },
        ...(!hasPermission(session.role, "leads.view") ? { OR: [{ prospect: { ownerId: session.id } }, { opportunity: { ownerId: session.id } }, { company: { ownerId: session.id } }] } : {})
      },
      select: { idempotencyKey: true, prospectId: true, opportunityId: true }, take: 6
    });
    const recordedOutcome = await prisma.auditLog.findFirst({ where: { userId: session.id, action: { startsWith: "crm.v4." }, entityType: "crm_domain", metadata: { path: "$.commandKey", equals: key } }, select: { id: true } });
    const direct = rows.some((r) => keys.includes(r.idempotencyKey || ""));
    const completedInbound = rows.some((r) => keys.some((k) => r.idempotencyKey === `${k}:opportunity`));
    const outcome = direct || completedInbound || recordedOutcome ? "committed" : rows.length ? "partial" : "unknown";
    const records = [...new Map(rows.flatMap((r) => r.opportunityId ? [{ kind: "opportunity", id: r.opportunityId }] : r.prospectId ? [{ kind: "prospect", id: r.prospectId }] : []).map((r) => [`${r.kind}:${r.id}`, r])).values()];
    return NextResponse.json({ outcome, records, commandKey: key, recovery: "verify_before_retry", message: outcome === "committed" ? "Intentia are un rezultat inregistrat. Verifica dosarul; cererea nu a fost retrimisa." : "Rezultatul complet nu poate fi confirmat. Verifica dosarul si istoricul; nu retrimite comanda." }, { headers: noStore });
  } catch {
    return NextResponse.json({ outcome: "unknown", recovery: "verify_before_retry", error: "Verificarea rezultatului nu este disponibila. Comanda nu a fost retrimisa." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
  if (response || !session) return response;
  let raw: z.infer<typeof baseSchema> | null = null;
  let result: unknown;
  let committed = false;
  let claim: CrmIntentionClaim | null = null;
  try {
    raw = baseSchema.parse(await request.json());
    claim = await claimCrmCommandIntention(raw, session);
    result = await executeCommand(claim ? { ...raw, idempotencyKey: claim.domainKey } : raw, session);
    committed = true;
    const target = commandTarget(raw);
    if (target) {
      try { await resolveCrmNotificationsForRecord(target.kind, target.id, session.id); }
      catch (error) { emitStructuredLog("error", "crm_notification_resolution_failed", { operation: "crm.command.post_commit", role: session.role, entityType: target.kind, entityId: target.id, errorCode: safeErrorCode(error, "CRM_NOTIFICATION_RESOLUTION_FAILED") }); }
    }
    try {
      await recordAudit({ actor: session, action: `crm.v4.${raw.action}`, entityType: "crm_domain", entityId: recordId(result), metadata: { command: raw.action, commandKey: raw.idempotencyKey || null }, request });
    } catch (error) {
      emitStructuredLog("error", "crm_command_audit_incomplete", { operation: "crm.command.post_commit", role: session.role, entityId: recordId(result), correlationId: session.auditRequestId, errorCode: safeErrorCode(error, "AUDIT_PERSISTENCE_FAILED") });
      return NextResponse.json({ result, outcome: "committed", auditStatus: "incomplete", warning: "Comanda a fost salvata, dar jurnalul suplimentar nu a putut fi completat. Verifica istoricul; nu retrimite comanda.", recovery: "verify_before_retry", auditRequestId: session.auditRequestId || null, commandKey: raw.idempotencyKey || null }, { headers: noStore });
    }
    return NextResponse.json({ result, outcome: "committed", auditStatus: "complete", auditRequestId: session.auditRequestId || null, commandKey: raw.idempotencyKey || null }, { headers: noStore });
  } catch (error) {
    if (committed) return NextResponse.json({ result, outcome: "committed", auditStatus: "incomplete", warning: "Comanda a fost salvata. Verifica dosarul si istoricul inainte de orice actiune noua.", recovery: "verify_before_retry", auditRequestId: session.auditRequestId || null, commandKey: raw?.idempotencyKey || null }, { headers: noStore });
    if (error instanceof CrmIntentionConflict) return NextResponse.json({ error: error.message, code: error.code, outcome: "unknown", recovery: "verify_before_retry", auditRequestId: session.auditRequestId || null, commandKey: raw?.idempotencyKey || null }, { status: 409, headers: noStore });
    if (error instanceof z.ZodError || error instanceof CrmDomainError && raw?.action !== "create_inbound") {
      try { await markCrmIntentionRejected(claim, session); } catch { return NextResponse.json({ error: "Rezultatul intentiei nu poate fi confirmat. Verifica istoricul inainte de o actiune noua.", outcome: "unknown", recovery: "verify_before_retry", auditRequestId: session.auditRequestId || null, commandKey: raw?.idempotencyKey || null }, { status: 503, headers: noStore }); }
    }
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Date CRM invalide.", code: "CRM_INPUT_INVALID", outcome: "rejected" }, { status: 400, headers: noStore });
    // Inbound creates a prospect before a separate opportunity transaction. Its
    // later domain rejection can therefore leave an intentionally committed record.
    if (error instanceof CrmDomainError && raw?.action !== "create_inbound") return NextResponse.json({ error: error.message, code: error.code, details: error.details, outcome: "rejected" }, { status: error.status, headers: noStore });
    return NextResponse.json({ error: "Rezultatul comenzii CRM nu poate fi confirmat. Verifica dosarul si istoricul inainte de a face alta actiune; nu retrimite automat comanda.", code: "CRM_COMMAND_OUTCOME_UNKNOWN", outcome: "unknown", recovery: "verify_before_retry", auditRequestId: session.auditRequestId || null, commandKey: raw?.idempotencyKey || null }, { status: isTemporaryDatabaseError(error) ? 503 : 500, headers: noStore });
  }
}

function isTemporaryDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (["P1001", "P2024", "P2028"].includes(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /Transaction already closed|Transaction not found|expired transaction|Can't reach database server/i.test(message);
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
  website: optionalText, source: optionalText, ownerId: optionalText, status: z.enum(["prospecting", "qualified", "return_later", "disqualified", "on_hold", "inactive"]).optional(), contactName: optionalText, contactRole: optionalText,
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
  qualificationSummary: z.record(z.string(), z.unknown()), opportunityName: z.string().trim().min(2).max(191), needSummary: z.string().trim().min(3).max(5000),
  desiredPeriodStart: optionalDate, desiredPeriodEnd: optionalDate, geography: optionalText, formats: optionalText, budgetStatus: optionalText,
  budgetMin: z.number().nonnegative().nullable().optional(), budgetMax: z.number().nonnegative().nullable().optional(), currency: z.enum(["EUR", "RON"]).nullable().optional(),
  nextActionType: z.string().min(1), nextActionDescription: optionalText, nextActionDueAt: z.string().min(1), idempotencyKey: idempotency
});
const qualifyOnlySchema = z.object({
  action: z.literal("qualify_prospect"), prospectId: z.string().min(1), version: z.number().int().nonnegative(),
  qualificationSummary: z.record(z.string(), z.unknown()), nextActionDueAt: z.string().min(1), idempotencyKey: idempotency
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
  try { return crmParseDateInput(value); }
  catch (error) {
    if (error instanceof CrmDateInputError) throw new z.ZodError([{ code: "custom", path: [], message: error.message }]);
    throw error;
  }
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
