import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ClientCampaignsWorkspace, type ClientCampaignsWorkspaceTab } from "@/components/admin/ClientCampaignsWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getClientCampaignsData } from "@/lib/client-campaigns";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ClientiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["clients.view", "clients.view.own", "campaigns.view", "campaigns.view.own", "finance.view"])) {
    redirect("/admin/dashboard");
  }
  const params = await searchParams;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const allowedTabs: ClientCampaignsWorkspaceTab[] = ["clients", "campaigns", "invoices", "cleanup", "documents"];
  const initialTab: ClientCampaignsWorkspaceTab = allowedTabs.includes(requestedTab as ClientCampaignsWorkspaceTab)
    ? requestedTab as ClientCampaignsWorkspaceTab
    : "clients";
  const data = await getClientCampaignsData(session);
  return <>
    <AdminHeader session={session} />
    <ClientCampaignsWorkspace initialData={data} session={session} initialTab={initialTab} />
  </>;
}
