import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { SupplierWorkspace } from "@/components/admin/SupplierWorkspace";
import { getAdminSession } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SuppliersPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session.role, "finance.view")) redirect("/admin/dashboard");
  const suppliers = await prisma.supplier.findMany({
    where: { status: { not: "archived" } },
    orderBy: { supplierName: "asc" },
    take: 5000
  });
  return (
    <>
      <AdminHeader session={session} />
      <SupplierWorkspace initialSuppliers={suppliers.map((supplier) => ({
        id: supplier.id,
        supplierName: supplier.supplierName,
        taxId: supplier.taxId,
        generalEmail: supplier.generalEmail,
        generalPhone: supplier.generalPhone,
        status: supplier.status,
        notes: supplier.notes
      }))} />
    </>
  );
}
