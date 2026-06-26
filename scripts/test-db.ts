import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());

  const [versionRows] = await connection.query("SELECT VERSION() AS version");
  const [tableRows] = await connection.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
  );

  await connection.end();

  console.log(JSON.stringify({ ok: true, versionRows, tableRows }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
