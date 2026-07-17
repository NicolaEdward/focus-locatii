-- Additive financial receivables import/reconciliation foundation.
-- Existing receivables and reports are preserved unchanged.

ALTER TABLE `portfolio_financial_receivables`
  ADD COLUMN `canonicalKey` VARCHAR(191) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  ADD COLUMN `lastReportDate` DATETIME(3) NULL,
  ADD COLUMN `lastImportedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `portfolio_financial_receivables_canonicalKey_key`
  ON `portfolio_financial_receivables`(`canonicalKey`);
CREATE INDEX `portfolio_financial_receivables_company_invoice_currency_idx`
  ON `portfolio_financial_receivables`(`companyCode`, `normalizedInvoiceNumber`, `currency`);
CREATE INDEX `portfolio_financial_receivables_client_dueDate_idx`
  ON `portfolio_financial_receivables`(`clientId`, `dueDate`);

CREATE TABLE `portfolio_financial_receivable_import_rows` (
  `id` VARCHAR(191) NOT NULL,
  `uploadId` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NULL,
  `clientId` VARCHAR(191) NULL,
  `campaignId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NULL,
  `companyName` VARCHAR(191) NOT NULL,
  `companyCode` VARCHAR(191) NOT NULL,
  `sheetName` VARCHAR(191) NOT NULL,
  `rowNumber` INTEGER NOT NULL,
  `sourceRowKey` VARCHAR(191) NOT NULL,
  `sourceHash` VARCHAR(191) NOT NULL,
  `rawInvoiceNumber` VARCHAR(191) NULL,
  `normalizedInvoiceNumber` VARCHAR(191) NULL,
  `invoiceDate` DATETIME(3) NULL,
  `dueDate` DATETIME(3) NULL,
  `currency` VARCHAR(3) NULL,
  `invoiceAmount` DECIMAL(14,2) NULL,
  `reportCollectedAmount` DECIMAL(14,2) NULL,
  `reportRemainingAmount` DECIMAL(14,2) NULL,
  `locationText` TEXT NULL,
  `campaignDetails` TEXT NULL,
  `clientNameRaw` VARCHAR(191) NULL,
  `normalizedClientName` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `confidenceLevel` VARCHAR(191) NOT NULL DEFAULT 'unmatched',
  `confidenceScore` INTEGER NOT NULL DEFAULT 0,
  `matchReason` TEXT NULL,
  `proposedAction` VARCHAR(191) NULL,
  `resolutionAction` VARCHAR(191) NULL,
  `resolutionReason` TEXT NULL,
  `resolvedByUserId` VARCHAR(191) NULL,
  `resolvedAt` DATETIME(3) NULL,
  `rawRowJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `portfolio_financial_receivable_import_rows_upload_row_key` (`uploadId`, `sourceRowKey`),
  INDEX `portfolio_financial_receivable_import_rows_upload_status_idx` (`uploadId`, `status`),
  INDEX `portfolio_financial_receivable_import_rows_sourceHash_idx` (`sourceHash`),
  INDEX `portfolio_financial_receivable_import_rows_invoice_idx` (`companyCode`, `normalizedInvoiceNumber`, `currency`),
  INDEX `portfolio_financial_receivable_import_rows_clientId_idx` (`clientId`),
  INDEX `portfolio_financial_receivable_import_rows_receivableId_idx` (`receivableId`),
  INDEX `portfolio_financial_receivable_import_rows_confidence_idx` (`confidenceLevel`),
  CONSTRAINT `portfolio_financial_receivable_import_rows_uploadId_fkey` FOREIGN KEY (`uploadId`) REFERENCES `portfolio_financial_report_uploads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_import_rows_receivableId_fkey` FOREIGN KEY (`receivableId`) REFERENCES `portfolio_financial_receivables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_import_rows_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `portfolio_client_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_import_rows_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `portfolio_campaigns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_import_rows_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `portfolio_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_import_rows_resolvedByUserId_fkey` FOREIGN KEY (`resolvedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_financial_receivable_payments` (
  `id` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NOT NULL,
  `sourceImportRowId` VARCHAR(191) NULL,
  `requestKey` VARCHAR(191) NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL,
  `paymentMethod` VARCHAR(191) NULL,
  `paymentReference` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `correctsPaymentId` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `cancelledByUserId` VARCHAR(191) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `cancellationReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `portfolio_financial_receivable_payments_sourceImportRowId_key` (`sourceImportRowId`),
  UNIQUE INDEX `portfolio_financial_receivable_payments_requestKey_key` (`requestKey`),
  INDEX `portfolio_financial_receivable_payments_receivable_idx` (`receivableId`, `status`, `receivedAt`),
  INDEX `portfolio_financial_receivable_payments_sourceRow_idx` (`sourceImportRowId`),
  INDEX `portfolio_financial_receivable_payments_createdBy_idx` (`createdByUserId`),
  INDEX `portfolio_financial_receivable_payments_corrects_idx` (`correctsPaymentId`),
  CONSTRAINT `portfolio_financial_receivable_payments_receivableId_fkey` FOREIGN KEY (`receivableId`) REFERENCES `portfolio_financial_receivables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_payments_sourceImportRowId_fkey` FOREIGN KEY (`sourceImportRowId`) REFERENCES `portfolio_financial_receivable_import_rows`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_payments_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_payments_cancelledByUserId_fkey` FOREIGN KEY (`cancelledByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_receivable_payments_correctsPaymentId_fkey` FOREIGN KEY (`correctsPaymentId`) REFERENCES `portfolio_financial_receivable_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_financial_client_aliases` (
  `id` VARCHAR(191) NOT NULL,
  `companyCode` VARCHAR(191) NOT NULL,
  `aliasName` VARCHAR(191) NOT NULL,
  `normalizedAlias` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `portfolio_financial_client_aliases_company_alias_key` (`companyCode`, `normalizedAlias`),
  INDEX `portfolio_financial_client_aliases_clientId_idx` (`clientId`),
  CONSTRAINT `portfolio_financial_client_aliases_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `portfolio_client_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_client_aliases_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_financial_client_credits` (
  `id` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `receivableId` VARCHAR(191) NULL,
  `sourcePaymentId` VARCHAR(191) NULL,
  `companyName` VARCHAR(191) NOT NULL,
  `companyCode` VARCHAR(191) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `remainingAmount` DECIMAL(14,2) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'available',
  `reason` TEXT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `portfolio_financial_client_credits_sourcePaymentId_key` (`sourcePaymentId`),
  INDEX `portfolio_financial_client_credits_client_status_idx` (`clientId`, `status`),
  INDEX `portfolio_financial_client_credits_company_currency_status_idx` (`companyCode`, `currency`, `status`),
  INDEX `portfolio_financial_client_credits_receivableId_idx` (`receivableId`),
  CONSTRAINT `portfolio_financial_client_credits_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `portfolio_client_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_client_credits_receivableId_fkey` FOREIGN KEY (`receivableId`) REFERENCES `portfolio_financial_receivables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_client_credits_sourcePaymentId_fkey` FOREIGN KEY (`sourcePaymentId`) REFERENCES `portfolio_financial_receivable_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_financial_client_credits_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
