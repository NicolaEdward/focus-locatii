import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { ContractControlWorkspace } from "@/components/admin/ContractControlWorkspace";
import { getAuthSession } from "@/lib/auth";
import { mayReadContractControl } from "@/lib/contract-control";

export const dynamic = "force-dynamic";

export default async function ContractControlPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!mayReadContractControl(session.role)) redirect("/admin/dashboard");
  return <><AdminHeader session={session} /><ContractControlWorkspace /></>;
}
