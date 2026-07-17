import type { AuthSession } from "@/lib/auth";
import { getCooDashboardData } from "@/lib/dashboard/coo-dashboard";
import { getSalesDashboardData } from "@/lib/dashboard/sales-dashboard";

export type RoleDashboardData = Awaited<ReturnType<typeof getRoleDashboardData>>;

export async function getRoleDashboardData(session: AuthSession) {
  if (["COO", "SUPER_ADMIN"].includes(session.role)) return getCooDashboardData(session);
  if (["SALES_AGENT", "SALES_DIRECTOR"].includes(session.role)) return getSalesDashboardData(session);
  throw new Error(`Dashboard indisponibil pentru rolul ${session.role}.`);
}
