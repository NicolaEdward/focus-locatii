import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await addColumn("portfolio_client_accounts", "clientType", "`clientType` VARCHAR(191) NOT NULL DEFAULT 'direct_client'");
  await addIndex("portfolio_client_accounts", "portfolio_client_accounts_clientType_idx", "`clientType`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_campaigns\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`clientId\` VARCHAR(191) NOT NULL,
      \`campaignName\` VARCHAR(191) NOT NULL,
      \`campaignCode\` VARCHAR(191) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'draft',
      \`campaignType\` VARCHAR(191) NOT NULL DEFAULT 'direct_client',
      \`agencyClientId\` VARCHAR(191) NULL,
      \`endClientId\` VARCHAR(191) NULL,
      \`accountOwnerUserId\` VARCHAR(191) NULL,
      \`sellerUserId\` VARCHAR(191) NULL,
      \`createdByUserId\` VARCHAR(191) NULL,
      \`companyEntity\` VARCHAR(191) NULL,
      \`startDate\` DATETIME(3) NULL,
      \`endDate\` DATETIME(3) NULL,
      \`currency\` VARCHAR(3) NULL,
      \`totalContractValue\` DECIMAL(14,2) NULL,
      \`paymentTermType\` VARCHAR(191) NULL,
      \`paymentTermDays\` INTEGER NULL,
      \`customPaymentTermNote\` TEXT NULL,
      \`billingRule\` VARCHAR(191) NULL,
      \`billingFrequency\` VARCHAR(191) NULL,
      \`billingNotes\` TEXT NULL,
      \`notes\` TEXT NULL,
      \`archivedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await addIndex("portfolio_campaigns", "portfolio_campaigns_clientId_idx", "`clientId`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_status_idx", "`status`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_archivedAt_idx", "`archivedAt`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_accountOwnerUserId_idx", "`accountOwnerUserId`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_sellerUserId_idx", "`sellerUserId`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_createdByUserId_idx", "`createdByUserId`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_companyEntity_idx", "`companyEntity`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_startDate_idx", "`startDate`");
  await addIndex("portfolio_campaigns", "portfolio_campaigns_endDate_idx", "`endDate`");

  await addColumn("portfolio_reservations", "campaignId", "`campaignId` VARCHAR(191) NULL");
  await addIndex("portfolio_reservations", "portfolio_reservations_campaignId_idx", "`campaignId`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_rental_price_segments\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`rentalId\` VARCHAR(191) NOT NULL,
      \`effectiveFrom\` DATETIME(3) NOT NULL,
      \`effectiveTo\` DATETIME(3) NULL,
      \`monthlyRent\` DECIMAL(14,2) NOT NULL,
      \`currency\` VARCHAR(3) NOT NULL,
      \`reason\` TEXT NULL,
      \`createdByUserId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await addIndex("portfolio_rental_price_segments", "portfolio_rental_price_segments_rentalId_idx", "`rentalId`");
  await addIndex("portfolio_rental_price_segments", "portfolio_rental_price_segments_effectiveFrom_idx", "`effectiveFrom`");
  await addIndex("portfolio_rental_price_segments", "portfolio_rental_price_segments_effectiveTo_idx", "`effectiveTo`");
  await addIndex("portfolio_rental_price_segments", "portfolio_rental_price_segments_createdByUserId_idx", "`createdByUserId`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_rental_change_logs\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`rentalId\` VARCHAR(191) NOT NULL,
      \`action\` VARCHAR(191) NOT NULL,
      \`previousJson\` JSON NULL,
      \`nextJson\` JSON NULL,
      \`note\` TEXT NULL,
      \`createdByUserId\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await addIndex("portfolio_rental_change_logs", "portfolio_rental_change_logs_rentalId_idx", "`rentalId`");
  await addIndex("portfolio_rental_change_logs", "portfolio_rental_change_logs_action_idx", "`action`");
  await addIndex("portfolio_rental_change_logs", "portfolio_rental_change_logs_createdByUserId_idx", "`createdByUserId`");
  await addIndex("portfolio_rental_change_logs", "portfolio_rental_change_logs_createdAt_idx", "`createdAt`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_suppliers\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`supplierName\` VARCHAR(191) NOT NULL,
      \`normalizedName\` VARCHAR(191) NULL,
      \`taxId\` VARCHAR(191) NULL,
      \`registryNumber\` VARCHAR(191) NULL,
      \`billingAddress\` TEXT NULL,
      \`generalEmail\` VARCHAR(191) NULL,
      \`generalPhone\` VARCHAR(191) NULL,
      \`website\` VARCHAR(191) NULL,
      \`status\` VARCHAR(191) NOT NULL DEFAULT 'active',
      \`notes\` TEXT NULL,
      \`createdByUserId\` VARCHAR(191) NULL,
      \`archivedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await addIndex("portfolio_suppliers", "portfolio_suppliers_normalizedName_idx", "`normalizedName`");
  await addIndex("portfolio_suppliers", "portfolio_suppliers_status_idx", "`status`");
  await addIndex("portfolio_suppliers", "portfolio_suppliers_createdByUserId_idx", "`createdByUserId`");
  await addIndex("portfolio_suppliers", "portfolio_suppliers_archivedAt_idx", "`archivedAt`");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`portfolio_supplier_contacts\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`supplierId\` VARCHAR(191) NOT NULL,
      \`name\` VARCHAR(191) NOT NULL,
      \`email\` VARCHAR(191) NULL,
      \`phone\` VARCHAR(191) NULL,
      \`role\` VARCHAR(191) NULL,
      \`isPrimary\` BOOLEAN NOT NULL DEFAULT false,
      \`notes\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await addIndex("portfolio_supplier_contacts", "portfolio_supplier_contacts_supplierId_idx", "`supplierId`");
  await addIndex("portfolio_supplier_contacts", "portfolio_supplier_contacts_email_idx", "`email`");

  await addColumn("portfolio_financial_payables", "supplierId", "`supplierId` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_payables", "invoiceNumber", "`invoiceNumber` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_payables", "normalizedInvoiceNumber", "`normalizedInvoiceNumber` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_payables", "invoiceDate", "`invoiceDate` DATETIME(3) NULL");
  await addColumn("portfolio_financial_payables", "paidAt", "`paidAt` DATETIME(3) NULL");
  await addColumn("portfolio_financial_payables", "paymentMethod", "`paymentMethod` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_payables", "paymentNotes", "`paymentNotes` TEXT NULL");
  await addIndex("portfolio_financial_payables", "portfolio_financial_payables_supplierId_idx", "`supplierId`");
  await addIndex("portfolio_financial_payables", "portfolio_financial_payables_normalizedInvoiceNumber_idx", "`normalizedInvoiceNumber`");
  await addIndex("portfolio_financial_payables", "portfolio_financial_payables_invoiceDate_idx", "`invoiceDate`");

  await addColumn("portfolio_financial_receivables", "campaignId", "`campaignId` VARCHAR(191) NULL");
  await addColumn("portfolio_financial_receivables", "invoiceDate", "`invoiceDate` DATETIME(3) NULL");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_campaignId_idx", "`campaignId`");
  await addIndex("portfolio_financial_receivables", "portfolio_financial_receivables_invoiceDate_idx", "`invoiceDate`");

  await addColumn("portfolio_client_documents", "campaignId", "`campaignId` VARCHAR(191) NULL");
  await addColumn("portfolio_client_documents", "supplierId", "`supplierId` VARCHAR(191) NULL");
  await addColumn("portfolio_client_documents", "financialPayableId", "`financialPayableId` VARCHAR(191) NULL");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_campaignId_idx", "`campaignId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_supplierId_idx", "`supplierId`");
  await addIndex("portfolio_client_documents", "portfolio_client_documents_financialPayableId_idx", "`financialPayableId`");

  console.log("OOH operational architecture schema applied safely.");
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
