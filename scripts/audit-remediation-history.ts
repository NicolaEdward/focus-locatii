import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { companyCodeForEntity } from "../src/lib/company-entities";
import { isEffectiveBlockingReservation } from "../src/lib/reservation-lifecycle-domain";
import {
  receivableNetAmount,
  receivableNetRemaining,
} from "../src/lib/receivable-adjustments";
import { money } from "../src/lib/receivables-domain";
import { bankAllocationStatus } from "../src/lib/financial-bank-ledger";

const knownEntities = new Set(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]);
type Counters = Record<string, number>;
type Bucket = { entity: string; currency: string; counts: Counters };
const mixed = "__MIXED__";
function entity(value: unknown) {
  const text = String(value || "");
  return text === mixed
    ? "MIXED"
    : knownEntities.has(text)
      ? text
      : companyCodeForEntity(text) || "UNKNOWN";
}
function currency(value: unknown) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  return text === mixed
    ? "MIXED"
    : ["RON", "EUR"].includes(text)
      ? text
      : text
        ? "OTHER"
        : "UNKNOWN";
}
function finiteCount(value: unknown) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("AGGREGATE_COUNT_OUT_OF_RANGE");
  return count;
}
function date(value: unknown) {
  const result =
    value instanceof Date
      ? value
      : new Date(
          String(value).replace(" ", "T") +
            (String(value).endsWith("Z") ? "" : "Z"),
        );
  if (Number.isNaN(result.getTime())) throw new Error("INVENTORY_DATE_INVALID");
  return result;
}
function json(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function target(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "mysql:") throw new Error("MYSQL_URL_REQUIRED");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(database))
    throw new Error("INVALID_DATABASE_IDENTIFIER");
  const fingerprint = createHash("sha256")
    .update(
      `${url.protocol}//${url.hostname}:${url.port || "default"}/${database}`,
    )
    .digest("hex")
    .slice(0, 12);
  return { url, database, fingerprint };
}

export function assertInventoryTarget(raw: string) {
  const source = target(raw);
  const synthetic =
    ["ci", "test", "preview", "staging"].includes(process.env.APP_ENV || "") &&
    process.env.VERCEL_ENV !== "production" &&
    /(?:preview|test|ci|staging)/i.test(source.database);
  if (
    !synthetic &&
    (process.env.ALLOW_PRODUCTION_AGGREGATE_INVENTORY !== "true" ||
      process.env.INVENTORY_DATABASE_FINGERPRINT !== source.fingerprint)
  )
    throw new Error("AGGREGATE_INVENTORY_TARGET_OPT_IN_REQUIRED");
  return source;
}

/** The server enforces read-only mode. Every result is rolled back, even on success. */
export async function withReadOnlyInventorySnapshot<T>(
  raw: string,
  read: (db: Connection) => Promise<T>,
): Promise<T> {
  const source = assertInventoryTarget(raw);
  const remote = !["localhost", "127.0.0.1", "::1"].includes(
    source.url.hostname,
  );
  const ca =
    process.env.INVENTORY_MYSQL_CA_FILE ||
    source.url.searchParams.get("sslcert");
  const db = await mysql.createConnection({
    host: source.url.hostname,
    port: Number(source.url.port || 3306),
    user: decodeURIComponent(source.url.username),
    password: decodeURIComponent(source.url.password),
    database: source.database,
    ssl: remote
      ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_PEM ? { ca: process.env.DATABASE_CA_PEM } : ca ? { ca: readFileSync(ca) } : {}) }
      : undefined,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
    connectTimeout: 10_000,
  });
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    await db.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("SET SESSION lock_wait_timeout = 15");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const tables = [
      "portfolio_reservations",
      "portfolio_financial_receivables",
      "portfolio_financial_receivable_payments",
      "portfolio_financial_legal_entities",
      "portfolio_financial_bank_transactions",
      "portfolio_financial_payable_payments",
    ];
    const [engines] = await db.query<RowDataPacket[]>(
      "SELECT ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?)",
      [source.database, tables],
    );
    if (
      engines.length !== tables.length ||
      engines.some((row) => String(row.engine).toUpperCase() !== "INNODB")
    )
      throw new Error("CONSISTENT_INVENTORY_REQUIRES_INNODB_TABLES");
    return await read(db);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
}

