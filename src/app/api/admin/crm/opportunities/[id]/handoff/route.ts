import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { CrmDomainError } from "@/lib/crm-domain-service";
import { getCrmHandoffProposal, recordCrmHandoff } from "@/lib/crm-handoff";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };

const confirmSchema = z.object({
  version: z.number().int().nonnegative(),
  targetType: z.enum(["client_account", "campaign"]),
  targetId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(191)
});

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
      const input = confirmSchema.parse(await request.json());
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
  if (error instanceof CrmDomainError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Handoff-ul CRM nu a putut fi procesat." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
