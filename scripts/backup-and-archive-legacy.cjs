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

function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    return item;
  }, 2);
}

async function tableCount(prisma, modelName) {
  return prisma[modelName].count();
}

async function backupModel({ prisma, backupDir, fileName, modelName, query = {} }) {
  const rows = await prisma[modelName].findMany(query);
  fs.writeFileSync(path.join(backupDir, `${fileName}.json`), jsonSafe(rows));
  return rows.length;
}

async function main() {
  loadLocalEnv();
  const apply = process.argv.includes("--apply");
  if (apply) {
    throw new Error("Resetul legacy cu scrieri a fost retras. Scriptul poate fi folosit numai pentru audit read-only.");
  }
  const prisma = new PrismaClient();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(process.cwd(), "backups", `legacy-reset-${runId}`);

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const countsBefore = {
      locations: await tableCount(prisma, "location"),
      clients: await tableCount(prisma, "clientAccount"),
      contacts: await tableCount(prisma, "clientContact"),
      reservations: await tableCount(prisma, "reservation"),
      billingItems: await tableCount(prisma, "billingItem"),
      financialReceivables: await tableCount(prisma, "financialReceivable"),
      financialPayables: await tableCount(prisma, "financialPayable"),
      documents: await tableCount(prisma, "clientDocument"),
      notifications: await tableCount(prisma, "appNotification"),
      offerRequests: await tableCount(prisma, "offerRequest"),
      crmLeads: await tableCount(prisma, "crmLead"),
      users: await tableCount(prisma, "user")
    };

    const backupCounts = {};
    backupCounts.locations = await backupModel({ prisma, backupDir, fileName: "locations", modelName: "location", query: { include: { images: true } } });
    backupCounts.clients = await backupModel({ prisma, backupDir, fileName: "client-accounts", modelName: "clientAccount", query: { include: { contacts: true, documents: true } } });
    backupCounts.reservations = await backupModel({ prisma, backupDir, fileName: "reservations", modelName: "reservation", query: { include: { documents: true, billingItems: true } } });
    backupCounts.billingItems = await backupModel({ prisma, backupDir, fileName: "billing-items", modelName: "billingItem" });
    backupCounts.financialUploads = await backupModel({ prisma, backupDir, fileName: "financial-report-uploads", modelName: "financialReportUpload", query: { include: { companySnapshots: true, issues: true } } });
    backupCounts.financialReceivables = await backupModel({ prisma, backupDir, fileName: "financial-receivables", modelName: "financialReceivable" });
    backupCounts.financialPayables = await backupModel({ prisma, backupDir, fileName: "financial-payables", modelName: "financialPayable" });
    backupCounts.documents = await backupModel({ prisma, backupDir, fileName: "documents", modelName: "clientDocument" });
    backupCounts.notifications = await backupModel({ prisma, backupDir, fileName: "notifications", modelName: "appNotification" });
    backupCounts.offerRequests = await backupModel({ prisma, backupDir, fileName: "offer-requests", modelName: "offerRequest" });
    backupCounts.crmLeads = await backupModel({ prisma, backupDir, fileName: "crm-leads", modelName: "crmLead", query: { include: { contacts: true, activities: true } } });
    backupCounts.auditLogs = await backupModel({ prisma, backupDir, fileName: "audit-logs", modelName: "auditLog" });
    backupCounts.users = await backupModel({ prisma, backupDir, fileName: "users", modelName: "user", query: { select: { id: true, email: true, name: true, role: true, active: true, tokenVersion: true, lastLoginAt: true, createdAt: true, updatedAt: true } } });

    fs.writeFileSync(path.join(backupDir, "manifest.json"), jsonSafe({
      runId,
      createdAt: new Date().toISOString(),
      mode: apply ? "apply" : "dry-run",
      countsBefore,
      backupCounts,
      preserved: [
        "locations",
        "location codes",
        "photos/images",
        "GPS coordinates",
        "location costs",
        "location order fields",
        "users",
        "roles",
        "public listing",
        "shortlist/export public",
        "manual financial rows not linked to legacy billing items"
      ]
    }));

    if (!apply) {
      console.log(JSON.stringify({ ok: true, dryRun: true, backupDir, countsBefore, backupCounts }, null, 2));
      return;
    }

    const legacySource = `legacy_archived_${runId}`;
    const result = await prisma.$transaction(async (tx) => {
      const archivedReservations = await tx.reservation.updateMany({
        where: {
          OR: [
            { externalSource: null },
            { externalSource: { not: legacySource } }
          ]
        },
        data: {
          status: "CANCELLED",
          holdExpiresAt: null,
          externalSource: legacySource
        }
      });

      const archivedClients = await tx.clientAccount.updateMany({
        where: { status: { notIn: ["archived", "merged"] } },
        data: { status: "archived" }
      });

      const archivedCampaigns = await tx.campaign.updateMany({
        where: {
          OR: [
            { archivedAt: null },
            { status: { not: "archived" } }
          ]
        },
        data: {
          status: "archived",
          archivedAt: new Date()
        }
      });

      const archivedBillingItems = await tx.billingItem.updateMany({
        where: { status: { not: "archived" } },
        data: { status: "archived" }
      });

      const archivedGeneratedReceivables = await tx.financialReceivable.updateMany({
        where: { billingItemId: { not: null } },
        data: {
          billingItemId: null,
          includedInReport: false,
          status: "archived",
          reviewNote: "Arhivat la resetul legacy; financiarul activ se introduce manual."
        }
      });

      const archivedLegacyReceivables = await tx.financialReceivable.updateMany({
        where: {
          OR: [
            { includedInReport: true },
            { status: { not: "archived" } }
          ]
        },
        data: {
          billingItemId: null,
          includedInReport: false,
          status: "archived",
          reviewNote: "Arhivat la resetul final OOH; facturile client active se introduc manual si se leaga de client real."
        }
      });

      const archivedLegacyPayables = await tx.financialPayable.updateMany({
        where: {
          OR: [
            { includedInReport: true },
            { status: { not: "archived" } }
          ]
        },
        data: {
          includedInReport: false,
          status: "archived",
          reviewNote: "Arhivat la resetul final OOH; facturile furnizor active se introduc manual si se leaga de furnizor real."
        }
      });

      const archivedFinancialUploads = await tx.financialReportUpload.updateMany({
        where: {
          OR: [
            { activeVersion: true },
            { status: { notIn: ["archived", "rejected"] } }
          ]
        },
        data: {
          activeVersion: false,
          status: "archived",
          errorSummary: "Arhivat la resetul final OOH; financiarul activ se introduce manual."
        }
      });

      const archivedDocuments = await tx.clientDocument.updateMany({
        where: {
          status: "active",
          OR: [
            { clientId: { not: null } },
            { campaignId: { not: null } },
            { reservationId: { not: null } },
            { billingItemId: { not: null } }
          ]
        },
        data: { status: "archived" }
      });

      const archivedNotifications = await tx.appNotification.updateMany({
        where: {
          status: { in: ["open", "in_progress"] },
          OR: [
            { entityType: { in: ["reservation", "billing_item", "client_account", "campaign"] } },
            { type: { in: ["invoice_overdue", "invoice_due_today", "invoice_due_soon"] } }
          ]
        },
        data: { status: "archived", resolvedAt: new Date() }
      });

      const resetLocationAvailability = await tx.location.updateMany({
        data: {
          status: "AVAILABLE",
          availabilityText: "Disponibil",
          availableFrom: null,
          availableUntil: null,
          bookedFrom: null,
          bookedUntil: null
        }
      });

      await tx.auditLog.create({
        data: {
          action: "legacy.archive_reset",
          entityType: "system",
          entityId: runId,
          metadata: {
            backupDir,
            archivedReservations: archivedReservations.count,
            archivedClients: archivedClients.count,
            archivedCampaigns: archivedCampaigns.count,
            archivedBillingItems: archivedBillingItems.count,
            archivedGeneratedReceivables: archivedGeneratedReceivables.count,
            archivedLegacyReceivables: archivedLegacyReceivables.count,
            archivedLegacyPayables: archivedLegacyPayables.count,
            archivedFinancialUploads: archivedFinancialUploads.count,
            archivedDocuments: archivedDocuments.count,
            archivedNotifications: archivedNotifications.count,
            resetLocationAvailability: resetLocationAvailability.count
          }
        }
      });

      return {
        archivedReservations: archivedReservations.count,
        archivedClients: archivedClients.count,
        archivedCampaigns: archivedCampaigns.count,
        archivedBillingItems: archivedBillingItems.count,
        archivedGeneratedReceivables: archivedGeneratedReceivables.count,
        archivedLegacyReceivables: archivedLegacyReceivables.count,
        archivedLegacyPayables: archivedLegacyPayables.count,
        archivedFinancialUploads: archivedFinancialUploads.count,
        archivedDocuments: archivedDocuments.count,
        archivedNotifications: archivedNotifications.count,
        resetLocationAvailability: resetLocationAvailability.count
      };
    });

    const activeAfter = {
      activeClients: await prisma.clientAccount.count({ where: { status: { notIn: ["archived", "merged"] } } }),
      activeCampaigns: await prisma.campaign.count({ where: { archivedAt: null, status: { not: "archived" } } }),
      activeReservations: await prisma.reservation.count({ where: { status: { in: ["HOLD", "RESERVED", "BOOKED"] } } }),
      activeBillingItems: await prisma.billingItem.count({ where: { status: { not: "archived" } } }),
      activeGeneratedReceivables: await prisma.financialReceivable.count({ where: { billingItemId: { not: null }, includedInReport: true } }),
      activeManualReceivables: await prisma.financialReceivable.count({ where: { includedInReport: true, status: { not: "archived" } } }),
      activeManualPayables: await prisma.financialPayable.count({ where: { includedInReport: true, status: { not: "archived" } } }),
      publicLocations: await prisma.location.count({ where: { showInPublic: true } })
    };

    fs.writeFileSync(path.join(backupDir, "result.json"), jsonSafe({ runId, result, activeAfter }));
    console.log(JSON.stringify({ ok: true, backupDir, result, activeAfter }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
