import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CampaignsWorkspace } from "@/components/admin/client-campaigns/CampaignsWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getCampaignsPage } from "@/lib/client-campaign-workspaces";
import { validAccountOwners } from "@/lib/clients";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function CampaniiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["campaigns.view", "campaigns.view.own", "clients.view", "clients.view.own", "finance.view"])) {
    redirect("/admin/dashboard");
  }
  const params = await searchParams;
  const query = first(params.q) || "";
  const campaignId = first(params.campaignId);
  const clientId = first(params.clientId);
  const openCreate = first(params.create) === "1";
  const [page, accountOwners] = await Promise.all([getCampaignsPage(session, { query }), validAccountOwners()]);
  return <>
    <AdminHeader session={session} />
    <CampaignsWorkspace initialPage={page} initialCampaignId={campaignId} initialClientId={clientId} openCreate={openCreate} session={session} accountOwners={accountOwners} />
  </>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
