-- AlterTable
ALTER TABLE `portfolio_financial_report_uploads` ADD COLUMN `fileSize` INTEGER NULL,
    ADD COLUMN `importType` VARCHAR(191) NULL,
    ADD COLUMN `legalEntityId` VARCHAR(191) NULL,
    ADD COLUMN `parserName` VARCHAR(191) NULL,
    ADD COLUMN `parserVersion` VARCHAR(191) NULL,
    ADD COLUMN `rowsCreated` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rowsDuplicate` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rowsFailed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rowsIgnored` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rowsRead` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rowsUpdated` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `summaryJson` JSON NULL,
    ADD COLUMN `warningCount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `portfolio_financial_payables` ADD COLUMN `documentType` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    ADD COLUMN `legalEntityId` VARCHAR(191) NULL,
    ADD COLUMN `netAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `partnerId` VARCHAR(191) NULL,
    ADD COLUMN `paymentVerification` VARCHAR(191) NOT NULL DEFAULT 'none',
    ADD COLUMN `sourceExternalId` VARCHAR(191) NULL,
    ADD COLUMN `sourceFingerprint` VARCHAR(191) NULL,
    ADD COLUMN `sourceStatus` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    ADD COLUMN `vatAmount` DECIMAL(14, 2) NULL;

-- AlterTable
ALTER TABLE `portfolio_financial_receivables` ADD COLUMN `legalEntityId` VARCHAR(191) NULL,
    ADD COLUMN `netAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `partnerId` VARCHAR(191) NULL,
    ADD COLUMN `sourceExternalId` VARCHAR(191) NULL,
    ADD COLUMN `sourceFingerprint` VARCHAR(191) NULL,
    ADD COLUMN `sourceStatus` VARCHAR(191) NULL,
    ADD COLUMN `spvIndex` VARCHAR(191) NULL,
    ADD COLUMN `vatAmount` DECIMAL(14, 2) NULL;

-- AlterTable
ALTER TABLE `portfolio_financial_receivable_payments` ADD COLUMN `bankTransactionId` VARCHAR(191) NULL,
    ADD COLUMN `verificationStatus` VARCHAR(191) NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE `portfolio_financial_legal_entities` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `taxIdOriginal` VARCHAR(191) NULL,
    `taxIdNormalized` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_legal_entities_code_key`(`code`),
    UNIQUE INDEX `portfolio_financial_legal_entities_taxIdNormalized_key`(`taxIdNormalized`),
    INDEX `portfolio_financial_legal_entities_normalizedName_idx`(`normalizedName`),
    INDEX `portfolio_financial_legal_entities_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Canonical legal entities already represented by companyCode in the existing finance registry.
INSERT INTO `portfolio_financial_legal_entities`
  (`id`, `code`, `legalName`, `normalizedName`, `taxIdOriginal`, `taxIdNormalized`, `active`, `createdAt`, `updatedAt`)
VALUES
  ('financial_entity_focus_media', 'FOCUS_MEDIA', 'FOCUS MEDIA OUTDOOR SRL', 'focus media outdoor', 'RO40766474', '40766474', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('financial_entity_excellence', 'EXCELLENCE_MEDIA', 'EXCELLENCE MEDIA PRODUCTION SRL', 'excellence media production', 'RO29522177', '29522177', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('financial_entity_focus_bg', 'FOCUS_BG', 'FOCUS MEDIA LLC EOOD', 'focus media llc eood', NULL, NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

UPDATE `portfolio_financial_receivables`
SET `legalEntityId` = CASE `companyCode`
  WHEN 'FOCUS_MEDIA' THEN 'financial_entity_focus_media'
  WHEN 'EXCELLENCE_MEDIA' THEN 'financial_entity_excellence'
  WHEN 'FOCUS_BG' THEN 'financial_entity_focus_bg'
  ELSE NULL
END
WHERE `legalEntityId` IS NULL;

UPDATE `portfolio_financial_payables`
SET `legalEntityId` = CASE `companyCode`
  WHEN 'FOCUS_MEDIA' THEN 'financial_entity_focus_media'
  WHEN 'EXCELLENCE_MEDIA' THEN 'financial_entity_excellence'
  WHEN 'FOCUS_BG' THEN 'financial_entity_focus_bg'
  ELSE NULL
END
WHERE `legalEntityId` IS NULL;

-- CreateTable
CREATE TABLE `portfolio_financial_partners` (
    `id` VARCHAR(191) NOT NULL,
    `identityKey` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `taxIdOriginal` VARCHAR(191) NULL,
    `taxIdNormalized` VARCHAR(191) NULL,
    `countryCode` VARCHAR(2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_partners_identityKey_key`(`identityKey`),
    INDEX `portfolio_financial_partners_taxIdNormalized_idx`(`taxIdNormalized`),
    INDEX `portfolio_financial_partners_normalizedName_idx`(`normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_partner_roles` (
    `id` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_financial_partner_roles_clientId_idx`(`clientId`),
    INDEX `portfolio_financial_partner_roles_supplierId_idx`(`supplierId`),
    INDEX `portfolio_financial_partner_roles_legalEntityId_role_active_idx`(`legalEntityId`, `role`, `active`),
    UNIQUE INDEX `portfolio_financial_partner_roles_legalEntityId_partnerId_ro_key`(`legalEntityId`, `partnerId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_partner_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `aliasKey` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(191) NOT NULL,
    `normalizedAlias` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_partner_aliases_aliasKey_key`(`aliasKey`),
    INDEX `portfolio_financial_partner_aliases_legalEntityId_normalized_idx`(`legalEntityId`, `normalizedAlias`),
    INDEX `portfolio_financial_partner_aliases_partnerId_idx`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_bank_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `ibanOriginal` VARCHAR(191) NOT NULL,
    `ibanNormalized` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `bankName` VARCHAR(191) NULL,
    `accountLabel` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_financial_bank_accounts_ibanNormalized_idx`(`ibanNormalized`),
    UNIQUE INDEX `portfolio_financial_bank_accounts_legalEntityId_ibanNormaliz_key`(`legalEntityId`, `ibanNormalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_bank_statements` (
    `id` VARCHAR(191) NOT NULL,
    `uploadId` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `statementFingerprint` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `issuedAt` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `openingBalance` DECIMAL(16, 2) NULL,
    `closingBalance` DECIMAL(16, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'imported',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_bank_statements_statementFingerprint_key`(`statementFingerprint`),
    INDEX `portfolio_financial_bank_statements_legalEntityId_periodStar_idx`(`legalEntityId`, `periodStart`, `periodEnd`),
    INDEX `portfolio_financial_bank_statements_bankAccountId_periodStar_idx`(`bankAccountId`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_bank_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `statementId` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `bookedAt` DATETIME(3) NOT NULL,
    `valueDate` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `debitAmount` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `creditAmount` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `description` TEXT NOT NULL,
    `documentReference` VARCHAR(191) NULL,
    `bankReference` VARCHAR(191) NULL,
    `payerName` VARCHAR(191) NULL,
    `payerIban` VARCHAR(191) NULL,
    `payerTaxId` VARCHAR(191) NULL,
    `beneficiaryName` VARCHAR(191) NULL,
    `beneficiaryIban` VARCHAR(191) NULL,
    `beneficiaryTaxId` VARCHAR(191) NULL,
    `paymentDetails` TEXT NULL,
    `merchantName` VARCHAR(191) NULL,
    `maskedCard` VARCHAR(191) NULL,
    `transactionType` VARCHAR(191) NULL,
    `classification` VARCHAR(191) NOT NULL,
    `reconciliationStatus` VARCHAR(191) NOT NULL DEFAULT 'unmatched',
    `rawRowJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_bank_transactions_fingerprint_key`(`fingerprint`),
    INDEX `portfolio_financial_bank_transactions_legalEntityId_bookedAt_idx`(`legalEntityId`, `bookedAt`),
    INDEX `portfolio_financial_bank_transactions_bankAccountId_bookedAt_idx`(`bankAccountId`, `bookedAt`),
    INDEX `portfolio_financial_bank_transactions_classification_reconci_idx`(`classification`, `reconciliationStatus`),
    INDEX `portfolio_financial_bank_transactions_payerTaxId_idx`(`payerTaxId`),
    INDEX `portfolio_financial_bank_transactions_beneficiaryTaxId_idx`(`beneficiaryTaxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_payable_payments` (
    `id` VARCHAR(191) NOT NULL,
    `payableId` VARCHAR(191) NOT NULL,
    `bankTransactionId` VARCHAR(191) NULL,
    `supplierPaymentRuleId` VARCHAR(191) NULL,
    `requestKey` VARCHAR(191) NULL,
    `replacesPaymentId` VARCHAR(191) NULL,
    `amount` DECIMAL(16, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentReference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `verificationStatus` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdByUserId` VARCHAR(191) NULL,
    `cancelledByUserId` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancellationReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_payable_payments_requestKey_key`(`requestKey`),
    UNIQUE INDEX `portfolio_financial_payable_payments_replacesPaymentId_key`(`replacesPaymentId`),
    INDEX `portfolio_financial_payable_payments_payableId_status_paidAt_idx`(`payableId`, `status`, `paidAt`),
    INDEX `portfolio_financial_payable_payments_bankTransactionId_statu_idx`(`bankTransactionId`, `status`),
    INDEX `portfolio_financial_payable_payments_replacesPaymentId_idx`(`replacesPaymentId`),
    INDEX `portfolio_financial_payable_payments_verificationStatus_stat_idx`(`verificationStatus`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_supplier_payment_rules` (
    `id` VARCHAR(191) NOT NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `ruleMode` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(191) NULL,
    `supplierCategory` VARCHAR(191) NULL,
    `requireSameDayDueDate` BOOLEAN NOT NULL DEFAULT false,
    `maxDueDays` INTEGER NULL,
    `amountLimit` DECIMAL(16, 2) NULL,
    `defaultPaymentMethod` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NULL,
    `effectiveTo` DATETIME(3) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_supplier_payment_rules_legalEntityId_supplierId_ac_idx`(`legalEntityId`, `supplierId`, `active`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `portfolio_financial_report_uploads_legalEntityId_importType__idx` ON `portfolio_financial_report_uploads`(`legalEntityId`, `importType`, `uploadedAt`);

-- CreateIndex
CREATE UNIQUE INDEX `portfolio_financial_payables_sourceFingerprint_key` ON `portfolio_financial_payables`(`sourceFingerprint`);

-- CreateIndex
CREATE UNIQUE INDEX `portfolio_financial_receivables_sourceFingerprint_key` ON `portfolio_financial_receivables`(`sourceFingerprint`);

-- CreateIndex
CREATE INDEX `portfolio_financial_payables_legalEntityId_dueDate_idx` ON `portfolio_financial_payables`(`legalEntityId`, `dueDate`);

-- CreateIndex
CREATE INDEX `portfolio_financial_payables_partnerId_idx` ON `portfolio_financial_payables`(`partnerId`);

-- CreateIndex
CREATE INDEX `portfolio_financial_receivables_legalEntityId_dueDate_idx` ON `portfolio_financial_receivables`(`legalEntityId`, `dueDate`);

-- CreateIndex
CREATE INDEX `portfolio_financial_receivables_partnerId_idx` ON `portfolio_financial_receivables`(`partnerId`);

-- CreateIndex
CREATE INDEX `portfolio_financial_receivables_sourceExternalId_idx` ON `portfolio_financial_receivables`(`sourceExternalId`);

-- CreateIndex
CREATE INDEX `portfolio_financial_receivable_payments_bankTransactionId_st_idx` ON `portfolio_financial_receivable_payments`(`bankTransactionId`, `status`);

-- AddForeignKey
ALTER TABLE `portfolio_financial_report_uploads` ADD CONSTRAINT `portfolio_financial_report_uploads_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payables` ADD CONSTRAINT `portfolio_financial_payables_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payables` ADD CONSTRAINT `portfolio_financial_payables_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `portfolio_financial_partners`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_receivables` ADD CONSTRAINT `portfolio_financial_receivables_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_receivables` ADD CONSTRAINT `portfolio_financial_receivables_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `portfolio_financial_partners`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_receivable_payments` ADD CONSTRAINT `portfolio_financial_receivable_payments_bankTransactionId_fkey` FOREIGN KEY (`bankTransactionId`) REFERENCES `portfolio_financial_bank_transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_roles` ADD CONSTRAINT `portfolio_financial_partner_roles_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_roles` ADD CONSTRAINT `portfolio_financial_partner_roles_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `portfolio_financial_partners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_roles` ADD CONSTRAINT `portfolio_financial_partner_roles_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `portfolio_client_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_roles` ADD CONSTRAINT `portfolio_financial_partner_roles_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `portfolio_suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_aliases` ADD CONSTRAINT `portfolio_financial_partner_aliases_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_partner_aliases` ADD CONSTRAINT `portfolio_financial_partner_aliases_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `portfolio_financial_partners`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_accounts` ADD CONSTRAINT `portfolio_financial_bank_accounts_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_statements` ADD CONSTRAINT `portfolio_financial_bank_statements_uploadId_fkey` FOREIGN KEY (`uploadId`) REFERENCES `portfolio_financial_report_uploads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_statements` ADD CONSTRAINT `portfolio_financial_bank_statements_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_statements` ADD CONSTRAINT `portfolio_financial_bank_statements_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `portfolio_financial_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_transactions` ADD CONSTRAINT `portfolio_financial_bank_transactions_statementId_fkey` FOREIGN KEY (`statementId`) REFERENCES `portfolio_financial_bank_statements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_transactions` ADD CONSTRAINT `portfolio_financial_bank_transactions_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_bank_transactions` ADD CONSTRAINT `portfolio_financial_bank_transactions_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `portfolio_financial_bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_payableId_fkey` FOREIGN KEY (`payableId`) REFERENCES `portfolio_financial_payables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_bankTransactionId_fkey` FOREIGN KEY (`bankTransactionId`) REFERENCES `portfolio_financial_bank_transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_supplierPaymentRuleId_fkey` FOREIGN KEY (`supplierPaymentRuleId`) REFERENCES `portfolio_supplier_payment_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_replacesPaymentId_fkey` FOREIGN KEY (`replacesPaymentId`) REFERENCES `portfolio_financial_payable_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_payable_payments` ADD CONSTRAINT `portfolio_financial_payable_payments_cancelledByUserId_fkey` FOREIGN KEY (`cancelledByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_supplier_payment_rules` ADD CONSTRAINT `portfolio_supplier_payment_rules_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_supplier_payment_rules` ADD CONSTRAINT `portfolio_supplier_payment_rules_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `portfolio_suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_supplier_payment_rules` ADD CONSTRAINT `portfolio_supplier_payment_rules_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
