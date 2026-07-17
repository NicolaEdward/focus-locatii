import type { RoleDashboardData } from "@/lib/dashboard/role-dashboard";
import { CooCommandCenter } from "@/components/admin/CooCommandCenter";
import { SalesCommandCenter } from "@/components/admin/SalesCommandCenter";

export function RoleDashboard({ data }: { data: RoleDashboardData }) {
  if (data.kind === "coo") return <CooCommandCenter data={data} />;
  return <SalesCommandCenter data={data} />;
}
