import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());

  for (const table of ["locatii", "users", "rezervari"]) {
    const [rows] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
    console.log(`TABLE ${table}`);
    console.log(
      JSON.stringify(
        (rows as Array<Record<string, unknown>>).map((row) => ({
          Field: row.Field,
          Type: row.Type,
          Null: row.Null,
          Key: row.Key,
          Default: row.Default,
          Extra: row.Extra
        })),
        null,
        2
      )
    );
  }

  await connection.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
