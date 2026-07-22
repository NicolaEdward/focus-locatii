import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertFinancialUploadTransition } from "@/lib/financial-state-machine";
import { getReceivablesImportPreview } from "@/lib/receivables-import-service";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  const preview = await getReceivablesImportPreview(id);
  return preview ? NextResponse.json({ preview }) : NextResponse.json({ error: "Importul nu există." }, { status: 404 });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;
  const { id } = await context.params;
  try {
    const upload = await prisma.financialReportUpload.findUnique({ where: { id }, select: { status: true } });
    if (!upload) return NextResponse.json({ error: "Importul nu există." }, { status: 404 });
    if (upload.status === "confirmed") return NextResponse.json({ error: "Un import confirmat nu poate fi anulat." }, { status: 409 });
    assertFinancialUploadTransition(upload.status, "rejected");
    await prisma.$transaction([
      prisma.financialReportUpload.update({ where: { id }, data: { status: "rejected", errorSummary: "Import anulat înainte de confirmare." } }),
      prisma.auditLog.create({ data: { userId: session.id, action: "receivables.import_cancelled", entityType: "financial_report_upload", entityId: id } })
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Importul nu a putut fi anulat." }, { status: 400 });
  }
}
