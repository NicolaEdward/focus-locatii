import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

const tableName = "portfolio_reservations";
const columns = [
  { name: "bookedAt", definition: "DATETIME(3) NULL" },
  { name: "holdExpiresAt", definition: "DATETIME(3) NULL" }
] as const;
const indexes = [
  { name: "portfolio_reservations_bookedAt_idx", column: "bookedAt" },
  { name: "portfolio_reservations_holdExpiresAt_idx", column: "holdExpiresAt" }
] as const;

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());
  const addedColumns: string[] = [];
  const addedIndexes: string[] = [];

  try {
    for (const column of columns) {
      if (await hasColumn(connection, column.name)) continue;
      await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${column.name}\` ${column.definition}`);
      addedColumns.push(column.name);
    }

    for (const index of indexes) {
      if (await hasIndex(connection, index.name)) continue;
      await connection.query(`CREATE INDEX \`${index.name}\` ON \`${tableName}\` (\`${index.column}\`)`);
      addedIndexes.push(index.name);
    }

    const [legacyBooked] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE portfolio_reservations p
      JOIN rezervari r ON p.externalId = CONCAT('legacy:', r.id)
      SET p.bookedAt = STR_TO_DATE(r.created_on, '%Y-%m-%d')
      WHERE p.status = 'BOOKED'
        AND p.bookedAt IS NULL
        AND r.created_on REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `);
    const [manualBooked] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE portfolio_reservations
      SET bookedAt = createdAt
      WHERE status = 'BOOKED'
        AND bookedAt IS NULL
        AND externalSource IS NULL
    `);
    const [holdsBackfilled] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE portfolio_reservations
      SET holdExpiresAt = DATE_ADD(createdAt, INTERVAL 5 DAY)
      WHERE status IN ('HOLD', 'RESERVED')
        AND holdExpiresAt IS NULL
    `);
    const [holdsExpired] = await connection.query<mysql.ResultSetHeader>(`
      UPDATE portfolio_reservations
      SET status = 'EXPIRED', holdExpiresAt = NULL
      WHERE status IN ('HOLD', 'RESERVED')
        AND holdExpiresAt <= UTC_TIMESTAMP(3)
    `);

    console.log(
      JSON.stringify(
        {
          ok: true,
          addedColumns,
          addedIndexes,
          legacyBooked: legacyBooked.affectedRows,
          manualBooked: manualBooked.affectedRows,
          holdsBackfilled: holdsBackfilled.affectedRows,
          holdsExpired: holdsExpired.affectedRows
        },
        null,
        2
      )
    );
  } finally {
    await connection.end();
  }
}

async function hasColumn(connection: mysql.Connection, columnName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function hasIndex(connection: mysql.Connection, indexName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
