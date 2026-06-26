const fs = require("fs");
const mysql = require("mysql2/promise");

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    if (!fs.existsSync(fileName)) continue;
    for (const rawLine of fs.readFileSync(fileName, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();
  const url = new URL(process.env.DATABASE_URL);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false }
  });

  const tables = [
    "portfolio_categories",
    "portfolio_locations",
    "portfolio_images",
    "portfolio_import_batches",
    "portfolio_gps_audit_logs"
  ];

  const counts = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts[table] = Number(rows[0]?.count || 0);
  }

  await connection.end();
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
