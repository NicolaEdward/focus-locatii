import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

type Connection = mysql.Connection;

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());
  const changes: string[] = [];

  try {
    await ensureReservationSeller(connection, changes);
    await ensureLocationBusinessFields(connection, changes);
    await ensureFinancialCurrencyAndReview(connection, changes);
    await ensureCrmTables(connection, changes);
    await normalizeExistingData(connection, changes);
    console.log(JSON.stringify({ ok: true, changes }, null, 2));
  } finally {
    await connection.end();
  }
}

async function ensureReservationSeller(connection: Connection, changes: string[]) {
  if (!(await hasColumn(connection, "portfolio_reservations", "sellerUserId"))) {
    await connection.query(`ALTER TABLE portfolio_reservations ADD COLUMN sellerUserId VARCHAR(191) NULL`);
    changes.push("portfolio_reservations.sellerUserId");
  }
  await ensureIndex(connection, changes, "portfolio_reservations", "portfolio_reservations_sellerUserId_idx", "sellerUserId");
  await ensureForeignKey(
    connection,
    changes,
    "portfolio_reservations",
    "portfolio_reservations_sellerUserId_fkey",
    "sellerUserId",
    "portfolio_users",
    "id",
    "SET NULL"
  );
}

async function ensureLocationBusinessFields(connection: Connection, changes: string[]) {
  const fields: Array<[string, string]> = [
    ["normalizedLocationName", "VARCHAR(191) NULL"],
    ["reportingGroupName", "VARCHAR(191) NULL"],
    ["displayOrder", "INT NULL"],
    ["locationGroupOrder", "INT NULL"],
    ["faceOrder", "INT NULL"],
    ["directionOrder", "INT NULL"],
    ["monthlyCost", "DOUBLE NULL"],
    ["costCurrency", "VARCHAR(3) NULL"],
    ["costType", "VARCHAR(191) NULL"],
    ["costSupplier", "VARCHAR(191) NULL"],
    ["costNotes", "TEXT NULL"],
    ["blockedReason", "TEXT NULL"],
    ["blockedByUserId", "VARCHAR(191) NULL"],
    ["blockedFrom", "DATETIME(3) NULL"],
    ["blockedUntil", "DATETIME(3) NULL"],
    ["blockedNotes", "TEXT NULL"]
  ];

  for (const [column, ddl] of fields) {
    if (!(await hasColumn(connection, "portfolio_locations", column))) {
      await connection.query(`ALTER TABLE portfolio_locations ADD COLUMN \`${column}\` ${ddl}`);
      changes.push(`portfolio_locations.${column}`);
    }
  }

  await ensureIndex(connection, changes, "portfolio_locations", "portfolio_locations_reportingGroupName_idx", "reportingGroupName");
  await ensureIndex(connection, changes, "portfolio_locations", "portfolio_locations_displayOrder_idx", "displayOrder");
  await ensureIndex(connection, changes, "portfolio_locations", "portfolio_locations_locationGroupOrder_idx", "locationGroupOrder");
  await ensureIndex(connection, changes, "portfolio_locations", "portfolio_locations_blockedByUserId_idx", "blockedByUserId");
  await ensureForeignKey(
    connection,
    changes,
    "portfolio_locations",
    "portfolio_locations_blockedByUserId_fkey",
    "blockedByUserId",
    "portfolio_users",
    "id",
    "SET NULL"
  );
}

