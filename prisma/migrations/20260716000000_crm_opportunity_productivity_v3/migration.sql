ALTER TABLE `portfolio_crm_leads`
  ADD COLUMN `opportunityName` VARCHAR(191) NULL,
  ADD COLUMN `nextStep` TEXT NULL,
  ADD COLUMN `qualificationData` JSON NULL,
  ADD COLUMN `lostReasonCode` VARCHAR(191) NULL,
  ADD COLUMN `stageChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `firstContactedAt` DATETIME(3) NULL,
  ADD COLUMN `qualifiedAt` DATETIME(3) NULL,
  ADD COLUMN `lastContactAt` DATETIME(3) NULL,
  ADD COLUMN `lastActivityAt` DATETIME(3) NULL,
  ADD COLUMN `noResponseCount` INT NOT NULL DEFAULT 0;

UPDATE `portfolio_crm_leads`
SET
  `stageChangedAt` = `updatedAt`,
  `lastActivityAt` = `updatedAt`,
  `nextStep` = CASE
    WHEN `status` IN ('won', 'lost', 'inactive', 'account_management') THEN NULL
    ELSE 'Continua follow-up-ul comercial.'
  END
WHERE `stageChangedAt` IS NOT NULL;

CREATE INDEX `portfolio_crm_leads_stageChangedAt_idx`
  ON `portfolio_crm_leads`(`stageChangedAt`);

CREATE INDEX `portfolio_crm_leads_lastContactAt_idx`
  ON `portfolio_crm_leads`(`lastContactAt`);

CREATE INDEX `portfolio_crm_leads_lastActivityAt_idx`
  ON `portfolio_crm_leads`(`lastActivityAt`);
