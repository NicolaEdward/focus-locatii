import mysql from "mysql2/promise";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

type LegacyReservationRow = {
  id: number;
  loc_id: number | null;
  legacy_code: string | null;
  portfolio_id: string | null;
  client: string | null;
  data_start: string | Date | null;
  data_end: string | Date | null;
  suma: number | string | null;
  campaign: string | null;
  created_by: string | null;
};

const prisma = new PrismaClient();

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());

  const [rows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT
      r.id,
      r.loc_id,
      l.code AS legacy_code,
      p.id AS portfolio_id,
      r.client,
      r.data_start,
      r.data_end,
      r.suma,
      r.campaign,
      r.created_by
    FROM rezervari r
    LEFT JOIN locatii l ON l.id = r.loc_id
    LEFT JOIN portfolio_locations p ON p.code = l.code
    ORDER BY r.id ASC
  `);

  let imported = 0;
  let skipped = 0;

  for (const rawRow of rows as LegacyReservationRow[]) {
    const periodStart = parseLegacyDate(rawRow.data_start);
    const periodEnd = parseLegacyDate(rawRow.data_end);

    if (!rawRow.portfolio_id || !periodStart || !periodEnd || periodStart > periodEnd) {
      skipped += 1;
      continue;
    }

    await prisma.reservation.upsert({
      where: { externalId: `legacy:${rawRow.id}` },
      update: {
        locationId: rawRow.portfolio_id,
        status: "BOOKED",
        clientName: clean(rawRow.client) || "Client existent",
        campaignName: clean(rawRow.campaign),
        salesperson: clean(rawRow.created_by),
        amount: parseAmount(rawRow.suma),
        periodStart,
        periodEnd,
        externalSource: "legacy-rezervari"
      },
      create: {
        locationId: rawRow.portfolio_id,
        status: "BOOKED",
        clientName: clean(rawRow.client) || "Client existent",
        campaignName: clean(rawRow.campaign),
        salesperson: clean(rawRow.created_by),
        amount: parseAmount(rawRow.suma),
        periodStart,
        periodEnd,
        externalSource: "legacy-rezervari",
        externalId: `legacy:${rawRow.id}`
      }
    });

    imported += 1;
  }

  await connection.end();
  await prisma.$disconnect();

  console.log(JSON.stringify({ imported, skipped }, null, 2));
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLegacyDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
