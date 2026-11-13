import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createDocumentSource, documentAuditHeaders, getDocumentAuditWorkspace, issueDocumentIngestKey, reviewDocumentFacts, revokeDocumentIngestKey, updateDocumentSource } from "@/lib/document-source-service";
import { documentAuditFailure, readDocumentAuditJson } from "@/lib/document-source-request";
import { runDocumentReconciliation } from "@/lib/document-reconciliation";
import { z } from "zod";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: NextRequest) {
  const { session, response } = await requirePermission(request, "audit.view");
  if (response || !session) return response;
  try {
    const cursor = request.nextUrl.searchParams.get("cursor");
    if (cursor && cursor.length > 191) return NextResponse.json({ error: "Cursor invalid." }, { status: 400, headers: documentAuditHeaders });
    return NextResponse.json(await getDocumentAuditWorkspace(session, cursor), { headers: documentAuditHeaders });
  } catch (error) { return documentAuditFailure(error); }
}
export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "audit.view");
  if (response || !session) return response;
  try {
    const body = z.object({ action: z.enum(["create_source", "update_source", "issue_key", "revoke_key", "review_facts", "run_audit"]), input: z.unknown().optional() }).strict().parse(await readDocumentAuditJson(request));
    let result: unknown;
    switch (body.action) {
      case "create_source": result = await createDocumentSource(body.input, session); break;
      case "update_source": result = await updateDocumentSource(body.input, session); break;
      case "issue_key": result = await issueDocumentIngestKey(body.input, session); break;
      case "revoke_key": result = await revokeDocumentIngestKey(z.object({ sourceId: z.string().min(1).max(191) }).strict().parse(body.input).sourceId, session); break;
      case "review_facts": result = await reviewDocumentFacts(body.input, session); break;
      case "run_audit": result = await runDocumentReconciliation(session); break;
    }
    // The command is committed even if this supplementary read fails.
    try { return NextResponse.json({ result, state: await getDocumentAuditWorkspace(session), outcome: "committed" }, { headers: documentAuditHeaders }); }
    catch { return NextResponse.json({ result, state: null, outcome: "committed", warning: "Acțiunea este salvată; starea trebuie reîncărcată." }, { headers: documentAuditHeaders }); }
  } catch (error) { return documentAuditFailure(error); }
}
