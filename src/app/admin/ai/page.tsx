import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CommercialWorkbench } from "@/components/admin/CommercialWorkbench";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
export const dynamic = "force-dynamic";
export default async function AiPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (
    !hasAnyPermission(session.role, [
      "reservations.view",
      "reservations.view.own",
    ])
  )
    redirect("/admin/dashboard");
  return (
    <>
      <AdminHeader session={session} />
      <CommercialWorkbench tab="ai" />
    </>
  );
}
