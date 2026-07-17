ALTER TABLE `portfolio_crm_leads`
  ADD COLUMN `forecastCategory` VARCHAR(32) NOT NULL DEFAULT 'pipeline',
  ADD COLUMN `taxId` VARCHAR(80) NULL,
  ADD COLUMN `industry` VARCHAR(120) NULL;

UPDATE `portfolio_crm_leads`
SET `forecastCategory` = CASE
  WHEN `status` IN ('won', 'account_management') THEN 'closed'
  WHEN `status` IN ('lost', 'inactive', 'on_hold', 'no_response', 'hold_created') THEN 'omitted'
  ELSE 'pipeline'
END;

CREATE INDEX `portfolio_crm_leads_forecastCategory_expectedCloseDate_idx`
  ON `portfolio_crm_leads`(`forecastCategory`, `expectedCloseDate`);

CREATE INDEX `portfolio_crm_leads_taxId_idx`
  ON `portfolio_crm_leads`(`taxId`);

CREATE INDEX `portfolio_crm_leads_industry_idx`
  ON `portfolio_crm_leads`(`industry`);
