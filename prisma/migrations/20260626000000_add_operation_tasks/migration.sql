CREATE TABLE `portfolio_operation_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `reservationId` VARCHAR(191) NULL,
  `campaignId` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NULL,
  `kind` ENUM('DECORATION', 'NEUTRALIZATION', 'REDECORATION', 'MAINTENANCE') NOT NULL,
  `status` ENUM('NEW', 'IN_PROGRESS', 'DONE', 'ARCHIVED', 'CANCELLED') NOT NULL DEFAULT 'NEW',
  `source` ENUM('SYSTEM_DERIVED', 'LEGACY_PRODUCTION_NOTES', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
  `dedupeKey` VARCHAR(191) NULL,
  `legacyTaskId` VARCHAR(191) NULL,
  `scheduledFor` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `assignedToUserId` VARCHAR(191) NULL,
  `supplierId` VARCHAR(191) NULL,
  `cost` DECIMAL(14, 2) NULL,
  `currency` VARCHAR(3) NULL,
  `briefUrl` LONGTEXT NULL,
  `beforePhotoUrl` LONGTEXT NULL,
  `afterPhotoUrl` LONGTEXT NULL,
  `notes` TEXT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `portfolio_operation_tasks_dedupeKey_key`(`dedupeKey`),
  INDEX `portfolio_operation_tasks_reservationId_kind_idx`(`reservationId`, `kind`),
  INDEX `portfolio_operation_tasks_campaignId_idx`(`campaignId`),
  INDEX `portfolio_operation_tasks_locationId_idx`(`locationId`),
  INDEX `portfolio_operation_tasks_kind_status_scheduledFor_idx`(`kind`, `status`, `scheduledFor`),
  INDEX `portfolio_operation_tasks_status_scheduledFor_idx`(`status`, `scheduledFor`),
  INDEX `portfolio_operation_tasks_assignedToUserId_status_idx`(`assignedToUserId`, `status`),
  INDEX `portfolio_operation_tasks_supplierId_idx`(`supplierId`),
  INDEX `portfolio_operation_tasks_completedAt_idx`(`completedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_reservationId_fkey`
  FOREIGN KEY (`reservationId`) REFERENCES `portfolio_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `portfolio_campaigns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `portfolio_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_assignedToUserId_fkey`
  FOREIGN KEY (`assignedToUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_operation_tasks`
  ADD CONSTRAINT `portfolio_operation_tasks_supplierId_fkey`
  FOREIGN KEY (`supplierId`) REFERENCES `portfolio_suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
