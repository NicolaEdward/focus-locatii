import type { RoleDashboardData } from "@/lib/dashboard/role-dashboard";
import { CooCommandCenter } from "@/components/admin/CooCommandCenter";
import { SalesCommandCenter } from "@/components/admin/SalesCommandCenter";
import { ExecutiveCommandCenter } from "@/components/admin/ExecutiveCommandCenter";

export function RoleDashboard({ data }: { data: RoleDashboardData }) {
  if (data.kind === "executive") return <ExecutiveCommandCenter data={data} />;
  if (data.kind === "coo") return <CooCommandCenter data={data} />;
  return <SalesCommandCenter data={data} />;
}
