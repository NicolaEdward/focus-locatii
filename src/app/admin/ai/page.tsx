import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CommercialWorkbench } from "@/components/admin/CommercialWorkbench";
import { getAuthSession } from "@/lib/auth";
import { commercialManagerRoles } from "@/lib/commercial-workbench-core";
export const dynamic = "force-dynamic";
export default async function AiPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!commercialManagerRoles.has(session.role)) redirect(session.role === "SALES_AGENT" ? "/admin/assistant-connections" : "/admin/dashboard");
  return (
    <>
      <AdminHeader session={session} />
      <CommercialWorkbench tab="ai" />
    </>
  );
}
