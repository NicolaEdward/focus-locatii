import crypto from "crypto";
import mysql from "mysql2/promise";
import { hashPassword } from "../src/lib/auth";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());
  const changes: string[] = [];

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_users (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      passwordHash VARCHAR(255) NOT NULL,
      role ENUM('SUPER_ADMIN','COO','SALES_DIRECTOR','SALES_AGENT','FINANCE_OPERATOR') NOT NULL DEFAULT 'SALES_AGENT',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      tokenVersion INT NOT NULL DEFAULT 0,
      lastLoginAt DATETIME(3) NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY portfolio_users_email_key (email),
      KEY portfolio_users_role_idx (role),
      KEY portfolio_users_active_idx (active)
    )`);
    await connection.query(`CREATE TABLE IF NOT EXISTS portfolio_audit_logs (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      userId VARCHAR(191) NULL,
      action VARCHAR(191) NOT NULL,
      entityType VARCHAR(191) NOT NULL,
      entityId VARCHAR(191) NULL,
      metadata JSON NULL,
      ipAddress VARCHAR(191) NULL,
      userAgent TEXT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY portfolio_audit_logs_userId_idx (userId),
      KEY portfolio_audit_logs_action_idx (action),
      KEY portfolio_audit_logs_entityType_idx (entityType),
      KEY portfolio_audit_logs_createdAt_idx (createdAt),
      CONSTRAINT portfolio_audit_logs_userId_fkey FOREIGN KEY (userId)
        REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE
    )`);

    for (const table of ["portfolio_reservations", "portfolio_offer_requests"]) {
      if (!(await hasColumn(connection, table, "ownerId"))) {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ownerId VARCHAR(191) NULL`);
        changes.push(`${table}.ownerId`);
      }
      const indexName = `${table}_ownerId_idx`;
      if (!(await hasIndex(connection, table, indexName))) {
        await connection.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (ownerId)`);
        changes.push(indexName);
      }
      const fkName = `${table}_ownerId_fkey`;
      if (!(await hasForeignKey(connection, table, fkName))) {
        await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fkName}\`
          FOREIGN KEY (ownerId) REFERENCES portfolio_users(id) ON DELETE SET NULL ON UPDATE CASCADE`);
        changes.push(fkName);
      }
    }

    const [countRows] = await connection.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM portfolio_users");
    let seededAdmin = false;
    if (Number(countRows[0]?.total || 0) === 0) {
      const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
      if (email && password) {
        await connection.execute(
          `INSERT INTO portfolio_users
            (id, email, name, passwordHash, role, active, tokenVersion, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'SUPER_ADMIN', TRUE, 0, NOW(3), NOW(3))`,
          [crypto.randomUUID(), email, "Administrator Focus Media", await hashPassword(password)]
        );
        seededAdmin = true;
      }
    }

    console.log(JSON.stringify({ ok: true, changes, seededAdmin }, null, 2));
  } finally {
    await connection.end();
  }
}

async function hasColumn(connection: mysql.Connection, table: string, column: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1",
    [table, column]
  );
  return rows.length > 0;
}

async function hasIndex(connection: mysql.Connection, table: string, index: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1",
    [table, index]
  );
  return rows.length > 0;
}

async function hasForeignKey(connection: mysql.Connection, table: string, constraint: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? LIMIT 1",
    [table, constraint]
  );
  return rows.length > 0;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
