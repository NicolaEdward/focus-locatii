import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { CrmDomainError } from "@/lib/crm-domain-service";
import { getCrmHandoffProposal, prepareCrmCommercialDraft, recordCrmHandoff } from "@/lib/crm-handoff";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { JsonRequestError, readBoundedJson } from "@/lib/bounded-json-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };

const confirmSchema = z.object({
  version: z.number().int().nonnegative(),
  targetType: z.enum(["client_account", "campaign"]),
  targetId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(191)
});

const prepareSchema = z.object({
  action: z.literal("prepare"),
  version: z.number().int().nonnegative(),
  currency: z.enum(["RON", "EUR"]),
  companyEntity: z.enum(["Focus Media", "Excellence Media", "Focus BG / Focus Media LLC EOOD"]),
  idempotencyKey: z.string().trim().min(8).max(191),
}).strict();

export async function GET(request: NextRequest, context: Context) {
  return observeRoute(request, { route: "/api/admin/crm/opportunities/[id]/handoff", operation: "crm.handoff.preview" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["leads.view", "leads.view.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    try {
      const proposal = await getCrmHandoffProposal((await context.params).id, session);
      return NextResponse.json({ proposal }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export async function POST(request: NextRequest, context: Context) {
  return observeRoute(request, { route: "/api/admin/crm/opportunities/[id]/handoff", operation: "crm.handoff.confirm" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["leads.manage", "leads.manage.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    try {
      const opportunityId = (await context.params).id;
      const body = await readBoundedJson(request, 8192);
      if (body && typeof body === "object" && "action" in body && body.action === "prepare") {
        const { action: _action, ...input } = prepareSchema.parse(body);
        // The command records its evidence in the same transaction as the draft.
        // No post-commit audit write may turn a successful prepare into a false failure.
        const result = await prepareCrmCommercialDraft({ opportunityId, ...input }, session);
        return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
      }
      const input = confirmSchema.parse(body);
      const result = await recordCrmHandoff({ opportunityId, ...input }, session);
      await recordAudit({
        actor: session,
        action: "crm.v4.handoff.confirm",
        entityType: "crm_opportunity",
        entityId: opportunityId,
        metadata: { targetType: input.targetType, targetId: input.targetId, repeated: result.repeated },
        request
      });
      return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Confirmarea nu este valida." }, { status: 400 });
      return errorResponse(error);
    }
  });
}

function errorResponse(error: unknown) {
  if (error instanceof JsonRequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof CrmDomainError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ error: "Pregătirea comercială nu a putut fi confirmată. Verifică dosarul și reia aceeași cerere înainte de a începe o acțiune nouă.", code: "CRM_HANDOFF_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
