import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ImportExcelPanel } from "@/components/admin/ImportExcelPanel";
import { getAdminSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

export default async function ImportPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "inventory.manage")) redirect("/admin/dashboard");

  return (
    <>
      <AdminHeader session={session} />
      <main className="focus-shell py-8">
        <div className="focus-container">
          <ImportExcelPanel />
        </div>
      </main>
    </>
  );
}
