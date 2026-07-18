import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { importExcel } from "@/lib/import-excel";
import { recordAudit } from "@/lib/audit";
import { SpreadsheetSecurityError } from "@/lib/secure-spreadsheet";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Lipseste fisierul Excel." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Fisierul depaseste limita de 20 MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const summary = await importExcel(buffer, file.name, session?.email, file.type, request.signal);
    if (session) await recordAudit({ actor: session, action: "locations.import_excel", entityType: "import", entityId: summary.batchId, metadata: { fileName: file.name, totalRows: summary.totalRows }, request });
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fișierul nu a putut fi importat." },
      { status: error instanceof SpreadsheetSecurityError ? error.status : 400 }
    );
  }
}
