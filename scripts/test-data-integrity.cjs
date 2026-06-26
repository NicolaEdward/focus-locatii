const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    const contents = fs.readFileSync(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function looksLikeCampaignClient(value) {
  return /\b(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|vara|iarna|campanie|dn\d|20\d{2})\b|\s-\s/i.test(value || "");
}

async function main() {
  loadLocalEnv();
  const prisma = new PrismaClient();
  try {
    const [
      smokeClients,
      smokeReservations,
      clients,
      activeCampaigns,
      invalidActiveRentals,
      invalidActiveCampaigns,
      activeSupplierInvoicesWithoutSupplier,
      documentCollations,
      sampleClient,
      activeLegacyReservations,
      activeBillingItems,
      activeGeneratedReceivables
    ] = await Promise.all([
      prisma.clientAccount.count({
        where: {
          OR: [
            { companyName: { contains: "Smoke" } },
            { normalizedName: { contains: "smoke" } },
            { generalEmail: { contains: "smoke" } }
          ]
        }
      }),
      prisma.reservation.count({
        where: {
          OR: [
            { clientName: { contains: "Smoke" } },
            { clientCompany: { contains: "Smoke" } },
            { campaignName: { contains: "Smoke" } },
            { contractCompany: { contains: "Smoke" } },
            { contractNumber: { contains: "SMOKE" } }
          ]
        }
      }),
      prisma.clientAccount.findMany({
        where: { status: { notIn: ["archived", "merged"] } },
        select: { id: true, companyName: true, normalizedName: true, status: true },
        orderBy: [{ normalizedName: "asc" }]
      }),
      prisma.campaign.count({ where: { status: { not: "archived" }, archivedAt: null } }),
      prisma.reservation.count({
        where: {
          status: "BOOKED",
          OR: [{ clientId: null }, { campaignId: null }]
        }
      }),
      prisma.campaign.count({
        where: {
          status: { not: "archived" },
          archivedAt: null,
          clientId: ""
        }
      }),
      prisma.financialPayable.count({
        where: {
          includedInReport: true,
          status: { notIn: ["paid", "cancelled", "archived", "excluded"] },
          supplierId: null
        }
      }),
      prisma.$queryRaw`
        SELECT COLUMN_NAME as columnName, COLLATION_NAME as collationName
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'portfolio_client_documents'
          AND DATA_TYPE IN ('varchar','text','longtext')
      `,
      prisma.clientAccount.findFirst({
        where: { status: { notIn: ["merged", "archived"] } },
        include: { documents: true, accountOwner: { select: { id: true, name: true } } }
      }),
      prisma.reservation.count({
        where: {
          status: { in: ["HOLD", "RESERVED", "BOOKED"] },
          OR: [
            { externalSource: "legacy-rezervari" },
            { externalSource: { startsWith: "legacy_archived_" } }
          ]
        }
      }),
      prisma.billingItem.count({
        where: { status: { not: "archived" } }
      }),
      prisma.financialReceivable.count({
        where: {
          billingItemId: { not: null },
          includedInReport: true
        }
      })
    ]);

    assert(smokeClients === 0, `Au ramas clienti Smoke in baza: ${smokeClients}`);
    assert(smokeReservations === 0, `Au ramas rezervari Smoke in baza: ${smokeReservations}`);
    assert(sampleClient !== undefined || clients.length === 0, "Query-ul client + documente nu a putut fi validat.");
    assert(activeLegacyReservations === 0, `Exista rezervari legacy active: ${activeLegacyReservations}`);
    assert(invalidActiveRentals === 0, `Exista inchirieri active fara clientId/campaignId: ${invalidActiveRentals}`);
    assert(invalidActiveCampaigns === 0, `Exista campanii active fara clientId valid: ${invalidActiveCampaigns}`);
    assert(activeSupplierInvoicesWithoutSupplier === 0, `Exista facturi furnizor active fara supplierId: ${activeSupplierInvoicesWithoutSupplier}`);
    assert(activeBillingItems === 0, `Exista BillingItems active desi financiarul trebuie sa fie manual: ${activeBillingItems}`);
    assert(activeGeneratedReceivables === 0, `Exista incasari active legate de BillingItems legacy: ${activeGeneratedReceivables}`);

    const groups = new Map();
    for (const client of clients) {
      if (!client.normalizedName) continue;
      groups.set(client.normalizedName, [...(groups.get(client.normalizedName) || []), client]);
    }
    const duplicateGroups = Array.from(groups.entries()).filter(([, rows]) => rows.length > 1);
    assert(duplicateGroups.length === 0, `Exista grupuri de clienti activi duplicati: ${duplicateGroups.map(([key]) => key).join(", ")}`);

    const badDocumentCollations = documentCollations.filter((row) => row.collationName !== "utf8mb4_0900_ai_ci");
    assert(badDocumentCollations.length === 0, `Tabela documentelor are collation diferit: ${badDocumentCollations.map((row) => `${row.columnName}:${row.collationName}`).join(", ")}`);

    const campaignLikeClients = clients.filter((client) => looksLikeCampaignClient(client.companyName));
    const billingItems = await prisma.billingItem.count();

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "fara date Smoke vizibile",
        "fara clienti activi duplicati dupa normalizedName",
        "clientii se pot incarca impreuna cu documentele",
        "collation documente aliniat cu restul bazei",
        "fara rezervari legacy active",
        "fara inchirieri active fara clientId/campaignId",
        "fara campanii active fara clientId",
        "fara facturi furnizor active fara supplierId",
        "fara BillingItems active generate automat",
        "fara incasari active legate de BillingItems legacy"
      ],
      clients: clients.length,
      campaigns: activeCampaigns,
      campaignLikeClients: campaignLikeClients.map((client) => client.companyName),
      legacyBillingItems: billingItems
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
