import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { classifyBankTransaction } from "../src/lib/bcr-george-import";
import { excludedBankClassification } from "../src/lib/financial-reconciliation";

const ACTIVE = "active";
const RECONCILIATION_PENDING = ["unmatched", "partial", "conflict"];

async function main() {
  loadEnv(process.env.ENV_FILE || ".env.local");
  const { prisma } = await import("../src/lib/prisma");
  const apply = process.argv.includes("--apply");
  try {
    const rows = await prisma.financialBankTransaction.findMany({
      where: { reconciliationStatus: { in: RECONCILIATION_PENDING } },
      select: {
        id: true,
        classification: true,
        reconciliationStatus: true,
        debitAmount: true,
        creditAmount: true,
        description: true,
        paymentDetails: true,
        transactionType: true,
        payerName: true,
        payerIban: true,
        payerTaxId: true,
        beneficiaryName: true,
        beneficiaryIban: true,
        beneficiaryTaxId: true,
        legalEntity: { select: { code: true, taxIdNormalized: true } },
        receivablePayments: { where: { status: ACTIVE }, select: { id: true }, take: 1 },
        payablePayments: { where: { status: ACTIVE }, select: { id: true }, take: 1 }
      }
    });
    const blocked: string[] = [];
    const plan = rows.flatMap((row) => {
      const classification = classifyBankTransaction({
        debitAmount: row.debitAmount.toFixed(2),
        creditAmount: row.creditAmount.toFixed(2),
        description: row.description,
        paymentDetails: row.paymentDetails,
        transactionType: row.transactionType,
        payerName: row.payerName,
        payerIban: row.payerIban,
        payerTaxId: row.payerTaxId,
        beneficiaryName: row.beneficiaryName,
        beneficiaryIban: row.beneficiaryIban,
        beneficiaryTaxId: row.beneficiaryTaxId,
        currentTaxId: row.legalEntity.taxIdNormalized,
        currentCompanyCode: row.legalEntity.code
      });
      if (!excludedBankClassification(classification)) return [];
      if (row.classification === classification && row.reconciliationStatus === "ignored") return [];
      if (row.receivablePayments.length || row.payablePayments.length) {
        blocked.push(row.id);
        return [];
      }
      return [{
        id: row.id,
        beforeClassification: row.classification,
        beforeStatus: row.reconciliationStatus,
        classification
      }];
    });
    const byClassification = plan.reduce<Record<string, number>>((counts, item) => {
      counts[item.classification] = (counts[item.classification] || 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      pendingBefore: rows.length,
      eligible: plan.length,
      blockedWithActiveAllocations: blocked.length,
      byClassification
    }, null, 2));
    if (!apply || !plan.length) return;

    const batchId = `bank-auto-classification:${new Date().toISOString()}`;
    await prisma.$transaction(async (tx) => {
      for (const item of plan) {
        const updated = await tx.financialBankTransaction.updateMany({
          where: {
            id: item.id,
            reconciliationStatus: { in: RECONCILIATION_PENDING },
            receivablePayments: { none: { status: ACTIVE } },
            payablePayments: { none: { status: ACTIVE } }
          },
          data: { classification: item.classification, reconciliationStatus: "ignored" }
        });
        if (updated.count !== 1) throw new Error(`Tranzactia ${item.id} s-a modificat in timpul clasificarii.`);
        await tx.auditLog.create({
          data: {
            action: "financial.bank_transaction_auto_classified",
            entityType: "financial_bank_transaction",
            entityId: item.id,
            metadata: {
              batchId,
              before: { classification: item.beforeClassification, reconciliationStatus: item.beforeStatus },
              after: { classification: item.classification, reconciliationStatus: "ignored" },
              reason: "deterministic_informational_bank_movement"
            }
          }
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
    const pendingAfter = await prisma.financialBankTransaction.count({
      where: {
        reconciliationStatus: { in: RECONCILIATION_PENDING },
        classification: { notIn: [
          "internal_transfer", "intercompany_transfer", "bank_fee", "tax_payment", "payroll_payment",
          "employee_payment", "associate_payment", "dividend_payment", "copyright_payment"
        ] }
      }
    });
    console.log(JSON.stringify({ applied: plan.length, pendingAfter, batchId }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function loadEnv(fileName: string) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
