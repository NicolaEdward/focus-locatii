const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

async function main() {
  loadEnv(process.env.ENV_FILE || ".env.local");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL lipsește.");
  const url = new URL(process.env.DATABASE_URL);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: url.searchParams.has("sslaccept") ? { rejectUnauthorized: false } : undefined
  });
  try {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    const [rows] = await connection.query(`
      SELECT
        receivable.id,
        receivable.uploadId,
        receivable.clientId,
        receivable.companyCode,
        receivable.invoiceNumber,
        receivable.normalizedInvoiceNumber,
        receivable.currency,
        receivable.invoicedAmount,
        receivable.collectedAmount,
        receivable.remainingAmount,
        receivable.canonicalKey,
        receivable.invoiceDate,
        receivable.billingItemId,
        receivable.campaignId,
        receivable.rowType,
        receivable.status,
        receivable.createdAt,
        client.taxId,
        (SELECT COUNT(*) FROM portfolio_financial_receivable_payments payment WHERE payment.receivableId = receivable.id AND payment.status = 'active') AS activePayments,
        (SELECT COUNT(*) FROM portfolio_client_documents document WHERE document.financialReceivableId = receivable.id) AS documents,
        (SELECT COUNT(*) FROM portfolio_financial_client_credits credit WHERE credit.receivableId = receivable.id) AS credits,
        (SELECT COUNT(*) FROM portfolio_financial_receivable_import_rows importRow WHERE importRow.receivableId = receivable.id) AS importRows
      FROM portfolio_financial_receivables receivable
      LEFT JOIN portfolio_client_accounts client ON client.id = receivable.clientId
      WHERE receivable.includedInReport = 1
        AND receivable.status NOT IN ('cancelled', 'archived')
      ORDER BY receivable.companyCode, receivable.normalizedInvoiceNumber, receivable.createdAt
    `);
    const positiveRows = rows.filter((row) => money(row.invoicedAmount) > 0.01);
    const negativeRows = rows.filter((row) => money(row.invoicedAmount) < -0.01);
    const identityGroups = new Map();
    for (const row of positiveRows) {
      const invoiceKey = invoiceComparisonKey(row.normalizedInvoiceNumber || row.invoiceNumber);
      if (!invoiceKey) continue;
      const clientKey = canonicalTaxId(row.taxId) || row.clientId || "unassigned";
      const key = [row.companyCode, row.currency, invoiceKey, clientKey].join("|");
      identityGroups.set(key, [...(identityGroups.get(key) || []), row]);
    }
    const amountGroups = new Map();
    for (const [identityKey, group] of identityGroups) {
      for (const row of group) {
        const key = `${identityKey}|${money(row.invoicedAmount).toFixed(2)}`;
        amountGroups.set(key, [...(amountGroups.get(key) || []), row]);
      }
    }
    const duplicateGroups = [...amountGroups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => {
      const sorted = [...group].sort(compareCanonicalCandidates);
      const primary = sorted[0];
      const duplicates = sorted.slice(1).map((row) => ({
        ...publicRow(row),
        safeToArchive: dependencyCount(row) === 0 && row.clientId === primary.clientId,
        projectedOpenBalanceReduction: money(row.remainingAmount)
      }));
      return {
        key,
        primary: publicRow(primary),
        duplicates,
        projectedOpenBalanceReduction: round(duplicates.reduce((sum, row) => sum + row.projectedOpenBalanceReduction, 0)),
        classification: duplicates.every((row) => row.safeToArchive) ? "SAFE_REVIEW_CANDIDATE" : "NEEDS_REVIEW"
      };
    });
    const amountMismatchGroups = [...identityGroups.entries()]
      .filter(([, group]) => new Set(group.map((row) => money(row.invoicedAmount).toFixed(2))).size > 1)
      .map(([key, group]) => ({
        key,
        classification: "AMOUNT_MISMATCH_REVIEW",
        reason: "Același CUI și număr echivalent apar cu valori diferite; verifică dacă SmartBill a separat un storno/discount de valoarea brută.",
        rows: group.map(publicRow)
      }));
    const openBalancesByCompanyCurrency = aggregateOpenBalances(rows);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      activeReceivables: rows.length,
      activeNegativeAdjustments: negativeRows.length,
      equivalentDuplicateGroups: duplicateGroups.length,
      safeDuplicateGroups: duplicateGroups.filter((group) => group.classification === "SAFE_REVIEW_CANDIDATE").length,
      amountMismatchGroups: amountMismatchGroups.length,
      projectedOpenBalanceInflation: round(duplicateGroups.reduce((sum, group) => sum + group.projectedOpenBalanceReduction, 0)),
      openBalancesByCompanyCurrency,
      negativeAdjustments: negativeRows.map(publicRow),
      duplicateGroups,
      amountMismatchReview: amountMismatchGroups
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

function aggregateOpenBalances(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const remaining = money(row.remainingAmount);
    if (remaining <= 0.01) continue;
    const key = `${row.companyCode || "UNKNOWN"}|${row.currency || "UNKNOWN"}`;
    const bucket = buckets.get(key) || {
      companyCode: row.companyCode || "UNKNOWN",
      currency: row.currency || "UNKNOWN",
      openInvoiceCount: 0,
      openBalance: 0
    };
    bucket.openInvoiceCount += 1;
    bucket.openBalance = round(bucket.openBalance + remaining);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) =>
    left.companyCode.localeCompare(right.companyCode) || left.currency.localeCompare(right.currency)
  );
}

function publicRow(row) {
  return {
    id: row.id,
    clientId: row.clientId,
    companyCode: row.companyCode,
    invoiceNumber: row.invoiceNumber,
    normalizedInvoiceNumber: row.normalizedInvoiceNumber,
    currency: row.currency,
    invoicedAmount: money(row.invoicedAmount),
    collectedAmount: money(row.collectedAmount),
    remainingAmount: money(row.remainingAmount),
    invoiceDate: row.invoiceDate,
    rowType: row.rowType,
    activePayments: Number(row.activePayments || 0),
    documents: Number(row.documents || 0),
    credits: Number(row.credits || 0),
    importRows: Number(row.importRows || 0),
    hasBillingItem: Boolean(row.billingItemId),
    hasCampaign: Boolean(row.campaignId)
  };
}

function compareCanonicalCandidates(left, right) {
  return Number(right.activePayments || 0) - Number(left.activePayments || 0) ||
    money(right.collectedAmount) - money(left.collectedAmount) ||
    Number(Boolean(right.canonicalKey)) - Number(Boolean(left.canonicalKey)) ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function dependencyCount(row) {
  return Number(row.activePayments || 0) + Number(row.documents || 0) + Number(row.credits || 0) + Number(Boolean(row.billingItemId)) + Number(Boolean(row.campaignId));
}

function invoiceComparisonKey(value) {
  const normalized = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const match = normalized.match(/^([a-z]+)0*(\d+)$/);
  return match ? `${match[1]}${match[2].replace(/^0+(?=\d)/, "")}` : normalized;
}

function canonicalTaxId(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^RO\d+$/.test(normalized) ? normalized.slice(2) : normalized;
}

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? round(parsed) : 0;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function loadEnv(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
