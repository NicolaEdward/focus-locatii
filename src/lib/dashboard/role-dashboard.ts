import type { AuthSession } from "@/lib/auth";
import { getCooDashboardData } from "@/lib/dashboard/coo-dashboard";
import { getSalesDashboardData } from "@/lib/dashboard/sales-dashboard";
import { getExecutiveOverview } from "@/lib/dashboard/executive/overview";

export type RoleDashboardData =
  | Awaited<ReturnType<typeof getExecutiveOverview>>
  | Awaited<ReturnType<typeof getCooDashboardData>>
  | Awaited<ReturnType<typeof getSalesDashboardData>>;

export async function getRoleDashboardData(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  if (["COO", "D_CEO", "SUPER_ADMIN"].includes(session.role)) return getExecutiveOverview(session, input);
  if (["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role)) return getSalesDashboardData(session);
  throw new Error(`Dashboard indisponibil pentru rolul ${session.role}.`);
}

// Transitional adapter retained for controlled fallback while Executive V2 is validated.
export { getCooDashboardData };
