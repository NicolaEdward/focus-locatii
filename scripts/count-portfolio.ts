import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";

async function main() {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing.");

  const connection = await mysql.createConnection({
    uri: url,
    ssl: { rejectUnauthorized: false }
  });

  const tables = [
    "portfolio_categories",
    "portfolio_locations",
    "portfolio_images",
    "portfolio_import_batches",
    "portfolio_gps_audit_logs"
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts[table] = Number((rows as Array<{ count: number }>)[0]?.count || 0);
  }

  await connection.end();
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