export async function auditRemediationHistory(
  raw: string,
  options: { now?: Date; pageSize?: number } = {},
) {
  const now = options.now || new Date();
  const pageSize = Math.min(
    1000,
    Math.max(1, Math.floor(options.pageSize || 500)),
  );
  const buckets = new Map<string, Bucket>();
  function count(
    entityValue: unknown,
    currencyValue: unknown,
    metric: string,
    amount = 1,
  ) {
    const entityKey = entity(entityValue),
      currencyKey = currency(currencyValue);
    const key = `${entityKey}|${currencyKey}`;
    const bucket = buckets.get(key) || {
      entity: entityKey,
      currency: currencyKey,
      counts: {},
    };
    bucket.counts[metric] = finiteCount((bucket.counts[metric] || 0) + amount);
    buckets.set(key, bucket);
  }
  await withReadOnlyInventorySnapshot(raw, async (db) => {
    const [groups] = await db.query<RowDataPacket[]>(
      `SELECT entityKey,currencyKey,COUNT(*) contractGroups,SUM(ownerCount>1) mixedOwnerGroups,SUM(sellerCount>1) mixedSellerGroups,SUM(ownerCount>1 AND sellerCount>1) mixedOwnerAndSellerGroups FROM (SELECT contractGroupId,CASE WHEN COUNT(DISTINCT COALESCE(contractCompany,''))=1 THEN MIN(contractCompany) ELSE '${mixed}' END entityKey,CASE WHEN COUNT(DISTINCT COALESCE(currency,''))=1 THEN MIN(currency) ELSE '${mixed}' END currencyKey,COUNT(DISTINCT COALESCE(ownerId,'__UNASSIGNED__')) ownerCount,COUNT(DISTINCT COALESCE(sellerUserId,'__UNASSIGNED__')) sellerCount FROM portfolio_reservations WHERE contractGroupId IS NOT NULL AND contractGroupId<>'' GROUP BY contractGroupId) grouped GROUP BY entityKey,currencyKey`,
    );
    for (const row of groups)
      for (const metric of [
        "contractGroups",
        "mixedOwnerGroups",
        "mixedSellerGroups",
        "mixedOwnerAndSellerGroups",
      ])
        count(row.entityKey, row.currencyKey, metric, finiteCount(row[metric]));
    const [periods] = await db.query<RowDataPacket[]>(
      "SELECT contractCompany,currency,COUNT(*) reservationsScanned,SUM(periodStart>periodEnd) invalidReservationPeriods FROM portfolio_reservations GROUP BY contractCompany,currency",
    );
    for (const row of periods)
      for (const metric of ["reservationsScanned", "invalidReservationPeriods"])
        count(
          row.contractCompany,
          row.currency,
          metric,
          finiteCount(row[metric]),
        );
    let left = "",
      right = "";
    while (true) {
      const [pairs] = await db.query<RowDataPacket[]>(
        `SELECT a.id aId,b.id bId,a.contractCompany aEntity,b.contractCompany bEntity,a.currency aCurrency,b.currency bCurrency,a.status aStatus,b.status bStatus,a.createdAt aCreated,b.createdAt bCreated,a.holdExpiresAt aExpires,b.holdExpiresAt bExpires FROM portfolio_reservations a JOIN portfolio_reservations b ON a.locationId=b.locationId AND a.id<b.id AND a.periodStart<=b.periodEnd AND b.periodStart<=a.periodEnd WHERE a.status IN ('BOOKED','HOLD','RESERVED') AND b.status IN ('BOOKED','HOLD','RESERVED') AND a.periodStart<=a.periodEnd AND b.periodStart<=b.periodEnd AND (a.id>? OR (a.id=? AND b.id>?)) ORDER BY a.id,b.id LIMIT ?`,
        [left, left, right, pageSize],
      );
      for (const row of pairs) {
        const first = {
          status: String(row.aStatus),
          createdAt: date(row.aCreated),
          holdExpiresAt: row.aExpires ? date(row.aExpires) : null,
        };
        const second = {
          status: String(row.bStatus),
          createdAt: date(row.bCreated),
          holdExpiresAt: row.bExpires ? date(row.bExpires) : null,
        };
        if (
          !isEffectiveBlockingReservation(first, now) ||
          !isEffectiveBlockingReservation(second, now)
        )
          continue;
        const entityKey =
          entity(row.aEntity) === entity(row.bEntity) ? row.aEntity : mixed;
        const currencyKey =
          currency(row.aCurrency) === currency(row.bCurrency)
            ? row.aCurrency
            : mixed;
        count(entityKey, currencyKey, "effectiveInclusiveOverlapPairs");
        count(
          entityKey,
          currencyKey,
          first.status === "BOOKED" && second.status === "BOOKED"
            ? "bookedBookedOverlapPairs"
            : first.status === "BOOKED" || second.status === "BOOKED"
              ? "bookedHoldOverlapPairs"
              : "holdHoldOverlapPairs",
        );
      }
      if (pairs.length < pageSize) break;
      left = String(pairs.at(-1)!.aId);
      right = String(pairs.at(-1)!.bId);
    }
    let cursor = "";
    while (true) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT r.id,r.companyCode,e.code legalEntityCode,r.currency,r.invoicedAmount,r.collectedAmount,r.remainingAmount,JSON_EXTRACT(r.rawRowJson,'$.smartBillAdjustments') adjustmentEntries,(SELECT COUNT(*) FROM portfolio_financial_receivable_payments p WHERE p.receivableId=r.id) paymentRows,(SELECT COALESCE(SUM(p.amount),0) FROM portfolio_financial_receivable_payments p WHERE p.receivableId=r.id AND p.status='active') ledgerCollected FROM portfolio_financial_receivables r LEFT JOIN portfolio_financial_legal_entities e ON e.id=r.legalEntityId WHERE r.id>? ORDER BY r.id LIMIT ?`,
        [cursor, pageSize],
      );
      for (const row of rows) {
        const entityKey = row.legalEntityCode || row.companyCode;
        const rawRowJson = { smartBillAdjustments: json(row.adjustmentEntries) };
        const canonical = receivableNetRemaining({
          invoicedAmount: row.invoicedAmount,
          collectedAmount: row.collectedAmount,
          rawRowJson,
        });
        count(entityKey, row.currency, "receivablesScanned");
        if (!money(row.remainingAmount).equals(canonical))
          count(entityKey, row.currency, "storedRemainingVsCanonicalMismatch");
        if (
          Number(row.paymentRows) > 0 &&
          !money(row.collectedAmount).equals(money(row.ledgerCollected))
        )
          count(
            entityKey,
            row.currency,
            "storedCollectedVsActiveLedgerMismatch",
          );
        if (
          Number(row.paymentRows) === 0 &&
          money(row.collectedAmount).greaterThan(0)
        )
          count(entityKey, row.currency, "collectedBalanceWithoutLedgerRows");
        if (
          money(row.collectedAmount).greaterThan(
            receivableNetAmount(row.invoicedAmount, rawRowJson),
          )
        )
          count(entityKey, row.currency, "collectedExceedsAdjustedInvoice");
      }
      if (rows.length < pageSize) break;
      cursor = String(rows.at(-1)!.id);
    }
    cursor = "";
    while (true) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT b.id,e.code entityCode,b.currency,b.classification,b.creditAmount,b.debitAmount,b.reconciliationStatus,(SELECT COALESCE(SUM(p.amount),0) FROM portfolio_financial_receivable_payments p WHERE p.bankTransactionId=b.id AND p.status='active') receivableAllocated,(SELECT COALESCE(SUM(p.amount),0) FROM portfolio_financial_payable_payments p WHERE p.bankTransactionId=b.id AND p.status='active') payableAllocated FROM portfolio_financial_bank_transactions b LEFT JOIN portfolio_financial_legal_entities e ON e.id=b.legalEntityId WHERE b.id>? ORDER BY b.id LIMIT ?`,
        [cursor, pageSize],
      );
      for (const row of rows) {
        const allocated = money(row.receivableAllocated).plus(
          money(row.payableAllocated),
        );
        const expected = bankAllocationStatus({
          classification: row.classification,
          creditAmount: row.creditAmount,
          debitAmount: row.debitAmount,
          allocatedAmount: allocated,
        });
        count(row.entityCode, row.currency, "bankTransactionsScanned");
        if (expected !== row.reconciliationStatus)
          count(row.entityCode, row.currency, "bankAllocationStatusMismatch");
        const capacity = money(row.creditAmount).greaterThan(0)
          ? money(row.creditAmount)
          : money(row.debitAmount);
        if (allocated.greaterThan(capacity))
          count(
            row.entityCode,
            row.currency,
            "bankAllocatedExceedsTransaction",
          );
        if (
          money(row.creditAmount).greaterThan(0)
            ? money(row.payableAllocated).greaterThan(0)
            : money(row.receivableAllocated).greaterThan(0)
        )
          count(
            row.entityCode,
            row.currency,
            "bankAllocationDirectionMismatch",
          );
      }
      if (rows.length < pageSize) break;
      cursor = String(rows.at(-1)!.id);
    }
  });
  return {
    schemaVersion: "1.0",
    readOnly: true,
    isolation: "REPEATABLE READ",
    asOf: now.toISOString(),
    scope: "all-history-aggregate-counts-only",
    aggregates: [...buckets.values()].sort((a, b) =>
      `${a.entity}|${a.currency}`.localeCompare(`${b.entity}|${b.currency}`),
    ),
  };
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === "audit-remediation-history.ts"
) {
  auditRemediationHistory(process.env.DATABASE_URL || "")
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      const code = String(error?.code || error?.message || "");
      console.error(
        JSON.stringify({
          readOnly: true,
          ok: false,
          code: /^[A-Z][A-Z0-9_]{0,90}$/.test(code)
            ? code
            : "AGGREGATE_INVENTORY_FAILED",
        }),
      );
      process.exitCode = 1;
    });
}
