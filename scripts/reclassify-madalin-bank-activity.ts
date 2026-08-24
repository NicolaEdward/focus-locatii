import { Prisma } from "@prisma/client";
import { isMadalinStanBankActivity } from "../src/lib/bcr-george-import";
import { loadEnvFile } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env.local");

const TARGET_CLASSIFICATION = "owner_madalin_payment";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const apply = process.argv.includes("--apply");
  try {
    const rows = await prisma.financialBankTransaction.findMany({
      where: {
        OR: [
          { payerName: { contains: "Madalin" } },
          { beneficiaryName: { contains: "Madalin" } },
          { description: { contains: "Madalin" } }
        ]
      },
      select: {
        id: true,
        classification: true,
        reconciliationStatus: true,
        description: true,
        payerName: true,
        beneficiaryName: true,
        debitAmount: true,
        creditAmount: true,
        currency: true,
        legalEntity: { select: { code: true } },
        receivablePayments: { where: { status: "active" }, select: { id: true }, take: 1 },
        payablePayments: { where: { status: "active" }, select: { id: true }, take: 1 }
      }
    });
    const matching = rows.filter((row) => isMadalinStanBankActivity(row.payerName, row.beneficiaryName, row.description));
    const blocked = matching.filter((row) => row.receivablePayments.length || row.payablePayments.length);
    const plan = matching.filter((row) =>
      !row.receivablePayments.length &&
      !row.payablePayments.length &&
      (row.classification !== TARGET_CLASSIFICATION || row.reconciliationStatus !== "ignored")
    );
    const totals = plan.reduce<Record<string, { count: number; debit: number; credit: number }>>((result, row) => {
      const key = `${row.legalEntity.code}|${row.currency}`;
      const bucket = result[key] || { count: 0, debit: 0, credit: 0 };
      bucket.count += 1;
      bucket.debit = round(bucket.debit + Number(row.debitAmount));
      bucket.credit = round(bucket.credit + Number(row.creditAmount));
      result[key] = bucket;
      return result;
    }, {});
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      matching: matching.length,
      eligible: plan.length,
      blockedWithActiveAllocations: blocked.length,
      totals
    }, null, 2));
    if (!apply || !plan.length) return;

    const batchId = `owner-madalin-bank-activity:${new Date().toISOString()}`;
    await prisma.$transaction(async (tx) => {
      for (const item of plan) {
        const updated = await tx.financialBankTransaction.updateMany({
          where: {
            id: item.id,
            receivablePayments: { none: { status: "active" } },
            payablePayments: { none: { status: "active" } }
          },
          data: { classification: TARGET_CLASSIFICATION, reconciliationStatus: "ignored" }
        });
        if (updated.count !== 1) throw new Error(`Tranzacția ${item.id} s-a modificat în timpul reclasificării.`);
        await tx.auditLog.create({
          data: {
            action: "financial.bank_transaction_owner_classified",
            entityType: "financial_bank_transaction",
            entityId: item.id,
            metadata: {
              batchId,
              owner: "MADALIN_MARIAN_STAN",
              before: { classification: item.classification, reconciliationStatus: item.reconciliationStatus },
              after: { classification: TARGET_CLASSIFICATION, reconciliationStatus: "ignored" },
              reason: "confirmed_owner_bank_activity"
            }
          }
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
    console.log(JSON.stringify({ applied: plan.length, batchId }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
