ALTER TABLE `portfolio_locations`
  ADD COLUMN `lifecycleStatus` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED', 'MAINTENANCE') NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX `portfolio_locations_lifecycleStatus_idx`
  ON `portfolio_locations`(`lifecycleStatus`);

CREATE TABLE `portfolio_location_availability_overrides` (
  `id` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `type` ENUM('COMMERCIAL_BLOCK', 'MAINTENANCE', 'INTERNAL_HOLD') NOT NULL DEFAULT 'COMMERCIAL_BLOCK',
  `reason` TEXT NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `clearedByUserId` VARCHAR(191) NULL,
  `clearedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `loc_avail_override_period_idx`(`locationId`, `periodStart`, `periodEnd`),
  INDEX `loc_avail_override_type_idx`(`type`),
  INDEX `loc_avail_override_cleared_idx`(`clearedAt`),
  INDEX `loc_avail_override_created_by_idx`(`createdByUserId`),
  INDEX `loc_avail_override_cleared_by_idx`(`clearedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `portfolio_location_availability_overrides`
  ADD CONSTRAINT `portfolio_location_availability_overrides_locationId_fkey`
  FOREIGN KEY (`locationId`) REFERENCES `portfolio_locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `portfolio_location_availability_overrides`
  ADD CONSTRAINT `portfolio_location_availability_overrides_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `portfolio_location_availability_overrides`
  ADD CONSTRAINT `portfolio_location_availability_overrides_clearedByUserId_fkey`
  FOREIGN KEY (`clearedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
