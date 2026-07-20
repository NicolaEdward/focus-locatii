-- Additive metadata for private operational proof storage.
-- Existing Base64 payloads remain in storageUrl for dual-read and rollback.

ALTER TABLE `portfolio_client_documents`
  MODIFY COLUMN `storageUrl` LONGTEXT NULL,
  ADD COLUMN `storageProvider` VARCHAR(32) NULL,
  ADD COLUMN `storageKey` VARCHAR(512) NULL,
  ADD COLUMN `storageChecksum` VARCHAR(64) NULL,
  ADD COLUMN `storageEtag` VARCHAR(191) NULL,
  ADD COLUMN `storageMigratedAt` DATETIME(3) NULL,
  ADD COLUMN `storageVerifiedAt` DATETIME(3) NULL;

CREATE INDEX `portfolio_client_documents_storageKey_idx`
  ON `portfolio_client_documents`(`storageKey`);

CREATE INDEX `portfolio_client_documents_documentType_status_expiryDate_idx`
  ON `portfolio_client_documents`(`documentType`, `status`, `expiryDate`);
