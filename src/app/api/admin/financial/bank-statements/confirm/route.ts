import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { verifyBankImportToken } from "@/lib/bcr-george-import";
import { ensureFinancialLegalEntity } from "@/lib/financial-partners";
import { excludedBankClassification } from "@/lib/financial-reconciliation";
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
      const accountPlans = preview.accounts.map((account) => ({
        account,
        statementFingerprint: crypto.createHash("sha256").update([
          preview.companyCode,
          preview.bankProvider,
          account.accountKey,
          account.periodStart.toISOString().slice(0, 10),
          account.periodEnd.toISOString().slice(0, 10),
          preview.fileHash
        ].join("|")).digest("hex")
      }));
      const result = await prisma.$transaction(async (tx) => {
        const existingStatements = await tx.financialBankStatement.findMany({
          where: { statementFingerprint: { in: accountPlans.map((plan) => plan.statementFingerprint) } },
          select: { id: true, uploadId: true, statementFingerprint: true }
        });
        const existingStatementFingerprints = new Set(existingStatements.map((statement) => statement.statementFingerprint));
        if (existingStatements.length === accountPlans.length) {
          return {
            statementId: existingStatements[0].id,
            statementIds: existingStatements.map((statement) => statement.id),
            uploadId: existingStatements[0].uploadId,
            created: 0,
            duplicates: preview.rows.length,
            duplicateStatement: true
          };
        }

        const entity = await ensureFinancialLegalEntity(tx, preview.companyCode);
        const duplicateFingerprints = new Set((await tx.financialBankTransaction.findMany({
          where: { fingerprint: { in: preview.rows.map((row) => row.fingerprint) } },
          select: { fingerprint: true }
        })).map((row) => row.fingerprint));
        const newPlans = accountPlans.filter((plan) => !existingStatementFingerprints.has(plan.statementFingerprint));
        const newAccountKeys = new Set(newPlans.map((plan) => plan.account.accountKey));
        const importable = preview.rows.filter((row) => newAccountKeys.has(row.accountKey) && !duplicateFingerprints.has(row.fingerprint));
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
            importType: `bank_statement_${preview.bankProvider}`,
            parserName: preview.bankProvider === "revolut" ? "RevolutBusinessStatementImporter" : "BcrGeorgeStatementImporter",
            parserVersion: "2",
            rowsRead: preview.rows.length,
            rowsCreated: importable.length,
            rowsDuplicate: preview.rows.length - importable.length,
            warningCount: preview.warnings.length,
            summaryJson: {
              provider: preview.bankProvider,
              currencies: preview.accounts.map((account) => account.currency),
              accounts: preview.accounts.length,
              sourceRows: preview.sourceRowCount,
              periodStart: preview.periodStart.toISOString(),
              periodEnd: preview.periodEnd.toISOString()
            }
          }
        });
        const importIssues = preview.rows.flatMap((row) => row.warnings.map((warning) => ({
          uploadId: upload.id,
          companyName: preview.legalName,
          companyCode: preview.companyCode,
          sheetName: `${preview.bankName} CSV`,
          rowNumber: row.rowNumber,
          issueType: warning,
          issueMessage: `Randul bancar necesita verificare: ${warning}.`,
          severity: "warning",
          rawRowJson: row.raw as Prisma.InputJsonObject
        })));
        if (importIssues.length) await tx.financialImportIssue.createMany({ data: importIssues });

        const statementIds = existingStatements.map((statement) => statement.id);
        for (const plan of newPlans) {
          const account = await tx.financialBankAccount.upsert({
            where: { legalEntityId_ibanNormalized: { legalEntityId: entity.id, ibanNormalized: plan.account.storageIdentifier } },
            create: {
              legalEntityId: entity.id,
              ibanOriginal: plan.account.iban || plan.account.label,
              ibanNormalized: plan.account.storageIdentifier,
              currency: plan.account.currency,
              bankName: preview.bankName,
              accountLabel: plan.account.label
            },
            update: {
              active: true,
              currency: plan.account.currency,
              bankName: preview.bankName,
              accountLabel: plan.account.label,
              ...(plan.account.iban ? { ibanOriginal: plan.account.iban } : {})
            }
          });
          const statement = await tx.financialBankStatement.create({
            data: {
              uploadId: upload.id,
              legalEntityId: entity.id,
              bankAccountId: account.id,
              statementFingerprint: plan.statementFingerprint,
              periodStart: plan.account.periodStart,
              periodEnd: plan.account.periodEnd,
              issuedAt: preview.issuedAt,
              currency: plan.account.currency,
              openingBalance: plan.account.openingBalance ? new Prisma.Decimal(plan.account.openingBalance) : null,
              closingBalance: plan.account.closingBalance ? new Prisma.Decimal(plan.account.closingBalance) : null
            }
          });
          statementIds.push(statement.id);
          const accountRows = importable.filter((row) => row.accountKey === plan.account.accountKey);
          if (accountRows.length) {
            await tx.financialBankTransaction.createMany({
              data: accountRows.map((row) => ({
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
                reconciliationStatus: excludedBankClassification(row.classification) ? "ignored" : "unmatched",
                rawRowJson: row.raw as Prisma.InputJsonObject
              })),
              skipDuplicates: true
            });
          }
        }
        return {
          statementId: statementIds[0],
          statementIds,
          uploadId: upload.id,
          created: importable.length,
          duplicates: preview.rows.length - importable.length,
          duplicateStatement: false
        };
      }, { maxWait: 10_000, timeout: 60_000 });
      await recordAudit({ actor: session, action: "financial.bank_statement_import_confirmed", entityType: "financial_bank_statement", entityId: result.statementId, metadata: result, request });
      emitStructuredLog("info", "bank_statement_confirm_completed", { operation: "bank_statement.confirm", role: session.role, entityType: "financial_bank_statement", entityId: result.statementId, status: "success", metrics: { rowCount: result.created, itemCount: result.duplicates } });
      return NextResponse.json({ ok: true, summary: result }, { headers: noStoreHeaders });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Extrasul bancar nu a putut fi importat." }, { status: 400, headers: noStoreHeaders });
    }
  });
}
