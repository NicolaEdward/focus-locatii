-- CreateTable
CREATE TABLE `portfolio_document_audit_sources` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(32) NOT NULL DEFAULT 'local_bridge',
    `baseReference` TEXT NULL,
    `allowedPathPrefixes` JSON NOT NULL,
    `indexTextEnabled` BOOLEAN NOT NULL DEFAULT false,
    `maxStaleHours` INTEGER NOT NULL DEFAULT 24,
    `state` VARCHAR(24) NOT NULL DEFAULT 'active',
    `ownerUserId` VARCHAR(191) NOT NULL,
    `ownerTokenVersion` INTEGER NOT NULL,
    `ingestTokenHash` VARCHAR(64) NULL,
    `tokenIssuedAt` DATETIME(3) NULL,
    `lastIngestAt` DATETIME(3) NULL,
    `lastCompletedScanAt` DATETIME(3) NULL,
    `lastCompletedScanId` VARCHAR(128) NULL,
    `activeScanId` VARCHAR(128) NULL,
    `activeScanStartedAt` DATETIME(3) NULL,
    `activeScanObservedAt` DATETIME(3) NULL,
    `activeScanLeaseUntil` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_document_audit_sources_ingestTokenHash_key`(`ingestTokenHash`),
    INDEX `portfolio_document_audit_sources_state_updatedAt_idx`(`state`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_source_documents` (
    `id` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `pathHash` VARCHAR(64) NOT NULL,
    `relativePath` TEXT NOT NULL,
    `displayName` VARCHAR(255) NOT NULL,
    `documentType` VARCHAR(24) NOT NULL DEFAULT 'unknown',
    `state` VARCHAR(24) NOT NULL DEFAULT 'present',
    `currentVersionId` VARCHAR(191) NULL,
    `lastScanId` VARCHAR(128) NOT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL,

    INDEX `portfolio_source_documents_sourceId_state_id_idx`(`sourceId`, `state`, `id`),
    UNIQUE INDEX `portfolio_source_documents_sourceId_pathHash_key`(`sourceId`, `pathHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_source_document_versions` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `modifiedAt` DATETIME(3) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL,
    `extractionStatus` VARCHAR(40) NOT NULL,
    `extractionHash` VARCHAR(64) NOT NULL,
    `textTruncated` BOOLEAN NOT NULL DEFAULT false,
    `sourceReferenceSnapshot` TEXT NULL,
    `sourceConfigVersion` INTEGER NOT NULL,
    `textPages` JSON NOT NULL,
    `reviewVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_source_document_versions_documentId_observedAt_idx`(`documentId`, `observedAt`),
    UNIQUE INDEX `portfolio_source_document_versions_documentId_sha256_extract_key`(`documentId`, `sha256`, `extractionHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_document_fact_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `documentVersionId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `state` VARCHAR(24) NOT NULL,
    `facts` JSON NOT NULL,
    `note` TEXT NOT NULL,
    `reviewedByUserId` VARCHAR(191) NOT NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_document_fact_reviews_documentVersionId_reviewedAt_idx`(`documentVersionId`, `reviewedAt`),
    UNIQUE INDEX `portfolio_document_fact_reviews_documentVersionId_version_key`(`documentVersionId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_document_ingest_batches` (
    `id` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `scanId` VARCHAR(128) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL,
    `scanComplete` BOOLEAN NOT NULL,
    `documentCount` INTEGER NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_document_ingest_batches_sourceId_scanId_idx`(`sourceId`, `scanId`),
    UNIQUE INDEX `portfolio_document_ingest_batches_sourceId_requestKey_key`(`sourceId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_document_audit_runs` (
    `id` VARCHAR(191) NOT NULL,
    `requestedByUserId` VARCHAR(191) NOT NULL,
    `asOf` DATETIME(3) NOT NULL,
    `sourceSnapshotHash` VARCHAR(64) NOT NULL,
    `scopeComplete` BOOLEAN NOT NULL,
    `counts` JSON NOT NULL,
    `findings` JSON NOT NULL,
    `limitations` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_document_audit_runs_createdAt_id_idx`(`createdAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `portfolio_source_documents` ADD CONSTRAINT `portfolio_source_documents_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `portfolio_document_audit_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_source_document_versions` ADD CONSTRAINT `portfolio_source_document_versions_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `portfolio_source_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_document_fact_reviews` ADD CONSTRAINT `portfolio_document_fact_reviews_documentVersionId_fkey` FOREIGN KEY (`documentVersionId`) REFERENCES `portfolio_source_document_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_document_ingest_batches` ADD CONSTRAINT `portfolio_document_ingest_batches_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `portfolio_document_audit_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
