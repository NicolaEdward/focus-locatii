import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { normalizeInvoiceNumber } from "@/lib/clients";
import { parseFinancialWorkbook } from "@/lib/financial-import";
import { prisma } from "@/lib/prisma";
import { SpreadsheetSecurityError } from "@/lib/secure-spreadsheet";
import { emitStructuredLog, requestCorrelationId, safeErrorCode } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function POST(request: NextRequest) {
  const correlationId = requestCorrelationId(request);
  const startedAt = performance.now();
  const { session, response } = await requireAnyPermission(request, ["finance.upload", "finance.manage"]);
  if (response || !session) return response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Incarca un fisier Excel." }, { status: 400, headers: noStoreHeaders });
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: "Fisierul trebuie sa fie Excel." }, { status: 400, headers: noStoreHeaders });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Fisierul este prea mare pentru import." }, { status: 413, headers: noStoreHeaders });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseFinancialWorkbook({ buffer, fileName: file.name, mimeType: file.type, signal: request.signal });
    const duplicate = await prisma.financialReportUpload.findFirst({
      where: {
        fileHash: parsed.fileHash,
        status: { notIn: ["rejected", "archived", "failed"] }
      },
      orderBy: { uploadedAt: "desc" }
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: "Acest fisier a fost deja incarcat. Anuleaza importul existent sau incarca o versiune diferita.",
          upload: {
            id: duplicate.id,
            status: duplicate.status,
            reportDate: duplicate.reportDate?.toISOString() || null,
            uploadedAt: duplicate.uploadedAt.toISOString(),
            originalFileName: duplicate.originalFileName
          }
        },
        { status: 409, headers: noStoreHeaders }
      );
    }
    const uploadStatus =
      parsed.summary.criticalIssueCount || parsed.summary.needsReviewCount ? "needs_review" : "parsed";

    const upload = await prisma.$transaction(async (tx) => {
      const createdUpload = await tx.financialReportUpload.create({
        data: {
          uploadedByUserId: session.id,
          reportDate: parsed.reportDate,
          originalFileName: file.name,
          fileHash: parsed.fileHash,
          status: uploadStatus,
          errorSummary: parsed.summary.criticalIssueCount
            ? `${parsed.summary.criticalIssueCount} probleme critice necesita verificare.`
            : parsed.summary.needsReviewCount
              ? `${parsed.summary.needsReviewCount} randuri necesita verificare.`
              : null
        }
      });

      if (parsed.companies.length) {
        await tx.financialReportCompanySnapshot.createMany({
          data: parsed.companies.map((company) => ({ ...company, uploadId: createdUpload.id }))
        });
      }
      if (parsed.payables.length) {
        await tx.financialPayable.createMany({
          data: parsed.payables.map((row) => ({
            ...row,
            uploadId: createdUpload.id,
            rawRowJson: row.rawRowJson as Prisma.InputJsonValue
          }))
        });
      }
      if (parsed.receivables.length) {
        await tx.financialReceivable.createMany({
          data: parsed.receivables.map((row) => ({
            ...row,
            normalizedInvoiceNumber: normalizeInvoiceNumber(row.invoiceNumber),
            uploadId: createdUpload.id,
            rawRowJson: row.rawRowJson as Prisma.InputJsonValue
          }))
        });
      }
      if (parsed.issues.length) {
        await tx.financialImportIssue.createMany({
          data: parsed.issues.map((row) => ({
            ...row,
            uploadId: createdUpload.id,
            rawRowJson: row.rawRowJson ? row.rawRowJson as Prisma.InputJsonValue : undefined
          }))
        });
      }

      return createdUpload;
    });

    await recordAudit({
      actor: session,
      action: "financial.upload",
      entityType: "financial_report_upload",
      entityId: upload.id,
      metadata: {
        fileName: file.name,
        status: uploadStatus,
        fileHash: parsed.fileHash,
        summary: parsed.summary
      },
      request
    });

    emitStructuredLog("info", "spreadsheet_import_staged", {
      correlationId,
      operation: "financial_legacy.stage",
      entityType: "financial_report_upload",
      entityId: upload.id,
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: uploadStatus,
      metrics: {
        fileBytes: file.size,
        rowCount: parsed.summary.receivableRows + parsed.summary.payableRows,
        conflictCount: parsed.summary.criticalIssueCount + parsed.summary.needsReviewCount
      }
    });

    return NextResponse.json({
      upload: {
        id: upload.id,
        status: upload.status,
        reportDate: upload.reportDate?.toISOString() || null,
        uploadedAt: upload.uploadedAt.toISOString(),
        originalFileName: upload.originalFileName
      },
      preview: {
        summary: parsed.summary,
        companies: parsed.companies,
        issues: parsed.issues.slice(0, 80),
        payablesNeedsReview: parsed.payables.filter((row) => row.needsReview).slice(0, 30),
        receivablesNeedsReview: parsed.receivables.filter((row) => row.needsReview).slice(0, 30)
      }
    }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    await recordAudit({
      actor: session,
      action: "financial.upload_failed",
      entityType: "financial_report_upload",
      metadata: { error: error instanceof Error ? error.message : String(error) },
      request
    });
    emitStructuredLog("warn", "spreadsheet_import_failed", {
      correlationId,
      operation: "financial_legacy.stage",
      role: session.role,
      durationMs: Math.round(performance.now() - startedAt),
      status: error instanceof SpreadsheetSecurityError ? error.status : 400,
      errorCode: safeErrorCode(error, "FINANCIAL_IMPORT_FAILED")
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Raportul financiar nu a putut fi procesat." },
      { status: error instanceof SpreadsheetSecurityError ? error.status : 400, headers: noStoreHeaders }
    );
  }
}
