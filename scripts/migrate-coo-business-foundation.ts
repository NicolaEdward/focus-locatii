import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

type Connection = mysql.Connection;
type CountRow = mysql.RowDataPacket & { count: number };
type IdRow = mysql.RowDataPacket & { id: string };
type ClientBackfillRow = mysql.RowDataPacket & {
  clientName: string;
  clientCompany: string | null;
  sellerUserId: string | null;
  ownerId: string | null;
};

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());
  const changes: string[] = [];
  try {
    await ensureClientTables(connection, changes);
    await ensureBillingAndNotificationTables(connection, changes);
    await ensureReservationBillingFields(connection, changes);
    await ensureCrmSpreadsheetFields(connection, changes);
    await ensureFinancialDefensiveFields(connection, changes);
    await backfillClientAccounts(connection, changes);
    console.log(JSON.stringify({ ok: true, changes }, null, 2));
  } finally {
    await connection.end();
  }
}

async function ensureClientTables(connection: Connection, changes: string[]) {
  if (!(await hasTable(connection, "portfolio_client_accounts"))) {
    await connection.query(`
      CREATE TABLE portfolio_client_accounts (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        companyName VARCHAR(191) NOT NULL,
        normalizedName VARCHAR(191) NULL,
        taxId VARCHAR(191) NULL,
        billingAddress TEXT NULL,
        generalEmail VARCHAR(191) NULL,
        generalPhone VARCHAR(191) NULL,
        accountOwnerUserId VARCHAR(191) NULL,
        status VARCHAR(191) NOT NULL DEFAULT 'prospect',
        notes TEXT NULL,
        createdByUserId VARCHAR(191) NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX portfolio_client_accounts_normalizedName_idx (normalizedName),
        INDEX portfolio_client_accounts_accountOwnerUserId_idx (accountOwnerUserId),
        INDEX portfolio_client_accounts_status_idx (status)
      )
    `);
    changes.push("portfolio_client_accounts");
  }
  if (!(await hasTable(connection, "portfolio_client_contacts"))) {
    await connection.query(`
      CREATE TABLE portfolio_client_contacts (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        clientId VARCHAR(191) NOT NULL,
        name VARCHAR(191) NOT NULL,
        email VARCHAR(191) NULL,
        phone VARCHAR(191) NULL,
        role VARCHAR(191) NULL,
        isPrimary BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX portfolio_client_contacts_clientId_idx (clientId),
        INDEX portfolio_client_contacts_email_idx (email),
        CONSTRAINT portfolio_client_contacts_clientId_fkey FOREIGN KEY (clientId) REFERENCES portfolio_client_accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    changes.push("portfolio_client_contacts");
  }
  await ensureForeignKey(connection, changes, "portfolio_client_accounts", "portfolio_client_accounts_accountOwnerUserId_fkey", "accountOwnerUserId", "portfolio_users", "id", "SET NULL");
  await ensureForeignKey(connection, changes, "portfolio_client_accounts", "portfolio_client_accounts_createdByUserId_fkey", "createdByUserId", "portfolio_users", "id", "SET NULL");
}

async function ensureBillingAndNotificationTables(connection: Connection, changes: string[]) {
  if (!(await hasTable(connection, "portfolio_billing_items"))) {
    await connection.query(`
      CREATE TABLE portfolio_billing_items (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        reservationId VARCHAR(191) NULL,
        clientId VARCHAR(191) NULL,
        companyEntity VARCHAR(191) NULL,
        billingPeriodStart DATETIME(3) NOT NULL,
        billingPeriodEnd DATETIME(3) NOT NULL,
        invoiceDate DATETIME(3) NOT NULL,
        dueDate DATETIME(3) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(3) NOT NULL,
        billingRule VARCHAR(191) NOT NULL,
        paymentTermDays INT NOT NULL DEFAULT 0,
        status VARCHAR(191) NOT NULL DEFAULT 'draft',
        invoiceNumber VARCHAR(191) NULL,
        notes TEXT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX portfolio_billing_items_reservationId_idx (reservationId),
        INDEX portfolio_billing_items_clientId_idx (clientId),
        INDEX portfolio_billing_items_invoiceDate_idx (invoiceDate),
        INDEX portfolio_billing_items_dueDate_idx (dueDate),
        INDEX portfolio_billing_items_status_idx (status),
        INDEX portfolio_billing_items_currency_idx (currency)
      )
    `);
    changes.push("portfolio_billing_items");
  }
  if (!(await hasTable(connection, "portfolio_app_notifications"))) {
    await connection.query(`
      CREATE TABLE portfolio_app_notifications (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        userId VARCHAR(191) NOT NULL,
        type VARCHAR(191) NOT NULL,
        title VARCHAR(191) NOT NULL,
        message TEXT NOT NULL,
        entityType VARCHAR(191) NULL,
        entityId VARCHAR(191) NULL,
        severity VARCHAR(191) NOT NULL DEFAULT 'medium',
        status VARCHAR(191) NOT NULL DEFAULT 'open',
        dueDate DATETIME(3) NULL,
        recommendedAction TEXT NULL,
        metadata JSON NULL,
        resolvedByUserId VARCHAR(191) NULL,
        resolvedAt DATETIME(3) NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX portfolio_app_notifications_userId_idx (userId),
        INDEX portfolio_app_notifications_type_idx (type),
        INDEX portfolio_app_notifications_status_idx (status),
        INDEX portfolio_app_notifications_severity_idx (severity),
        INDEX portfolio_app_notifications_dueDate_idx (dueDate),
        INDEX portfolio_app_notifications_entity_idx (entityType, entityId)
      )
    `);
    changes.push("portfolio_app_notifications");
  }
  await ensureForeignKey(connection, changes, "portfolio_billing_items", "portfolio_billing_items_reservationId_fkey", "reservationId", "portfolio_reservations", "id", "CASCADE");
  await ensureForeignKey(connection, changes, "portfolio_billing_items", "portfolio_billing_items_clientId_fkey", "clientId", "portfolio_client_accounts", "id", "SET NULL");
  await ensureForeignKey(connection, changes, "portfolio_app_notifications", "portfolio_app_notifications_userId_fkey", "userId", "portfolio_users", "id", "CASCADE");
  await ensureForeignKey(connection, changes, "portfolio_app_notifications", "portfolio_app_notifications_resolvedByUserId_fkey", "resolvedByUserId", "portfolio_users", "id", "SET NULL");
}

async function ensureReservationBillingFields(connection: Connection, changes: string[]) {
  const fields: Array<[string, string]> = [
    ["clientId", "VARCHAR(191) NULL"],
    ["currency", "VARCHAR(3) NULL"],
    ["paymentTermType", "VARCHAR(191) NULL"],
    ["paymentTermDays", "INT NULL"],
    ["customPaymentTermNote", "TEXT NULL"],
    ["billingRule", "VARCHAR(191) NULL"],
    ["billingDayOfMonth", "INT NULL"],
    ["customBillingDate", "DATETIME(3) NULL"],
    ["billingFrequency", "VARCHAR(191) NULL"],
    ["invoiceGenerationMode", "VARCHAR(191) NULL"],
    ["nextInvoiceDate", "DATETIME(3) NULL"],
    ["billingNotes", "TEXT NULL"]
  ];
  for (const [column, ddl] of fields) await ensureColumn(connection, changes, "portfolio_reservations", column, ddl);
  await ensureIndex(connection, changes, "portfolio_reservations", "portfolio_reservations_clientId_idx", "clientId");
  await ensureIndex(connection, changes, "portfolio_reservations", "portfolio_reservations_nextInvoiceDate_idx", "nextInvoiceDate");
  await ensureForeignKey(connection, changes, "portfolio_reservations", "portfolio_reservations_clientId_fkey", "clientId", "portfolio_client_accounts", "id", "SET NULL");
}

async function ensureCrmSpreadsheetFields(connection: Connection, changes: string[]) {
  const leadFields: Array<[string, string]> = [
    ["leadDate", "DATETIME(3) NULL"],
    ["clientType", "VARCHAR(191) NULL"],
    ["clientId", "VARCHAR(191) NULL"],
    ["locationsInterested", "TEXT NULL"]
  ];
  for (const [column, ddl] of leadFields) await ensureColumn(connection, changes, "portfolio_crm_leads", column, ddl);
  await ensureIndex(connection, changes, "portfolio_crm_leads", "portfolio_crm_leads_clientId_idx", "clientId");
  await ensureForeignKey(connection, changes, "portfolio_crm_leads", "portfolio_crm_leads_clientId_fkey", "clientId", "portfolio_client_accounts", "id", "SET NULL");

  if (!(await hasTable(connection, "portfolio_crm_contacts"))) {
    await connection.query(`
      CREATE TABLE portfolio_crm_contacts (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        leadId VARCHAR(191) NOT NULL,
        clientId VARCHAR(191) NULL,
        name VARCHAR(191) NOT NULL,
        role VARCHAR(191) NULL,
        phone VARCHAR(191) NULL,
        email VARCHAR(191) NULL,
        isPrimary BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX portfolio_crm_contacts_leadId_idx (leadId),
        INDEX portfolio_crm_contacts_clientId_idx (clientId),
        INDEX portfolio_crm_contacts_email_idx (email),
        CONSTRAINT portfolio_crm_contacts_leadId_fkey FOREIGN KEY (leadId) REFERENCES portfolio_crm_leads(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    changes.push("portfolio_crm_contacts");
  }

  const activityFields: Array<[string, string]> = [
    ["actionType", "VARCHAR(191) NULL"],
    ["statusAtTime", "VARCHAR(191) NULL"],
    ["details", "TEXT NULL"],
    ["locations", "TEXT NULL"],
    ["nextFollowUpDate", "DATETIME(3) NULL"]
  ];
  for (const [column, ddl] of activityFields) await ensureColumn(connection, changes, "portfolio_crm_activities", column, ddl);
}

async function ensureFinancialDefensiveFields(connection: Connection, changes: string[]) {
  for (const [table, columns] of [
    ["portfolio_financial_company_snapshots", ["totalPayable", "totalPaid", "remainingPayable", "totalReceivable", "totalCollected", "remainingReceivable", "totalPayableRon", "totalPayableEur", "totalPaidRon", "totalPaidEur", "remainingPayableRon", "remainingPayableEur", "totalReceivableRon", "totalReceivableEur", "totalCollectedRon", "totalCollectedEur", "remainingReceivableRon", "remainingReceivableEur"]],
    ["portfolio_financial_payables", ["amountToPay", "amountPaid", "remainingAmount"]],
    ["portfolio_financial_receivables", ["invoicedAmount", "collectedAmount", "remainingAmount"]]
  ] as const) {
    for (const column of columns) {
      if (await hasColumn(connection, table, column)) {
        const nullable = table === "portfolio_financial_company_snapshots" ? "NOT NULL DEFAULT 0" : "NULL";
        await connection.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` DECIMAL(14,2) ${nullable}`);
      }
    }
    changes.push(`${table}.decimal_money`);
  }

  const receivableFields: Array<[string, string]> = [
    ["clientId", "VARCHAR(191) NULL"],
    ["billingItemId", "VARCHAR(191) NULL"],
    ["accountOwnerUserId", "VARCHAR(191) NULL"]
  ];
  for (const [column, ddl] of receivableFields) await ensureColumn(connection, changes, "portfolio_financial_receivables", column, ddl);
  await ensureIndex(connection, changes, "portfolio_financial_receivables", "portfolio_financial_receivables_clientId_idx", "clientId");
  await ensureIndex(connection, changes, "portfolio_financial_receivables", "portfolio_financial_receivables_billingItemId_idx", "billingItemId");
  await ensureIndex(connection, changes, "portfolio_financial_receivables", "portfolio_financial_receivables_accountOwnerUserId_idx", "accountOwnerUserId");
  await ensureForeignKey(connection, changes, "portfolio_financial_receivables", "portfolio_financial_receivables_clientId_fkey", "clientId", "portfolio_client_accounts", "id", "SET NULL");
  await ensureForeignKey(connection, changes, "portfolio_financial_receivables", "portfolio_financial_receivables_billingItemId_fkey", "billingItemId", "portfolio_billing_items", "id", "SET NULL");
}

async function backfillClientAccounts(connection: Connection, changes: string[]) {
  const [rows] = await connection.query<ClientBackfillRow[]>(
    `SELECT DISTINCT clientName, clientCompany, sellerUserId, ownerId FROM portfolio_reservations WHERE clientName IS NOT NULL AND clientName <> ''`
  );
  let created = 0;
  for (const row of rows) {
    const name = (row.clientCompany || row.clientName || "").trim();
    const normalized = normalizeName(name);
    if (!normalized) continue;
    const [existingRows] = await connection.query<IdRow[]>(
      `SELECT id FROM portfolio_client_accounts WHERE normalizedName = ? LIMIT 1`,
      [normalized]
    );
    const clientId = existingRows[0]?.id || cuidLike();
    if (!existingRows[0]) {
      await connection.query(
        `INSERT INTO portfolio_client_accounts (id, companyName, normalizedName, accountOwnerUserId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'active', NOW(3), NOW(3))`,
        [clientId, name, normalized, row.sellerUserId || row.ownerId || null]
      );
      created += 1;
    }
    await connection.query(
      `UPDATE portfolio_reservations SET clientId = ? WHERE clientId IS NULL AND (clientCompany = ? OR clientName = ?)`,
      [clientId, row.clientCompany || name, row.clientName]
    );
  }
  if (created) changes.push(`client_accounts_backfilled:${created}`);
}

async function ensureColumn(connection: Connection, changes: string[], table: string, column: string, ddl: string) {
  if (!(await hasColumn(connection, table, column))) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
    changes.push(`${table}.${column}`);
  }
}

async function hasTable(connection: Connection, table: string) {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0]?.count > 0;
}

async function hasColumn(connection: Connection, table: string, column: string) {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0]?.count > 0;
}

async function ensureIndex(connection: Connection, changes: string[], table: string, indexName: string, columnSql: string) {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) as count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  if (!rows[0]?.count) {
    await connection.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columnSql})`);
    changes.push(`${table}.${indexName}`);
  }
}

async function ensureForeignKey(connection: Connection, changes: string[], table: string, keyName: string, column: string, targetTable: string, targetColumn: string, onDelete: "CASCADE" | "SET NULL") {
  const [rows] = await connection.query<CountRow[]>(
    `SELECT COUNT(*) as count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, keyName]
  );
  if (!rows[0]?.count) {
    await connection.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${keyName}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${targetTable}\`(\`${targetColumn}\`) ON DELETE ${onDelete} ON UPDATE CASCADE`
    );
    changes.push(`${table}.${keyName}`);
  }
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cuidLike() {
  return `cm${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.slice(0, 25);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
