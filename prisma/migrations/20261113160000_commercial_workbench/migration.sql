-- CreateTable
CREATE TABLE `portfolio_commercial_policies` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `version` INTEGER NOT NULL DEFAULT 1,
    `vatRateBps` INTEGER NOT NULL,
    `vatTreatment` VARCHAR(24) NOT NULL,
    `rateCardCurrency` VARCHAR(3) NOT NULL,
    `quoteValidityDays` INTEGER NOT NULL DEFAULT 7,
    `approvalHours` INTEGER NOT NULL DEFAULT 24,
    `agentToolsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `generationEnabled` BOOLEAN NOT NULL DEFAULT false,
    `outboundEnabled` BOOLEAN NOT NULL DEFAULT false,
    `maxDailyModelCalls` INTEGER NOT NULL DEFAULT 20,
    `approvedByUserId` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_agent_principals` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `mode` VARCHAR(24) NOT NULL DEFAULT 'shadow',
    `maxDailyCommands` INTEGER NOT NULL DEFAULT 100,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_agent_principals_tokenHash_key`(`tokenHash`),
    INDEX `portfolio_agent_principals_ownerUserId_revokedAt_idx`(`ownerUserId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_agent_usage_days` (
    `id` VARCHAR(191) NOT NULL,
    `principalId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `commands` INTEGER NOT NULL DEFAULT 0,
    `modelCalls` INTEGER NOT NULL DEFAULT 0,
    `modelTokens` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `portfolio_agent_usage_days_principalId_day_key`(`principalId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_agent_commands` (
    `id` VARCHAR(191) NOT NULL,
    `principalId` VARCHAR(191) NOT NULL,
    `delegatorUserId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(120) NOT NULL,
    `tool` VARCHAR(64) NOT NULL,
    `policyVersion` VARCHAR(80) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `sourceReferences` JSON NULL,
    `model` VARCHAR(120) NULL,
    `tokenCount` INTEGER NULL,
    `inputHash` VARCHAR(64) NOT NULL,
    `outputHash` VARCHAR(64) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `result` JSON NULL,
    `errorCode` VARCHAR(64) NULL,
    `approvalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `portfolio_agent_commands_principalId_createdAt_idx`(`principalId`, `createdAt`),
    UNIQUE INDEX `portfolio_agent_commands_principalId_requestKey_key`(`principalId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_quotes` (
    `id` VARCHAR(191) NOT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `opportunityId` VARCHAR(191) NULL,
    `latestRevision` INTEGER NOT NULL DEFAULT 1,
    `state` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_commercial_quotes_ownerUserId_state_idx`(`ownerUserId`, `state`),
    INDEX `portfolio_commercial_quotes_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_quote_revisions` (
    `id` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `principalId` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `requestKey` VARCHAR(80) NOT NULL,
    `intentHash` VARCHAR(64) NOT NULL,
    `totalNet` DECIMAL(14, 2) NOT NULL,
    `totalTax` DECIMAL(14, 2) NOT NULL,
    `totalGross` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `availabilityHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_quote_revisions_requestKey_key`(`requestKey`),
    INDEX `portfolio_quote_revisions_payloadHash_idx`(`payloadHash`),
    UNIQUE INDEX `portfolio_quote_revisions_quoteId_revision_key`(`quoteId`, `revision`),
    PRIMARY KEY (`id`),
    CONSTRAINT `portfolio_quote_revisions_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `portfolio_commercial_quotes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `revisionId` VARCHAR(191) NOT NULL,
    `principalId` VARCHAR(191) NULL,
    `action` VARCHAR(40) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `recipientHash` VARCHAR(64) NULL,
    `holdExpiresAt` DATETIME(3) NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `requestedByUserId` VARCHAR(191) NOT NULL,
    `approvedByUserId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_commercial_approvals_revisionId_state_idx`(`revisionId`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_acceptances` (
    `id` VARCHAR(191) NOT NULL,
    `revisionId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `decision` VARCHAR(24) NOT NULL,
    `evidenceReference` VARCHAR(500) NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `requestKey` VARCHAR(80) NOT NULL,
    `intentHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_commercial_acceptances_requestKey_key`(`requestKey`),
    INDEX `portfolio_commercial_acceptances_revisionId_createdAt_idx`(`revisionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_dispatches` (
    `id` VARCHAR(191) NOT NULL,
    `revisionId` VARCHAR(191) NOT NULL,
    `approvalId` VARCHAR(191) NOT NULL,
    `principalId` VARCHAR(191) NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'queued',
    `providerReceipt` VARCHAR(191) NULL,
    `errorCode` VARCHAR(80) NULL,
    `requestedByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    UNIQUE INDEX `portfolio_commercial_dispatches_approvalId_key`(`approvalId`),
    INDEX `portfolio_commercial_dispatches_state_createdAt_idx`(`state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_suppressions` (
    `recipientHash` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(240) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`recipientHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_dooh_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(80) NOT NULL DEFAULT 'Europe/Bucharest',
    `loopSeconds` INTEGER NOT NULL,
    `slotSeconds` INTEGER NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `sourceReference` VARCHAR(500) NOT NULL,
    `verifiedByUserId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_dooh_profiles_locationId_key`(`locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_dooh_capacity_bookings` (
    `id` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `shareBps` INTEGER NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `daypartStartMinute` INTEGER NOT NULL DEFAULT 0,
    `daypartEndMinute` INTEGER NOT NULL DEFAULT 1440,
    `state` VARCHAR(24) NOT NULL DEFAULT 'confirmed',
    `approvalReference` VARCHAR(500) NOT NULL,
    `requestKey` VARCHAR(120) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `profileSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_dooh_capacity_bookings_requestKey_key`(`requestKey`),
    INDEX `portfolio_dooh_capacity_bookings_profileId_periodStart_perio_idx`(`profileId`, `periodStart`, `periodEnd`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_dooh_playback_proofs` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `actualPlays` INTEGER NOT NULL,
    `expectedPlays` INTEGER NULL,
    `sourceReference` VARCHAR(500) NOT NULL,
    `evidenceHash` VARCHAR(64) NOT NULL,
    `verifiedByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_dooh_playback_proofs_bookingId_evidenceHash_key`(`bookingId`, `evidenceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_sales_pilots` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `mode` VARCHAR(24) NOT NULL DEFAULT 'offline',
    `state` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `protocol` JSON NOT NULL,
    `protocolHash` VARCHAR(64) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `approvedByUserId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `stoppedAt` DATETIME(3) NULL,
    `stopReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_sales_pilot_cases` (
    `id` VARCHAR(191) NOT NULL,
    `pilotId` VARCHAR(191) NOT NULL,
    `companyKeyHash` VARCHAR(64) NOT NULL,
    `arm` VARCHAR(24) NOT NULL,
    `opportunityId` VARCHAR(191) NULL,
    `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metrics` JSON NOT NULL,
    `matureAt` DATETIME(3) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewEvidence` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_sales_pilot_cases_pilotId_arm_idx`(`pilotId`, `arm`),
    UNIQUE INDEX `portfolio_sales_pilot_cases_pilotId_companyKeyHash_key`(`pilotId`, `companyKeyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_commercial_delivery_events` (
    `eventId` VARCHAR(191) NOT NULL,
    `dispatchId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_commercial_delivery_events_dispatchId_createdAt_idx`(`dispatchId`, `createdAt`),
    PRIMARY KEY (`eventId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
