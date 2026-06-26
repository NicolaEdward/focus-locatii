import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

const tableName = "portfolio_reservations";

const columns = [
  { name: "contractCompany", definition: "VARCHAR(191) NULL" },
  { name: "contractNumber", definition: "VARCHAR(191) NULL" },
  { name: "productionNotes", definition: "TEXT NULL" },
  { name: "monthlyRentTotal", definition: "DOUBLE NULL" },
  { name: "monthlyRentShare", definition: "DOUBLE NULL" },
  { name: "contractGroupId", definition: "VARCHAR(191) NULL" },
  { name: "installationDate", definition: "DATETIME(3) NULL" },
  { name: "neutralizationDate", definition: "DATETIME(3) NULL" }
] as const;

const indexes = [
  { name: "portfolio_reservations_contractGroupId_idx", column: "contractGroupId" },
  { name: "portfolio_reservations_installationDate_idx", column: "installationDate" },
  { name: "portfolio_reservations_neutralizationDate_idx", column: "neutralizationDate" }
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

    console.log(
      JSON.stringify(
        {
          ok: true,
          addedColumns,
          addedIndexes
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
    `
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function hasIndex(connection: mysql.Connection, indexName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `
      SELECT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );

  return rows.length > 0;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
