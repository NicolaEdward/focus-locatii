import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { assertFinancialUploadTransition } from "@/lib/financial-state-machine";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

const confirmSchema = z.object({});

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
  if (response || !session) return response;

  const { id } = await context.params;

  try {
    const body = request.headers.get("content-type")?.includes("application/json")
      ? confirmSchema.parse(await request.json().catch(() => ({})))
      : { allowPartial: false };
    const upload = await prisma.financialReportUpload.findUnique({ where: { id } });
    if (!upload) {
      return NextResponse.json({ error: "Raportul nu exista." }, { status: 404, headers: noStoreHeaders });
    }

    const [criticalIssues, payableNeedsReview, receivableNeedsReview] = await Promise.all([
      prisma.financialImportIssue.count({ where: { uploadId: id, severity: "critical", resolvedAt: null } }),
      prisma.financialPayable.count({ where: { uploadId: id, needsReview: true, includedInReport: true } }),
      prisma.financialReceivable.count({ where: { uploadId: id, needsReview: true, includedInReport: true } })
    ]);
    const blockingRows = criticalIssues + payableNeedsReview + receivableNeedsReview;
    if (blockingRows > 0) {
      return NextResponse.json({
        error: "Raportul are randuri neclare. Verifica si corecteaza problemele inainte de confirmare.",
        blockingRows,
        criticalIssues,
        payableNeedsReview,
        receivableNeedsReview
      }, { status: 409, headers: noStoreHeaders });
    }
    assertFinancialUploadTransition(upload.status, "confirmed");

    await prisma.$transaction([
      prisma.financialReportUpload.updateMany({ where: { activeVersion: true }, data: { activeVersion: false } }),
      prisma.financialReportUpload.update({
        where: { id },
        data: {
          status: "confirmed",
          activeVersion: true,
          errorSummary: null
        }
      })
    ]);

    await recordAudit({
      actor: session,
      action: "financial.confirm",
      entityType: "financial_report_upload",
      entityId: id,
      metadata: { previousStatus: upload.status, blockingRows },
      request
    });

    return NextResponse.json({ ok: true, id, status: "confirmed", blockingRows }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Raportul nu a putut fi confirmat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { session, response } = await requireAnyPermission(request, ["finance.validate", "finance.manage"]);
  if (response || !session) return response;

  const { id } = await context.params;
  try {
    const upload = await prisma.financialReportUpload.findUnique({ where: { id } });
    if (!upload) {
      return NextResponse.json({ error: "Raportul nu exista." }, { status: 404, headers: noStoreHeaders });
    }
    if (upload.activeVersion || upload.status === "confirmed") {
      return NextResponse.json({ error: "Nu poti anula raportul activ confirmat. Arhiveaza-l doar dupa incarcarea unui raport nou valid." }, { status: 409, headers: noStoreHeaders });
    }
    assertFinancialUploadTransition(upload.status, "rejected");
    await prisma.financialReportUpload.update({
      where: { id },
      data: {
        status: "rejected",
        activeVersion: false,
        errorSummary: "Import anulat manual inainte de confirmare."
      }
    });
    await recordAudit({
      actor: session,
      action: "financial.import_cancelled",
      entityType: "financial_report_upload",
      entityId: id,
      metadata: { previousStatus: upload.status, fileName: upload.originalFileName },
      request
    });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Importul nu a putut fi anulat." },
      { status: 400, headers: noStoreHeaders }
    );
  }
}
