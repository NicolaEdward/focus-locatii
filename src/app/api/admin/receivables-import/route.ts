import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { stageReceivablesImport } from "@/lib/receivables-import-service";
import type { ReceivablesCompanyCode } from "@/lib/receivables-import-parser";
import { SpreadsheetSecurityError } from "@/lib/secure-spreadsheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const companies = new Set<ReceivablesCompanyCode>(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]);

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.manage"]);
  if (response || !session) return response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Încarcă un fișier Excel." }, { status: 400 });
    if (!/\.(xlsx|xls)$/i.test(file.name)) return NextResponse.json({ error: "Sunt acceptate doar fișiere .xlsx și .xls." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Fișierul depășește limita de 20 MB." }, { status: 413 });
    const rawCompany = String(form.get("companyCode") || "").trim() as ReceivablesCompanyCode;
    const selectedCompanyCode = companies.has(rawCompany) ? rawCompany : null;
    const rawReportDate = String(form.get("reportDate") || "").trim();
    const reportDate = rawReportDate ? new Date(`${rawReportDate}T00:00:00.000Z`) : null;
    if (reportDate && Number.isNaN(reportDate.getTime())) return NextResponse.json({ error: "Data raportului nu este validă." }, { status: 400 });
    const result = await stageReceivablesImport({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      signal: request.signal,
      selectedCompanyCode,
      reportDate,
      actor: session
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Raportul nu a putut fi analizat." },
      { status: error instanceof SpreadsheetSecurityError ? error.status : 400 }
    );
  }
}
