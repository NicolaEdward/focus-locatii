import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { OwnershipIntegrityWorkspace } from "@/components/admin/OwnershipIntegrityWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getOwnershipIntegrityReport } from "@/lib/ownership-integrity";
import { listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function DataIntegrityPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!["COO", "SUPER_ADMIN"].includes(session.role)) redirect("/admin/dashboard");
  const [report, users] = await Promise.all([getOwnershipIntegrityReport(), listUsers()]);
  return (
    <>
      <AdminHeader session={session} />
      <OwnershipIntegrityWorkspace
        initialReport={report}
        users={users.map(({ id, name, role, active }) => ({ id, name, role, active }))}
      />
    </>
  );
}
