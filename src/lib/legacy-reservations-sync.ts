import mysql from "mysql2/promise";
import { prisma } from "@/lib/prisma";

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
  created_on: string | Date | null;
};

export type LegacyReservationSyncSummary = {
  scanned: number;
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
  cancelledMissing: number;
  disabled?: boolean;
  message?: string;
};

export async function syncLegacyReservations(): Promise<LegacyReservationSyncSummary> {
  if (process.env.ENABLE_LEGACY_RESERVATION_SYNC !== "true") {
    return {
      scanned: 0,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
      cancelledMissing: 0,
      disabled: true,
      message: "Sincronizarea legacy este dezactivata. Rezervarile si inchirierile se introduc manual in noua logica."
    };
  }

  const connection = await mysql.createConnection(mysqlOptions());

  try {
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
        r.created_by,
        r.created_on
      FROM rezervari r
      LEFT JOIN locatii l ON l.id = r.loc_id
      LEFT JOIN portfolio_locations p ON p.code = l.code
      ORDER BY r.id ASC
    `);

    const legacyRows = rows as LegacyReservationRow[];
    const currentExternalIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let conflicts = 0;

    const existing = await prisma.reservation.findMany({
      where: { externalSource: "legacy-rezervari" },
      select: { externalId: true }
    });
    const existingExternalIds = new Set(existing.map((item) => item.externalId).filter(Boolean) as string[]);

    for (const rawRow of legacyRows) {
      const externalId = `legacy:${rawRow.id}`;
      currentExternalIds.add(externalId);
      const periodStart = parseLegacyDate(rawRow.data_start);
      const periodEnd = parseLegacyDate(rawRow.data_end);

      if (!rawRow.portfolio_id || !periodStart || !periodEnd || periodStart > periodEnd) {
        skipped += 1;
        continue;
      }

      const amount = parseAmount(rawRow.suma);
      const clientName = clean(rawRow.client) || "Client existent";
      const bookedAt = parseLegacyDate(rawRow.created_on);

      const conflict = await prisma.reservation.findFirst({
        where: {
          locationId: rawRow.portfolio_id,
          OR: [{ externalId: null }, { externalId: { not: externalId } }],
          status: { in: ["HOLD", "RESERVED", "BOOKED"] },
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart }
        },
        select: { id: true }
      });
      if (conflict) {
        skipped += 1;
        conflicts += 1;
        continue;
      }

      // Import-only sync boundary: this mirrors rows from the legacy rezervari table
      // when ENABLE_LEGACY_RESERVATION_SYNC=true. User-facing reservation lifecycle
      // writes must stay in src/lib/reservations.ts where conflict locking is enforced.
      await prisma.reservation.upsert({
        where: { externalId },
        update: {
          locationId: rawRow.portfolio_id,
          status: "BOOKED",
          clientName,
          contractCompany: clientName,
          campaignName: clean(rawRow.campaign),
          salesperson: clean(rawRow.created_by),
          amount,
          monthlyRentTotal: amount,
          monthlyRentShare: amount,
          periodStart,
          periodEnd,
          neutralizationDate: periodEnd,
          externalSource: "legacy-rezervari",
          holdExpiresAt: null,
          ...(bookedAt ? { bookedAt } : {})
        },
        create: {
          locationId: rawRow.portfolio_id,
          status: "BOOKED",
          clientName,
          contractCompany: clientName,
          campaignName: clean(rawRow.campaign),
          salesperson: clean(rawRow.created_by),
          amount,
          monthlyRentTotal: amount,
          monthlyRentShare: amount,
          periodStart,
          periodEnd,
          neutralizationDate: periodEnd,
          externalSource: "legacy-rezervari",
          externalId,
          bookedAt,
          holdExpiresAt: null
        }
      });

      if (existingExternalIds.has(externalId)) updated += 1;
      else created += 1;
    }

    const staleExternalIds = [...existingExternalIds].filter((externalId) => !currentExternalIds.has(externalId));
    let cancelledMissing = 0;
    if (staleExternalIds.length) {
      // Import-only sync cleanup for legacy-origin rows that disappeared upstream.
      // This is not a live hold/release/cancel workflow path.
      const result = await prisma.reservation.updateMany({
        where: {
          externalId: { in: staleExternalIds },
          externalSource: "legacy-rezervari",
          status: { in: ["HOLD", "RESERVED", "BOOKED"] }
        },
        data: { status: "CANCELLED" }
      });
      cancelledMissing = result.count;
    }

    return {
      scanned: legacyRows.length,
      synced: created + updated,
      created,
      updated,
      skipped,
      conflicts,
      cancelledMissing
    };
  } finally {
    await connection.end();
  }
}

function mysqlOptions(): mysql.ConnectionOptions {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is missing.");

  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false }
  };
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

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === text.slice(0, 10) ? date : null;
}
