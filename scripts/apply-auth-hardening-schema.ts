import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

const migrationPath = path.join(process.cwd(), "prisma", "migrations", "20260721090000_auth_abuse_hardening", "migration.sql");
const tables = [
  "portfolio_auth_mfa_credentials",
  "portfolio_auth_recovery_codes",
  "portfolio_auth_action_tokens",
  "portfolio_auth_sessions",
  "portfolio_security_rate_limits"
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const [activeSuperAdmins, existing] = await Promise.all([
    prisma.user.count({ where: { role: "SUPER_ADMIN", active: true } }),
    existingTables()
  ]);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", migration: path.relative(process.cwd(), migrationPath), activeSuperAdmins, existingTables: existing }, null, 2));
  const isolatedPreview = process.env.APP_ENV === "preview" && process.env.ALLOW_SYNTHETIC_SEED === "true";
  if (activeSuperAdmins < 1 && !isolatedPreview) throw new Error("Schema de securitate nu poate fi aplicata fara un SUPER_ADMIN activ.");
  if (!apply) return;
  if (process.env.AUTH_HARDENING_APPLY !== "YES") throw new Error("Aplicarea necesita AUTH_HARDENING_APPLY=YES.");
  if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_AUTH_SCHEMA_APPLY !== "YES") {
    throw new Error("Productia necesita aprobarea explicita ALLOW_PRODUCTION_AUTH_SCHEMA_APPLY=YES.");
  }

  const collation = await databaseCollation();
  const sql = fs.readFileSync(migrationPath, "utf8")
    .replace(/CREATE TABLE `/g, "CREATE TABLE IF NOT EXISTS `")
    .replace(/COLLATE\s+utf8mb4_[a-z0-9_]+/gi, `COLLATE ${collation}`);
  for (const statement of sql.replace(/^\s*--.*$/gm, "").split(";").map((value) => value.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
  const after = await existingTables();
  const missing = tables.filter((table) => !after.includes(table));
  console.log(JSON.stringify({ appliedTables: after, missing }, null, 2));
  if (missing.length) throw new Error(`Lipsesc tabelele: ${missing.join(", ")}`);
}

async function existingTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`,
    ...tables
  );
  return rows.map((row) => row.TABLE_NAME).sort();
}

async function databaseCollation() {
  const rows = await prisma.$queryRawUnsafe<Array<{ collationName: string }>>("SELECT DEFAULT_COLLATION_NAME collationName FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()");
  const collation = rows[0]?.collationName;
  if (!collation || !/^utf8mb4_[a-z0-9_]+$/i.test(collation)) throw new Error("Collation-ul bazei nu a putut fi validat.");
  return collation;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
