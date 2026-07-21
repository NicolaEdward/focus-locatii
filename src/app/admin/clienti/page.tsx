import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ClientsWorkspace } from "@/components/admin/client-campaigns/ClientsWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getClientsPage } from "@/lib/client-campaign-workspaces";
import { validAccountOwners } from "@/lib/clients";
import { hasAnyPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ClientiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!hasAnyPermission(session.role, ["clients.view", "clients.view.own", "campaigns.view", "campaigns.view.own", "finance.view"])) {
    redirect("/admin/dashboard");
  }
  const params = await searchParams;
  const query = first(params.q) || "";
  const clientId = first(params.clientId);
  const initialPortfolioFinance = first(params.tab) === "invoices" || first(params.view) === "finance";
  const [page, accountOwners] = await Promise.all([getClientsPage(session, { query }), validAccountOwners()]);
  return <>
    <AdminHeader session={session} />
    <ClientsWorkspace initialPage={page} initialClientId={clientId} initialPortfolioFinance={initialPortfolioFinance} session={session} accountOwners={accountOwners} />
  </>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
