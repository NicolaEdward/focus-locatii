import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CommercialWorkbench } from "@/components/admin/CommercialWorkbench";
import { getAuthSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/rbac";
export const dynamic = "force-dynamic";
export default async function DoohPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (
    !hasAnyPermission(session.role, [
      "reservations.view",
      "reservations.view.own",
    ])
  )
    redirect("/admin/dashboard");
  if (process.env.NEXT_PUBLIC_DOOH_ENABLED !== "true") redirect("/admin/selectie-locatii");
  return (
    <>
      <AdminHeader session={session} />
      <CommercialWorkbench tab="dooh" />
    </>
  );
}
