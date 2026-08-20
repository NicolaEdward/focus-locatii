import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { verifyBankImportToken } from "@/lib/bcr-george-import";
import { ensureFinancialLegalEntity } from "@/lib/financial-partners";
import { emitStructuredLog, observeRoute, setObservabilityRole } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const schema = z.object({ importToken: z.string().min(20) });
const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function POST(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/financial/bank-statements/confirm", operation: "bank_statement.confirm" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.confirm", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    try {
      const preview = verifyBankImportToken(schema.parse(await request.json()).importToken);
      const statementFingerprint = crypto.createHash("sha256").update([
        preview.companyCode,
        preview.accountIban,
        preview.periodStart.toISOString().slice(0, 10),
        preview.periodEnd.toISOString().slice(0, 10),
        preview.fileHash
      ].join("|")).digest("hex");
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.financialBankStatement.findUnique({ where: { statementFingerprint }, select: { id: true, uploadId: true } });
        if (existing) return { statementId: existing.id, uploadId: existing.uploadId, created: 0, duplicates: preview.rows.length, duplicateStatement: true };
        const entity = await ensureFinancialLegalEntity(tx, preview.companyCode);
        const account = await tx.financialBankAccount.upsert({
          where: { legalEntityId_ibanNormalized: { legalEntityId: entity.id, ibanNormalized: preview.accountIban } },
          create: { legalEntityId: entity.id, ibanOriginal: preview.accountIban, ibanNormalized: preview.accountIban, currency: preview.currency, bankName: "BCR / George" },
          update: { active: true, currency: preview.currency }
        });
        const duplicateFingerprints = new Set((await tx.financialBankTransaction.findMany({
          where: { fingerprint: { in: preview.rows.map((row) => row.fingerprint) } },
          select: { fingerprint: true }
        })).map((row) => row.fingerprint));
        const upload = await tx.financialReportUpload.create({
          data: {
            uploadedByUserId: session.id,
            reportDate: preview.periodEnd,
            originalFileName: preview.fileName,
            fileHash: preview.fileHash,
            fileSize: preview.fileSize,
            status: "completed",
            activeVersion: false,
            legalEntityId: entity.id,
            importType: "bank_statement_bcr_george",
            parserName: "BcrGeorgeStatementImporter",
            parserVersion: "1",
            rowsRead: preview.rows.length,
            rowsCreated: preview.rows.length - duplicateFingerprints.size,
            rowsDuplicate: duplicateFingerprints.size,
            warningCount: preview.warnings.length,
            summaryJson: { currency: preview.currency, periodStart: preview.periodStart.toISOString(), periodEnd: preview.periodEnd.toISOString() }
          }
        });
        const importIssues = preview.rows.flatMap((row) => row.warnings.map((warning) => ({
          uploadId: upload.id,
          companyName: preview.legalName,
          companyCode: preview.companyCode,
          sheetName: "CSV",
          rowNumber: row.rowNumber,
          issueType: warning,
          issueMessage: `Randul bancar necesita verificare: ${warning}.`,
          severity: "warning",
          rawRowJson: row.raw as Prisma.InputJsonObject
        })));
        if (importIssues.length) await tx.financialImportIssue.createMany({ data: importIssues });
        const statement = await tx.financialBankStatement.create({
          data: {
            uploadId: upload.id,
            legalEntityId: entity.id,
            bankAccountId: account.id,
            statementFingerprint,
            periodStart: preview.periodStart,
            periodEnd: preview.periodEnd,
            issuedAt: preview.issuedAt,
            currency: preview.currency,
            openingBalance: preview.openingBalance ? new Prisma.Decimal(preview.openingBalance) : null,
            closingBalance: preview.closingBalance ? new Prisma.Decimal(preview.closingBalance) : null
          }
        });
        const importable = preview.rows.filter((row) => !duplicateFingerprints.has(row.fingerprint));
        if (importable.length) {
          await tx.financialBankTransaction.createMany({
            data: importable.map((row) => ({
              statementId: statement.id,
              legalEntityId: entity.id,
              bankAccountId: account.id,
              fingerprint: row.fingerprint,
              bookedAt: row.bookedAt,
              valueDate: row.valueDate,
              currency: row.currency,
              debitAmount: new Prisma.Decimal(row.debitAmount),
              creditAmount: new Prisma.Decimal(row.creditAmount),
              description: row.description,
              documentReference: row.documentReference,
              bankReference: row.bankReference,
              payerName: row.payerName,
              payerIban: row.payerIban,
              payerTaxId: row.payerTaxId,
              beneficiaryName: row.beneficiaryName,
              beneficiaryIban: row.beneficiaryIban,
              beneficiaryTaxId: row.beneficiaryTaxId,
              paymentDetails: row.paymentDetails,
              merchantName: row.merchantName,
              maskedCard: row.maskedCard,
              transactionType: row.transactionType,
              classification: row.classification,
              reconciliationStatus: ["internal_transfer", "intercompany_transfer", "bank_fee", "tax_payment"].includes(row.classification) ? "ignored" : "unmatched",
              rawRowJson: row.raw as Prisma.InputJsonObject
            })),
            skipDuplicates: true
          });
        }
        return { statementId: statement.id, uploadId: upload.id, created: importable.length, duplicates: duplicateFingerprints.size, duplicateStatement: false };
      }, { maxWait: 10_000, timeout: 30_000 });
      await recordAudit({ actor: session, action: "financial.bank_statement_import_confirmed", entityType: "financial_bank_statement", entityId: result.statementId, metadata: result, request });
      emitStructuredLog("info", "bank_statement_confirm_completed", { operation: "bank_statement.confirm", role: session.role, entityType: "financial_bank_statement", entityId: result.statementId, status: "success", metrics: { rowCount: result.created, itemCount: result.duplicates } });
      return NextResponse.json({ ok: true, summary: result }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Extrasul bancar nu a putut fi importat." }, { status: 400, headers: noStoreHeaders });
    }
  });
}
