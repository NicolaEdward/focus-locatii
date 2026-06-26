import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await addColumn("portfolio_client_accounts", "registryNumber", "`registryNumber` VARCHAR(191) NULL");
  await addColumn("portfolio_client_accounts", "website", "`website` VARCHAR(191) NULL");
  await addColumn("portfolio_client_accounts", "mergedIntoClientId", "`mergedIntoClientId` VARCHAR(191) NULL");
  await addColumn("portfolio_client_accounts", "mergedAt", "`mergedAt` DATETIME(3) NULL");
  await addColumn("portfolio_client_accounts", "aliases", "`aliases` JSON NULL");
  await addIndex("portfolio_client_accounts", "portfolio_client_accounts_mergedIntoClientId_idx", "`mergedIntoClientId`");

  await addColumn("portfolio_financial_receivables", "normalizedInvoiceNumber", "`normalizedInvoiceNumber` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_receivables", "collectedAt", "`collectedAt` DATETIME(3) NULL");
  await addColumn("portfolio_financial_receivables", "paymentMethod", "`paymentMethod` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_receivables", "collectionNotes", "`collectionNotes` TEXT NULL");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_normalizedInvoiceNumber_idx", "`normalizedInvoiceNumber`");

  await addColumn("portfolio_billing_items", "normalizedInvoiceNumber", "`normalizedInvoiceNumber` VARCHAR(191) NULL");
  await addColumn("portfolio_billing_items", "collectedAmount", "`collectedAmount` DECIMAL(14,2) NOT NULL DEFAULT 0");
  await addColumn("portfolio_billing_items", "remainingAmount", "`remainingAmount` DECIMAL(14,2) NULL");
  await addColumn("portfolio_billing_items", "collectedAt", "`collectedAt` DATETIME(3) NULL");
  await addColumn("portfolio_billing_items", "paymentMethod", "`paymentMethod` VARCHAR(191) NULL");
  await addColumn("portfolio_billing_items", "collectionNotes", "`collectionNotes` TEXT NULL");
  await addIndex("portfolio_billing_items", "portfolio_billing_items_normalizedInvoiceNumber_idx", "`normalizedInvoiceNumber`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_client_documents\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`clientId\` VARCHAR(191) NULL,
      \`reservationId\` VARCHAR(191) NULL,
      \`billingItemId\` VARCHAR(191) NULL,
      \`financialReceivableId\` VARCHAR(191) NULL,
      \`fileName\` VARCHAR(191) NOT NULL,
      \`fileType\` VARCHAR(191) NULL,
      \`fileSize\` INTEGER NULL,
      \`documentType\` VARCHAR(191) NOT NULL DEFAULT 'other',
      \`uploadedByUserId\` VARCHAR(191) NULL,
      \`uploadedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`expiryDate\` DATETIME(3) NULL,
      \`notes\` TEXT NULL,
      \`storageUrl\` LONGTEXT NOT NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'active',
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await ensureTableCollation("portfolio_client_documents", "utf8mb4_0900_ai_ci");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_clientId_idx", "`clientId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_reservationId_idx", "`reservationId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_billingItemId_idx", "`billingItemId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_financialReceivableId_idx", "`financialReceivableId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_documentType_idx", "`documentType`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_status_idx", "`status`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_uploadedByUserId_idx", "`uploadedByUserId`");

  console.log("Client/campaign/invoice schema applied safely.");
}

async function addColumn(tableName: string, columnName: string, definition: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    tableName,
    columnName
  );
  if (Number(rows[0]?.count || 0) > 0) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
}

async function addIndex(tableName: string, indexName: string, columns: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) as count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    tableName,
    indexName
  );
  if (Number(rows[0]?.count || 0) > 0) return;
  await prisma.$executeRawUnsafe(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columns})`);
}

async function ensureTableCollation(tableName: string, collation: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT COUNT(*) as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_COLLATION <> ?",
    tableName,
    collation
  );
  if (Number(rows[0]?.count || 0) === 0) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${tableName}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${collation}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
