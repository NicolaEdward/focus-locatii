import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { DocumentAuditWorkspace } from "@/components/admin/DocumentAuditWorkspace";
import { getDocumentAuditWorkspace } from "@/lib/document-source-service";
import { mayReadDocumentAudit } from "@/lib/document-source-domain";
export const dynamic = "force-dynamic";
export default async function DocumentAuditPage({ searchParams }: { searchParams?: Promise<{ documentId?: string }> }) {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  if (!mayReadDocumentAudit(session.role)) redirect("/admin/dashboard");
  const requestedId = (await searchParams)?.documentId;
  const documentId = typeof requestedId === "string" && requestedId.length <= 191 ? requestedId : null;
  return <><AdminHeader session={session} /><DocumentAuditWorkspace initialState={await getDocumentAuditWorkspace(session, null, documentId)} initialDocumentId={documentId} role={session.role} /></>;
}
