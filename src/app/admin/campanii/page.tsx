import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CampaignsWorkspace } from "@/components/admin/client-campaigns/CampaignsWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getCampaignsPage } from "@/lib/client-campaign-workspaces";
import { validAccountOwners } from "@/lib/clients";
import { hasAnyPermission } from "@/lib/rbac";
import { CAMPAIGN_EFFECTIVE_STATUSES, type CampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";

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
  const handoffOpportunityId = first(params.crmOpportunityId);
  const openCreate = first(params.create) === "1";
  const requestedStatus = first(params.effectiveStatus);
  const effectiveStatus = CAMPAIGN_EFFECTIVE_STATUSES.includes(requestedStatus as CampaignEffectiveStatus)
    ? requestedStatus as CampaignEffectiveStatus
    : null;
  const [page, accountOwners] = await Promise.all([getCampaignsPage(session, { query, effectiveStatus }), validAccountOwners()]);
  return <>
    <AdminHeader session={session} />
    <CampaignsWorkspace initialPage={page} initialEffectiveStatus={effectiveStatus} initialCampaignId={campaignId} initialClientId={clientId} handoffOpportunityId={handoffOpportunityId} openCreate={openCreate} session={session} accountOwners={accountOwners} />
  </>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
