import { NextRequest, NextResponse } from "next/server";
import { secureEqual } from "@/lib/security-secrets";
import { runScheduledDocumentAudit } from "@/lib/document-reconciliation";
import { documentAuditHeaders } from "@/lib/document-source-service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secureEqual(request.headers.get("authorization") || "", `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: documentAuditHeaders });
  try { return NextResponse.json(await runScheduledDocumentAudit(), { headers: documentAuditHeaders }); }
  catch { return NextResponse.json({ error: "Raportul documentelor nu a putut fi actualizat; verifică delegația și starea ultimei rulări.", code: "DOCUMENT_AUDIT_JOB_FAILED" }, { status: 503, headers: documentAuditHeaders }); }
}
