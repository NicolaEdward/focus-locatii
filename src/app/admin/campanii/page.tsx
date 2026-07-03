import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ClientCampaignsWorkspace } from "@/components/admin/ClientCampaignsWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getClientCampaignsData } from "@/lib/client-campaigns";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function CampaniiPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["campaigns.view", "campaigns.view.own", "clients.view", "clients.view.own", "finance.view"])) {
    redirect("/admin/dashboard");
  }
  const data = await getClientCampaignsData(session);
  return <>
    <AdminHeader session={session} />
    <ClientCampaignsWorkspace initialData={data} session={session} initialTab="campaigns" />
  </>;
}
