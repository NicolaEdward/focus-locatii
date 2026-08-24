const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { loadTsModule } = require("./load-ts-module.cjs");

async function main() {
  const options = readOptions(process.argv.slice(2));
  loadEnv(process.env.ENV_FILE || ".env.local");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL lipsește.");
  if (!fs.existsSync(options.file)) throw new Error(`Fișierul nu există: ${options.file}`);
  const smartbill = loadTsModule(path.resolve(process.cwd(), "src/lib/smartbill-import.ts"));
  const company = smartbill.resolveSmartBillCompanyContext(options.company);
  const parsed = await smartbill.parseSmartBillCustomerInvoices(fs.readFileSync(options.file), { fileName: path.basename(options.file) });
  const connection = await databaseConnection(process.env.DATABASE_URL);
  try {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    const [clients] = await connection.query(`
      SELECT id, companyName, normalizedName, taxId, accountOwnerUserId
      FROM portfolio_client_accounts
      WHERE status NOT IN ('merged', 'archived')
    `);
    const [receivables] = await connection.execute(`
      SELECT
        receivable.id,
        receivable.companyName,
        receivable.companyCode,
        receivable.normalizedInvoiceNumber,
        receivable.invoiceNumber,
        receivable.invoiceDate,
        receivable.dueDate,
        receivable.clientId,
        receivable.clientName,
        receivable.currency,
        receivable.invoicedAmount,
        receivable.collectedAmount,
        receivable.remainingAmount,
        receivable.rawRowJson,
        receivable.includedInReport,
        receivable.status,
        client.taxId AS entityTaxId,
        client.normalizedName AS entityNormalizedName
      FROM portfolio_financial_receivables receivable
      LEFT JOIN portfolio_client_accounts client ON client.id = receivable.clientId
      WHERE (receivable.companyCode = ? OR receivable.companyName = ?)
        AND receivable.includedInReport = 1
        AND receivable.status NOT IN ('cancelled', 'archived')
    `, [company.companyCode, company.companyName]);
    const preview = smartbill.buildSmartBillPreview({
      parsed,
      fileName: path.basename(options.file),
      companyContext: company,
      context: {
        clients: clients.map((client) => ({
          id: client.id,
          name: client.companyName,
          normalizedName: client.normalizedName,
          taxId: client.taxId,
          accountOwnerUserId: client.accountOwnerUserId
        })),
        receivables: receivables.map((row) => ({
          ...row,
          rawRowJson: parseJson(row.rawRowJson),
          amount: row.invoicedAmount,
          paidOrCollectedAmount: row.collectedAmount
        }))
      },
      includeToken: false
    });
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      file: path.basename(options.file),
      companyCode: company.companyCode,
      summary: preview.summary,
      negativeRows: preview.rows.filter((row) => row.totalAmount < 0).map((row) => ({
        documentNumber: row.documentNumber,
        fiscalCode: row.normalizedFiscalCode,
        amount: row.totalAmount,
        action: row.proposedAction,
        linkedDocumentNumber: row.linkedDocumentNumber,
        confidence: row.matchConfidence,
        reason: row.warning || row.adjustmentReason
      })),
      positiveDuplicateRows: preview.rows.filter((row) => row.totalAmount > 0 && row.proposedAction === "DUPLICATE").map((row) => ({
        documentNumber: row.documentNumber,
        fiscalCode: row.normalizedFiscalCode,
        amount: row.totalAmount,
        duplicateId: row.duplicateId,
        reason: row.warning
      }))
    }, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

function readOptions(args) {
  const values = new Map(args.filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }));
  const file = path.resolve(values.get("file") || "");
  const company = values.get("company") || "";
  if (!values.get("file") || !company) throw new Error("Sunt obligatorii --file și --company.");
  return { file, company };
}

async function databaseConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  return mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: url.searchParams.has("sslaccept") ? { rejectUnauthorized: false } : undefined
  });
}

function parseJson(value) {
  if (!value || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function loadEnv(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
