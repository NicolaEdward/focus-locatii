import type { AuthSession } from "@/lib/auth";
import { getCooDashboardData } from "@/lib/dashboard/coo-dashboard";
import { getSalesDashboardData } from "@/lib/dashboard/sales-dashboard";
import { getExecutiveOverview } from "@/lib/dashboard/executive/overview";
import { getContractControlReport } from "@/lib/contract-control";
import { emitStructuredLog } from "@/lib/observability";

export type RoleDashboardData =
  | Awaited<ReturnType<typeof getExecutiveOverview>>
  | Awaited<ReturnType<typeof getCooDashboardData>>
  | Awaited<ReturnType<typeof getSalesDashboardData>>;

export async function getRoleDashboardData(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  if (["COO", "D_CEO", "SUPER_ADMIN"].includes(session.role)) {
    const [overview, control] = await Promise.all([
      getExecutiveOverview(session, input),
      getContractControlReport({ scope: "current" }, session).catch(() => {
        emitStructuredLog("error", "executive_contract_control_failed", { route: "/admin/dashboard", operation: "contract_control", role: session.role });
        return null;
      }),
    ]);
    return { ...overview, contractControl: control ? {
      generatedAt: control.generatedAt, complete: control.complete, sourceState: control.source.state,
      current: control.summary.current, unpriced: control.summary.issues.missing_price,
      entityMismatches: control.summary.issues.entity_mismatch, missingReferences: control.summary.issues.missing_contract,
      unassignedClients: control.summary.unassignedClients,
    } : null };
  }
  if (["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role)) return getSalesDashboardData(session);
  throw new Error(`Dashboard indisponibil pentru rolul ${session.role}.`);
}

// Transitional adapter retained for controlled fallback while Executive V2 is validated.
export { getCooDashboardData };
