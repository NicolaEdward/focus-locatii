import { NextRequest, NextResponse } from "next/server";
import { ingestDocumentSource, documentAuditHeaders } from "@/lib/document-source-service";
import { documentAuditFailure, readDocumentAuditJson } from "@/lib/document-source-request";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { rateLimitIdentity } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = request.headers.get("authorization");
    if (!/^Bearer fm_nas_[A-Za-z0-9_-]{43}$/.test(authorization || "")) return NextResponse.json({ error: "Autentificare bridge necesară." }, { status: 401, headers: documentAuditHeaders });
    const limit = await consumeRateLimit({ scope: "document-source.ingest", identifier: rateLimitIdentity(request), limit: 120, windowSeconds: 60 });
    if (!limit.allowed) return NextResponse.json({ error: "Prea multe cereri." }, { status: 429, headers: { ...documentAuditHeaders, "Retry-After": String(limit.retryAfter) } });
    const { id } = await context.params;
    if (!id || id.length > 191) return NextResponse.json({ error: "Sursă invalidă." }, { status: 400, headers: documentAuditHeaders });
    const result = await ingestDocumentSource(id, authorization, await readDocumentAuditJson(request, 2 * 1024 * 1024));
    return NextResponse.json(result, { headers: documentAuditHeaders });
  } catch (error) { return documentAuditFailure(error); }
}
