import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { DocumentAuditWorkspace } from "@/components/admin/DocumentAuditWorkspace";
import { getDocumentAuditWorkspace } from "@/lib/document-source-service";
import { mayReadDocumentAudit } from "@/lib/document-source-domain";
export const dynamic = "force-dynamic";
export default async function DocumentAuditPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!mayReadDocumentAudit(session.role)) redirect("/admin/dashboard");
  return <><AdminHeader session={session} /><DocumentAuditWorkspace initialState={await getDocumentAuditWorkspace(session)} role={session.role} /></>;
}
