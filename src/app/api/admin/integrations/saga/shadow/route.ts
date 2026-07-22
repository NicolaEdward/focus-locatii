import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/auth";
import { getSagaIntegrationStatus } from "@/lib/integrations/saga/config";
import { runSagaShadowReconciliation } from "@/lib/integrations/saga/shadow-reconciliation";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/integrations/saga/shadow", operation: "saga.shadow.status" }, async () => {
    const { session, response } = await requirePermission(request, "finance.integrations.saga.view");
    if (response || !session) return response;
    setObservabilityRole(session.role);
    return NextResponse.json({ status: getSagaIntegrationStatus() }, { headers });
  });
}

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/integrations/saga/shadow", operation: "saga.shadow.reconcile" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.integrations.saga.sync", "finance.integrations.saga.reconcile"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    try {
      const report = await runSagaShadowReconciliation();
      return NextResponse.json({ report }, { headers });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SAGA_SHADOW_FAILED";
      return NextResponse.json({ error: code === "SAGA_SHADOW_DISABLED" ? "Rularea shadow este dezactivata in acest mediu." : "Reconcilierea shadow nu a putut fi rulata." }, { status: code === "SAGA_SHADOW_DISABLED" ? 409 : 500, headers });
    }
  });
}
