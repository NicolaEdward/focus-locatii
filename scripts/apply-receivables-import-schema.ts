import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const confirmation = process.env.RECEIVABLES_SCHEMA_CONFIRM;
const migrationPath = path.resolve("prisma/migrations/20260719000000_receivables_import_reconciliation/migration.sql");
const newTables = [
  "portfolio_financial_receivable_import_rows",
  "portfolio_financial_receivable_payments",
  "portfolio_financial_client_aliases",
  "portfolio_financial_client_credits"
] as const;

async function main() {
  const before = await schemaState();
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", before }, null, 2));
  if (!apply) {
    console.log("Dry-run only. To apply: set RECEIVABLES_SCHEMA_CONFIRM=APPLY_RECEIVABLES_V2 and run pnpm db:apply-receivables-v2 --apply");
    return;
  }
  if (confirmation !== "APPLY_RECEIVABLES_V2") {
    throw new Error("Aplicarea este blocată. Setează explicit RECEIVABLES_SCHEMA_CONFIRM=APPLY_RECEIVABLES_V2 după review și backup.");
  }

  await addColumn("portfolio_financial_receivables", "canonicalKey", "`canonicalKey` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_receivables", "updatedAt", "`updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)");
  await addColumn("portfolio_financial_receivables", "lastReportDate", "`lastReportDate` DATETIME(3) NULL");
  await addColumn("portfolio_financial_receivables", "lastImportedAt", "`lastImportedAt` DATETIME(3) NULL");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_canonicalKey_key", "UNIQUE", "`canonicalKey`");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_company_invoice_currency_idx", "", "`companyCode`, `normalizedInvoiceNumber`, `currency`");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_client_dueDate_idx", "", "`clientId`, `dueDate`");

  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const table of newTables) {
    if (await tableExists(table)) continue;
    const statement = extractCreateTable(sql, table).replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS");
    await prisma.$executeRawUnsafe(statement);
    console.log(`created table ${table}`);
  }
  await addColumn("portfolio_financial_receivable_payments", "requestKey", "`requestKey` VARCHAR(191) NULL");
  await addIndex("portfolio_financial_receivable_payments", "portfolio_financial_receivable_payments_requestKey_key", "UNIQUE", "`requestKey`");

  const after = await schemaState();
  const missing = [...Object.entries(after.columns).filter(([, exists]) => !exists).map(([name]) => name), ...Object.entries(after.tables).filter(([, exists]) => !exists).map(([name]) => name)];
  if (missing.length) throw new Error(`Schema a rămas incompletă: ${missing.join(", ")}`);
  console.log(JSON.stringify({ ok: true, after }, null, 2));
}

async function schemaState() {
  const columns = Object.fromEntries(await Promise.all([
    ["portfolio_financial_receivables.canonicalKey", "portfolio_financial_receivables", "canonicalKey"],
    ["portfolio_financial_receivables.updatedAt", "portfolio_financial_receivables", "updatedAt"],
    ["portfolio_financial_receivables.lastReportDate", "portfolio_financial_receivables", "lastReportDate"],
    ["portfolio_financial_receivables.lastImportedAt", "portfolio_financial_receivables", "lastImportedAt"],
    ["portfolio_financial_receivable_payments.requestKey", "portfolio_financial_receivable_payments", "requestKey"]
  ].map(async ([key, table, column]) => [key, await columnExists(table, column)])));
  const tables = Object.fromEntries(await Promise.all(newTables.map(async (table) => [table, await tableExists(table)])));
  const counts: Record<string, number | null> = {};
  for (const table of newTables) counts[table] = tables[table] ? await tableCount(table) : null;
  return { columns, tables, counts };
}

async function addColumn(table: string, column: string, definition: string) {
  if (await columnExists(table, column)) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`added ${table}.${column}`);
}

async function addIndex(table: string, index: string, kind: "" | "UNIQUE", columns: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    table,
    index
  );
  if (Number(rows[0]?.count || 0)) return;
  await prisma.$executeRawUnsafe(`CREATE ${kind ? `${kind} ` : ""}INDEX \`${index}\` ON \`${table}\`(${columns})`);
  console.log(`added index ${index}`);
}

async function columnExists(table: string, column: string) {
  if (!(await tableExists(table))) return false;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    table,
    column
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function tableExists(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function tableCount(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM \`${table}\``);
  return Number(rows[0]?.count || 0);
}

function extractCreateTable(sql: string, table: string) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp("CREATE TABLE `" + escaped + "`[\\s\\S]*?\\n\\) DEFAULT CHARACTER SET[^;]+;", "i"));
  if (!match) throw new Error(`Definiția SQL lipsește pentru ${table}.`);
  return match[0];
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
