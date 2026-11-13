-- CreateTable
CREATE TABLE `portfolio_financial_invoice_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `receivableId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NULL,
    `locationId` VARCHAR(191) NULL,
    `billingItemId` VARCHAR(191) NULL,
    `requestKey` VARCHAR(191) NOT NULL,
    `requestFingerprint` VARCHAR(64) NOT NULL,
    `netAmount` DECIMAL(14, 2) NOT NULL,
    `vatAmount` DECIMAL(14, 2) NOT NULL,
    `grossAmount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `notes` TEXT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `reversedByUserId` VARCHAR(191) NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversalReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_invoice_allocations_requestKey_key`(`requestKey`),
    INDEX `portfolio_financial_invoice_allocations_receivableId_status_idx`(`receivableId`, `status`),
    INDEX `portfolio_financial_invoice_allocations_campaignId_currency__idx`(`campaignId`, `currency`, `status`),
    INDEX `portfolio_financial_invoice_allocations_reservationId_idx`(`reservationId`),
    INDEX `portfolio_financial_invoice_allocations_locationId_idx`(`locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_campaign_costs` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NULL,
    `locationId` VARCHAR(191) NULL,
    `legalEntityId` VARCHAR(191) NOT NULL,
    `sourceDocumentId` VARCHAR(191) NULL,
    `sourceReference` VARCHAR(191) NOT NULL,
    `costType` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `netAmount` DECIMAL(14, 2) NOT NULL,
    `vatAmount` DECIMAL(14, 2) NOT NULL,
    `grossAmount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `requestKey` VARCHAR(191) NOT NULL,
    `requestFingerprint` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `approvedByUserId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_financial_campaign_costs_requestKey_key`(`requestKey`),
    INDEX `portfolio_financial_campaign_costs_campaignId_currency_statu_idx`(`campaignId`, `currency`, `status`),
    INDEX `portfolio_financial_campaign_costs_legalEntityId_currency_idx`(`legalEntityId`, `currency`),
    INDEX `portfolio_financial_campaign_costs_reservationId_idx`(`reservationId`),
    INDEX `portfolio_financial_campaign_costs_locationId_idx`(`locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_financial_campaign_finance_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `coverageFrom` DATETIME(3) NOT NULL,
    `coverageTo` DATETIME(3) NOT NULL,
    `costsComplete` BOOLEAN NOT NULL DEFAULT false,
    `sourceFingerprint` VARCHAR(64) NOT NULL,
    `notes` TEXT NOT NULL,
    `approvedByUserId` VARCHAR(191) NOT NULL,
    `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_financial_campaign_finance_reviews_campaignId_curr_key`(`campaignId`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_receivableId_fkey` FOREIGN KEY (`receivableId`) REFERENCES `portfolio_financial_receivables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `portfolio_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `portfolio_reservations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `portfolio_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_billingItemId_fkey` FOREIGN KEY (`billingItemId`) REFERENCES `portfolio_billing_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_invoice_allocations` ADD CONSTRAINT `portfolio_financial_invoice_allocations_reversedByUserId_fkey` FOREIGN KEY (`reversedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `portfolio_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `portfolio_reservations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `portfolio_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_legalEntityId_fkey` FOREIGN KEY (`legalEntityId`) REFERENCES `portfolio_financial_legal_entities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_sourceDocumentId_fkey` FOREIGN KEY (`sourceDocumentId`) REFERENCES `portfolio_client_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_costs` ADD CONSTRAINT `portfolio_financial_campaign_costs_approvedByUserId_fkey` FOREIGN KEY (`approvedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_finance_reviews` ADD CONSTRAINT `portfolio_financial_campaign_finance_reviews_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `portfolio_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_financial_campaign_finance_reviews` ADD CONSTRAINT `portfolio_financial_campaign_finance_reviews_approvedByUser_fkey` FOREIGN KEY (`approvedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