async function ensureFinancialCurrencyAndReview(connection: Connection, changes: string[]) {
  const snapshotFields: Array<[string, string]> = [
    ["totalPayableRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalPayableEur", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalPaidRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalPaidEur", "DOUBLE NOT NULL DEFAULT 0"],
    ["remainingPayableRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["remainingPayableEur", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalReceivableRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalReceivableEur", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalCollectedRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["totalCollectedEur", "DOUBLE NOT NULL DEFAULT 0"],
    ["remainingReceivableRon", "DOUBLE NOT NULL DEFAULT 0"],
    ["remainingReceivableEur", "DOUBLE NOT NULL DEFAULT 0"]
  ];
  for (const [column, ddl] of snapshotFields) {
    if (!(await hasColumn(connection, "portfolio_financial_company_snapshots", column))) {
      await connection.query(`ALTER TABLE portfolio_financial_company_snapshots ADD COLUMN \`${column}\` ${ddl}`);
      changes.push(`portfolio_financial_company_snapshots.${column}`);
    }
  }

  const rowFields: Array<[string, string]> = [
    ["currency", "VARCHAR(3) NULL"],
    ["includedInReport", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["rowType", "VARCHAR(191) NULL"],
    ["reviewedByUserId", "VARCHAR(191) NULL"],
    ["reviewedAt", "DATETIME(3) NULL"],
    ["excludeReason", "TEXT NULL"]
  ];
  for (const table of ["portfolio_financial_payables", "portfolio_financial_receivables"]) {
    for (const [column, ddl] of rowFields) {
      if (!(await hasColumn(connection, table, column))) {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
        changes.push(`${table}.${column}`);
      }
    }
    await ensureIndex(connection, changes, table, `${table}_currency_idx`, "currency");
    await ensureIndex(connection, changes, table, `${table}_includedInReport_idx`, "includedInReport");
    await ensureIndex(connection, changes, table, `${table}_reviewedByUserId_idx`, "reviewedByUserId");
  }

  await ensureForeignKey(
    connection,
    changes,
    "portfolio_financial_payables",
    "portfolio_financial_payables_reviewedByUserId_fkey",
    "reviewedByUserId",
    "portfolio_users",
    "id",
    "SET NULL"
  );
  await ensureForeignKey(
    connection,
    changes,
    "portfolio_financial_receivables",
    "portfolio_financial_receivables_reviewedByUserId_fkey",
    "reviewedByUserId",
    "portfolio_users",
    "id",
    "SET NULL"
  );
}

async function ensureCrmTables(connection: Connection, changes: string[]) {
  await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_crm_leads (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    companyName VARCHAR(191) NOT NULL,
    contactName VARCHAR(191) NULL,
    phone VARCHAR(191) NULL,
    email VARCHAR(191) NULL,
    source VARCHAR(191) NULL,
    assignedToUserId VARCHAR(191) NULL,
    createdByUserId VARCHAR(191) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'new',
    estimatedValue DOUBLE NULL,
    currency VARCHAR(3) NULL,
    probability INT NULL,
    expectedCloseDate DATETIME(3) NULL,
    nextFollowUpDate DATETIME(3) NULL,
    notes TEXT NULL,
    lostReason TEXT NULL,
    sourceOfferRequestId VARCHAR(191) NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY portfolio_crm_leads_assignedToUserId_idx (assignedToUserId),
    KEY portfolio_crm_leads_createdByUserId_idx (createdByUserId),
    KEY portfolio_crm_leads_status_idx (status),
    KEY portfolio_crm_leads_nextFollowUpDate_idx (nextFollowUpDate),
    KEY portfolio_crm_leads_sourceOfferRequestId_idx (sourceOfferRequestId),
    CONSTRAINT portfolio_crm_leads_assignedToUserId_fkey FOREIGN KEY (assignedToUserId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT portfolio_crm_leads_createdByUserId_fkey FOREIGN KEY (createdByUserId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  changes.push("portfolio_crm_leads");

  await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_crm_activities (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    leadId VARCHAR(191) NOT NULL,
    userId VARCHAR(191) NULL,
    type VARCHAR(60) NOT NULL,
    activityDate DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    note TEXT NULL,
    nextStep TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY portfolio_crm_activities_leadId_idx (leadId),
    KEY portfolio_crm_activities_userId_idx (userId),
    KEY portfolio_crm_activities_type_idx (type),
    KEY portfolio_crm_activities_activityDate_idx (activityDate),
    CONSTRAINT portfolio_crm_activities_leadId_fkey FOREIGN KEY (leadId) REFERENCES portfolio_crm_leads(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT portfolio_crm_activities_userId_fkey FOREIGN KEY (userId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  changes.push("portfolio_crm_activities");
}

async function normalizeExistingData(connection: Connection, changes: string[]) {
  await connection.query(`UPDATE portfolio_users SET name = 'Emilian Vladut' WHERE name = 'Emilian Vladu'`);
  await connection.query(`UPDATE portfolio_reservations SET salesperson = 'Emilian Vladut' WHERE salesperson = 'Emilian Vladu'`);
  changes.push("Emilian Vladu -> Emilian Vladut");

  await connection.query(`
    UPDATE portfolio_reservations r
    JOIN portfolio_users u ON r.ownerId = u.id
    SET r.sellerUserId = u.id,
        r.salesperson = COALESCE(NULLIF(r.salesperson, ''), u.name)
    WHERE r.sellerUserId IS NULL
      AND u.active = TRUE
  `);
  changes.push("reservations.sellerUserId_from_ownerId");

  await connection.query(`
    UPDATE portfolio_reservations r
    JOIN portfolio_users u ON LOWER(TRIM(r.salesperson)) IN (LOWER(TRIM(u.name)), LOWER(TRIM(u.email)))
    SET r.sellerUserId = u.id,
        r.ownerId = COALESCE(r.ownerId, u.id),
        r.salesperson = u.name
    WHERE r.sellerUserId IS NULL
      AND u.active = TRUE
  `);
  changes.push("reservations.sellerUserId_from_text");

  await connection.query(`
    UPDATE portfolio_locations
    SET reportingGroupName = 'Pasarela',
        normalizedLocationName = 'Pasarela'
    WHERE LOWER(TRIM(COALESCE(type, ''))) IN ('pasarela', 'pasarele')
       OR LOWER(TRIM(COALESCE(address, ''))) REGEXP '(^|[^a-z])pasarel(a|e)([^a-z]|$)'
  `);
  changes.push("locations.Pasarela_normalized");

  await connection.query(`
    UPDATE portfolio_locations
    SET reportingGroupName = COALESCE(reportingGroupName, NULLIF(TRIM(address), ''), code),
        normalizedLocationName = COALESCE(normalizedLocationName, NULLIF(TRIM(address), ''), code)
    WHERE reportingGroupName IS NULL OR normalizedLocationName IS NULL
  `);
  changes.push("locations.reporting_names_backfilled");

  await connection.query(`
    UPDATE portfolio_locations
    SET displayOrder = CAST(nr AS UNSIGNED)
    WHERE displayOrder IS NULL
      AND nr REGEXP '^[0-9]+$'
  `);
  changes.push("locations.displayOrder_from_nr");

  await connection.query(`
    UPDATE portfolio_locations
    SET faceOrder = CASE
      WHEN code REGEXP 'A$' THEN 1
      WHEN code REGEXP 'B$' THEN 2
      ELSE COALESCE(faceOrder, 99)
    END
    WHERE faceOrder IS NULL OR faceOrder = 99
  `);
  changes.push("locations.faceOrder_from_code");

  await connection.query(`
    UPDATE portfolio_financial_payables
    SET includedInReport = TRUE
    WHERE includedInReport IS NULL
  `);
  await connection.query(`
    UPDATE portfolio_financial_receivables
    SET includedInReport = TRUE
    WHERE includedInReport IS NULL
  `);
}

async function hasColumn(connection: Connection, table: string, column: string) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SHOW COLUMNS FROM \`${table}\` LIKE ${connection.escape(column)}`
  );
  return rows.length > 0;
}

async function ensureIndex(connection: Connection, changes: string[], table: string, indexName: string, column: string) {
  if (await hasIndex(connection, table, indexName)) return;
  await connection.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (\`${column}\`)`);
  changes.push(indexName);
}

async function hasIndex(connection: Connection, table: string, indexName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`,
    [indexName]
  );
  return rows.length > 0;
}

async function ensureForeignKey(
  connection: Connection,
  changes: string[],
  table: string,
  keyName: string,
  column: string,
  referencedTable: string,
  referencedColumn: string,
  onDelete: "CASCADE" | "SET NULL" | "RESTRICT"
) {
  if (await hasForeignKey(connection, table, keyName)) return;
  await connection.query(`
    ALTER TABLE \`${table}\`
    ADD CONSTRAINT \`${keyName}\`
    FOREIGN KEY (\`${column}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
    ON DELETE ${onDelete} ON UPDATE CASCADE
  `);
  changes.push(keyName);
}

async function hasForeignKey(connection: Connection, table: string, keyName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, keyName]
  );
  return rows.length > 0;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
