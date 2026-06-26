const mysql = require("mysql2/promise");

function loadEnv() {
  require("dotenv").config({ path: ".env.local" });
  require("dotenv").config({ path: ".env" });
}

async function main() {
  loadEnv();
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await connection.query(
    `select l.code, l.nr, c.name as categoryName, l.address, l.latReal, l.lngReal,
            l.rateCard, l.availabilityText, l.mainPhotoUrl
       from portfolio_locations l
       join portfolio_categories c on c.id = l.categoryId
      where c.name in (?, ?, ?)
      order by c.name, l.code
      limit 100`,
    ["DN1", "Aeroportul Henri Coanda", "Backlit"]
  );
  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
