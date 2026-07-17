import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260718000000_crm_domain_architecture_v4",
  "migration.sql"
);

const v4Tables = [
  "portfolio_crm_companies",
  "portfolio_crm_company_contacts",
  "portfolio_crm_prospects",
  "portfolio_crm_opportunities",
  "portfolio_crm_next_actions",
  "portfolio_crm_events"
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const legacy = await legacySnapshot();
  const existing = await existingTables();
  const expectedOpportunities = await prisma.crmLead.count({
    where: {
      status: {
        in: ["brief_received", "offer_preparation", "offer_sent", "in_negotiation", "contracting", "won", "account_management", "lost"]
      }
    }
  });

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    migration: path.relative(process.cwd(), migrationPath),
    existingV4Tables: existing,
    legacy,
    expected: {
      companies: legacy.leads,
      prospects: legacy.leads,
      opportunities: expectedOpportunities,
      contacts: legacy.contacts,
      minimumEvents: legacy.leads + legacy.activities
    }
  }, null, 2));

  if (!apply) {
    console.log("Dry-run complet. Pentru aplicare controlata foloseste CRM_DOMAIN_V4_APPLY=YES si --apply.");
    return;
  }
  if (process.env.CRM_DOMAIN_V4_APPLY !== "YES") {
    throw new Error("Aplicarea necesita CRM_DOMAIN_V4_APPLY=YES.");
  }

  const collation = await databaseCollation();
  const sql = fs.readFileSync(migrationPath, "utf8")
    .replace(/COLLATE\s+utf8mb4_[a-z0-9_]+/gi, `COLLATE ${collation}`);
  const statements = sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const after = await v4Snapshot();
  const validation = {
    companiesComplete: after.companies >= legacy.leads,
    prospectsComplete: after.prospects >= legacy.leads && after.migratedProspects === legacy.leads,
    opportunitiesComplete: after.opportunities >= expectedOpportunities && after.migratedOpportunities === expectedOpportunities,
    contactsComplete: after.contacts >= legacy.contacts,
    eventsComplete: after.events >= legacy.leads + legacy.activities,
    legacyUnchanged: JSON.stringify(await legacySnapshot()) === JSON.stringify(legacy)
  };
  console.log(JSON.stringify({ after, validation }, null, 2));
  if (Object.values(validation).some((value) => !value)) {
    throw new Error("Verificarea migrarii CRM v4 nu a trecut integral.");
  }
}

async function databaseCollation() {
  const rows = await prisma.$queryRawUnsafe<Array<{ collationName: string }>>(
    "SELECT DEFAULT_COLLATION_NAME collationName FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()"
  );
  const collation = rows[0]?.collationName;
  if (!collation || !/^utf8mb4_[a-z0-9_]+$/i.test(collation)) {
    throw new Error("Collation-ul bazei nu a putut fi validat.");
  }
  return collation;
}

async function existingTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${v4Tables.map(() => "?").join(",")})`,
    ...v4Tables
  );
  return rows.map((row) => row.TABLE_NAME).sort();
}

async function legacySnapshot() {
  const [leads, contacts, activities, leadDigest] = await Promise.all([
    prisma.crmLead.count(),
    prisma.crmContact.count(),
    prisma.crmActivity.count(),
    prisma.crmLead.findMany({
      select: { id: true, status: true, companyName: true, estimatedValue: true, currency: true, createdAt: true, updatedAt: true },
      orderBy: { id: "asc" }
    })
  ]);
  return {
    leads,
    contacts,
    activities,
    digest: leadDigest.map((lead) => ({
      ...lead,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString()
    }))
  };
}

async function v4Snapshot() {
  const [companies, contacts, prospects, opportunities, nextActions, events, migratedProspects, migratedOpportunities] = await Promise.all([
    prisma.crmCompany.count(),
    prisma.crmCompanyContact.count(),
    prisma.crmProspect.count(),
    prisma.crmOpportunity.count(),
    prisma.crmNextAction.count(),
    prisma.crmEvent.count(),
    prisma.crmProspect.count({ where: { legacyLeadId: { not: null } } }),
    prisma.crmOpportunity.count({ where: { legacyLeadId: { not: null } } })
  ]);
  return { companies, contacts, prospects, opportunities, nextActions, events, migratedProspects, migratedOpportunities };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
