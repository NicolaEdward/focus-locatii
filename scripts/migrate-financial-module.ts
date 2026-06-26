import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());
  const changes: string[] = [];

  try {
    await ensureFinanceRole(connection, changes);

    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_financial_report_uploads (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      uploadedByUserId VARCHAR(191) NULL,
      uploadedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      reportDate DATETIME(3) NULL,
      originalFileName VARCHAR(191) NOT NULL,
      fileHash VARCHAR(191) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
      errorSummary TEXT NULL,
      activeVersion BOOLEAN NOT NULL DEFAULT FALSE,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY portfolio_financial_report_uploads_uploadedByUserId_idx (uploadedByUserId),
      KEY portfolio_financial_report_uploads_reportDate_idx (reportDate),
      KEY portfolio_financial_report_uploads_status_idx (status),
      KEY portfolio_financial_report_uploads_activeVersion_idx (activeVersion),
      KEY portfolio_financial_report_uploads_fileHash_idx (fileHash),
      CONSTRAINT portfolio_financial_report_uploads_uploadedByUserId_fkey
        FOREIGN KEY (uploadedByUserId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE
    )`);
    changes.push("portfolio_financial_report_uploads");

    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_financial_company_snapshots (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      uploadId VARCHAR(191) NOT NULL,
      companyName VARCHAR(191) NOT NULL,
      companyCode VARCHAR(191) NULL,
      totalPayable DOUBLE NOT NULL DEFAULT 0,
      totalPaid DOUBLE NOT NULL DEFAULT 0,
      remainingPayable DOUBLE NOT NULL DEFAULT 0,
      totalReceivable DOUBLE NOT NULL DEFAULT 0,
      totalCollected DOUBLE NOT NULL DEFAULT 0,
      remainingReceivable DOUBLE NOT NULL DEFAULT 0,
      payableRows INT NOT NULL DEFAULT 0,
      receivableRows INT NOT NULL DEFAULT 0,
      issueCount INT NOT NULL DEFAULT 0,
      calculatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY portfolio_financial_company_snapshots_uploadId_idx (uploadId),
      KEY portfolio_financial_company_snapshots_companyCode_idx (companyCode),
      CONSTRAINT portfolio_financial_company_snapshots_uploadId_fkey
        FOREIGN KEY (uploadId) REFERENCES portfolio_financial_report_uploads(id) ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    changes.push("portfolio_financial_company_snapshots");

    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_financial_payables (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      uploadId VARCHAR(191) NOT NULL,
      companyName VARCHAR(191) NOT NULL,
      companyCode VARCHAR(191) NULL,
      supplierName VARCHAR(191) NULL,
      documentDescription TEXT NULL,
      dueDate DATETIME(3) NULL,
      amountToPay DOUBLE NULL,
      amountPaid DOUBLE NULL,
      remainingAmount DOUBLE NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'needs_review',
      rawRowJson JSON NULL,
      needsReview BOOLEAN NOT NULL DEFAULT FALSE,
      reviewNote TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY portfolio_financial_payables_uploadId_idx (uploadId),
      KEY portfolio_financial_payables_companyCode_idx (companyCode),
      KEY portfolio_financial_payables_supplierName_idx (supplierName),
      KEY portfolio_financial_payables_dueDate_idx (dueDate),
      KEY portfolio_financial_payables_status_idx (status),
      KEY portfolio_financial_payables_needsReview_idx (needsReview),
      CONSTRAINT portfolio_financial_payables_uploadId_fkey
        FOREIGN KEY (uploadId) REFERENCES portfolio_financial_report_uploads(id) ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    changes.push("portfolio_financial_payables");

    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_financial_receivables (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      uploadId VARCHAR(191) NOT NULL,
      companyName VARCHAR(191) NOT NULL,
      companyCode VARCHAR(191) NULL,
      invoiceNumber VARCHAR(191) NULL,
      location TEXT NULL,
      campaignDetails TEXT NULL,
      clientName VARCHAR(191) NULL,
      dueDate DATETIME(3) NULL,
      invoicedAmount DOUBLE NULL,
      collectedAmount DOUBLE NULL,
      remainingAmount DOUBLE NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'needs_review',
      rawRowJson JSON NULL,
      needsReview BOOLEAN NOT NULL DEFAULT FALSE,
      reviewNote TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY portfolio_financial_receivables_uploadId_idx (uploadId),
      KEY portfolio_financial_receivables_companyCode_idx (companyCode),
      KEY portfolio_financial_receivables_clientName_idx (clientName),
      KEY portfolio_financial_receivables_dueDate_idx (dueDate),
      KEY portfolio_financial_receivables_status_idx (status),
      KEY portfolio_financial_receivables_needsReview_idx (needsReview),
      CONSTRAINT portfolio_financial_receivables_uploadId_fkey
        FOREIGN KEY (uploadId) REFERENCES portfolio_financial_report_uploads(id) ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    changes.push("portfolio_financial_receivables");

    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_financial_import_issues (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      uploadId VARCHAR(191) NOT NULL,
      companyName VARCHAR(191) NULL,
      companyCode VARCHAR(191) NULL,
      sheetName VARCHAR(191) NULL,
      rowNumber INT NULL,
      issueType VARCHAR(191) NOT NULL,
      issueMessage TEXT NOT NULL,
      severity VARCHAR(40) NOT NULL DEFAULT 'warning',
      rawRowJson JSON NULL,
      resolvedByUserId VARCHAR(191) NULL,
      resolvedAt DATETIME(3) NULL,
      resolutionNote TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY portfolio_financial_import_issues_uploadId_idx (uploadId),
      KEY portfolio_financial_import_issues_companyCode_idx (companyCode),
      KEY portfolio_financial_import_issues_severity_idx (severity),
      KEY portfolio_financial_import_issues_resolvedByUserId_idx (resolvedByUserId),
      CONSTRAINT portfolio_financial_import_issues_uploadId_fkey
        FOREIGN KEY (uploadId) REFERENCES portfolio_financial_report_uploads(id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT portfolio_financial_import_issues_resolvedByUserId_fkey
        FOREIGN KEY (resolvedByUserId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE
    )`);
    changes.push("portfolio_financial_import_issues");

    console.log(JSON.stringify({ ok: true, changes }, null, 2));
  } finally {
    await connection.end();
  }
}

async function ensureFinanceRole(connection: mysql.Connection, changes: string[]) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>("SHOW COLUMNS FROM portfolio_users LIKE 'role'");
  const currentType = String(rows[0]?.Type || "");
  if (!currentType.includes("FINANCE_OPERATOR")) {
    await connection.query(`
      ALTER TABLE portfolio_users
      MODIFY role ENUM('SUPER_ADMIN','COO','SALES_DIRECTOR','SALES_AGENT','FINANCE_OPERATOR') NOT NULL DEFAULT 'SALES_AGENT'
    `);
    changes.push("portfolio_users.role_FINANCE_OPERATOR");
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
