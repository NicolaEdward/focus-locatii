import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AssistantConnections } from "@/components/admin/AssistantConnections";
import { getAuthSession } from "@/lib/auth";
import { assistantConnectionsState } from "@/lib/assistant-oauth";
export const dynamic = "force-dynamic";
export default async function AssistantConnectionsPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  const state = JSON.parse(
    JSON.stringify(await assistantConnectionsState(session)),
  );
  return (
    <>
      <AdminHeader session={session} />
      <AssistantConnections initialState={state} />
    </>
  );
}
