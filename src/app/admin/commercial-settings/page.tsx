import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { CommercialWorkbench } from "@/components/admin/CommercialWorkbench";
import { getAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function CommercialSettingsPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) redirect("/admin/dashboard");
  return <><AdminHeader session={session} /><CommercialWorkbench tab="settings" /></>;
}
