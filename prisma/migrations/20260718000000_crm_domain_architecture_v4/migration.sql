-- CRM domain v4 is additive. Legacy CRM tables remain intact for audit and rollback.

CREATE TABLE IF NOT EXISTS `portfolio_crm_companies` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `taxId` VARCHAR(80) NULL,
  `normalizedTaxId` VARCHAR(80) NULL,
  `industry` VARCHAR(120) NULL,
  `website` VARCHAR(191) NULL,
  `normalizedWebsiteDomain` VARCHAR(191) NULL,
  `ownerId` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'prospect',
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `portfolio_crm_companies_normalizedName_idx`(`normalizedName`),
  UNIQUE INDEX `portfolio_crm_companies_normalizedTaxId_key`(`normalizedTaxId`),
  INDEX `portfolio_crm_companies_normalizedWebsiteDomain_idx`(`normalizedWebsiteDomain`),
  INDEX `portfolio_crm_companies_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `portfolio_crm_companies_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_companies_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_companies_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_crm_company_contacts` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NULL,
  `email` VARCHAR(191) NULL,
  `normalizedEmail` VARCHAR(191) NULL,
  `phone` VARCHAR(80) NULL,
  `normalizedPhone` VARCHAR(80) NULL,
  `preferredChannel` VARCHAR(40) NULL,
  `isDecisionMaker` BOOLEAN NOT NULL DEFAULT false,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `portfolio_crm_company_contacts_companyId_isPrimary_idx`(`companyId`, `isPrimary`),
  INDEX `portfolio_crm_company_contacts_normalizedEmail_idx`(`normalizedEmail`),
  INDEX `portfolio_crm_company_contacts_normalizedPhone_idx`(`normalizedPhone`),
  INDEX `portfolio_crm_company_contacts_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_company_contacts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `portfolio_crm_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_company_contacts_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_crm_prospects` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `legacyLeadId` VARCHAR(191) NULL,
  `source` VARCHAR(191) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'prospecting',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'normal',
  `contactState` VARCHAR(40) NOT NULL DEFAULT 'uncontacted',
  `qualificationSummary` JSON NULL,
  `initialSnapshot` JSON NOT NULL,
  `qualifiedAt` DATETIME(3) NULL,
  `disqualifiedAt` DATETIME(3) NULL,
  `returnAt` DATETIME(3) NULL,
  `closedReason` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `portfolio_crm_prospects_legacyLeadId_key`(`legacyLeadId`),
  INDEX `portfolio_crm_prospects_companyId_status_idx`(`companyId`, `status`),
  INDEX `portfolio_crm_prospects_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `portfolio_crm_prospects_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `portfolio_crm_prospects_returnAt_idx`(`returnAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_prospects_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `portfolio_crm_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_prospects_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_prospects_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_crm_opportunities` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `sourceProspectId` VARCHAR(191) NULL,
  `ownerId` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `legacyLeadId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `needSummary` TEXT NULL,
  `stage` VARCHAR(40) NOT NULL DEFAULT 'opportunity',
  `desiredPeriodStart` DATETIME(3) NULL,
  `desiredPeriodEnd` DATETIME(3) NULL,
  `geography` TEXT NULL,
  `formats` TEXT NULL,
  `budgetStatus` VARCHAR(40) NULL,
  `budgetMin` DECIMAL(14, 2) NULL,
  `budgetMax` DECIMAL(14, 2) NULL,
  `currency` VARCHAR(3) NULL,
  `quotedValue` DECIMAL(14, 2) NULL,
  `revisedValue` DECIMAL(14, 2) NULL,
  `agreedValue` DECIMAL(14, 2) NULL,
  `decisionDate` DATETIME(3) NULL,
  `quotedAt` DATETIME(3) NULL,
  `negotiationAt` DATETIME(3) NULL,
  `contractingAt` DATETIME(3) NULL,
  `wonAt` DATETIME(3) NULL,
  `lostAt` DATETIME(3) NULL,
  `onHoldAt` DATETIME(3) NULL,
  `previousStage` VARCHAR(40) NULL,
  `lostReasonCode` VARCHAR(80) NULL,
  `lostReason` TEXT NULL,
  `competitor` VARCHAR(191) NULL,
  `initialSnapshot` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `portfolio_crm_opportunities_legacyLeadId_key`(`legacyLeadId`),
  INDEX `portfolio_crm_opportunities_companyId_stage_idx`(`companyId`, `stage`),
  INDEX `portfolio_crm_opportunities_sourceProspectId_idx`(`sourceProspectId`),
  INDEX `portfolio_crm_opportunities_ownerId_stage_idx`(`ownerId`, `stage`),
  INDEX `portfolio_crm_opportunities_stage_decisionDate_idx`(`stage`, `decisionDate`),
  INDEX `portfolio_crm_opportunities_wonAt_idx`(`wonAt`),
  INDEX `portfolio_crm_opportunities_lostAt_idx`(`lostAt`),
  INDEX `portfolio_crm_opportunities_updatedAt_idx`(`updatedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_opportunities_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `portfolio_crm_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_opportunities_sourceProspectId_fkey` FOREIGN KEY (`sourceProspectId`) REFERENCES `portfolio_crm_prospects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_opportunities_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_opportunities_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_crm_next_actions` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `prospectId` VARCHAR(191) NULL,
  `opportunityId` VARCHAR(191) NULL,
  `ownerId` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `completedByUserId` VARCHAR(191) NULL,
  `type` VARCHAR(80) NOT NULL,
  `description` TEXT NULL,
  `dueAt` DATETIME(3) NOT NULL,
  `priority` VARCHAR(20) NOT NULL DEFAULT 'normal',
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `result` TEXT NULL,
  `completedAt` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `portfolio_crm_next_actions_ownerId_status_dueAt_idx`(`ownerId`, `status`, `dueAt`),
  INDEX `portfolio_crm_next_actions_prospectId_status_idx`(`prospectId`, `status`),
  INDEX `portfolio_crm_next_actions_opportunityId_status_idx`(`opportunityId`, `status`),
  INDEX `portfolio_crm_next_actions_companyId_status_idx`(`companyId`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_next_actions_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `portfolio_crm_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_next_actions_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `portfolio_crm_prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_next_actions_opportunityId_fkey` FOREIGN KEY (`opportunityId`) REFERENCES `portfolio_crm_opportunities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_next_actions_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_next_actions_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_next_actions_completedByUserId_fkey` FOREIGN KEY (`completedByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_crm_events` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `prospectId` VARCHAR(191) NULL,
  `opportunityId` VARCHAR(191) NULL,
  `actorUserId` VARCHAR(191) NULL,
  `type` VARCHAR(80) NOT NULL,
  `source` VARCHAR(60) NOT NULL DEFAULT 'CRM',
  `summary` TEXT NOT NULL,
  `result` TEXT NULL,
  `previousValues` JSON NULL,
  `nextValues` JSON NULL,
  `metadata` JSON NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portfolio_crm_events_idempotencyKey_key`(`idempotencyKey`),
  INDEX `portfolio_crm_events_companyId_occurredAt_idx`(`companyId`, `occurredAt`),
  INDEX `portfolio_crm_events_prospectId_occurredAt_idx`(`prospectId`, `occurredAt`),
  INDEX `portfolio_crm_events_opportunityId_occurredAt_idx`(`opportunityId`, `occurredAt`),
  INDEX `portfolio_crm_events_actorUserId_occurredAt_idx`(`actorUserId`, `occurredAt`),
  INDEX `portfolio_crm_events_type_occurredAt_idx`(`type`, `occurredAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_crm_events_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `portfolio_crm_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_events_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `portfolio_crm_prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_events_opportunityId_fkey` FOREIGN KEY (`opportunityId`) REFERENCES `portfolio_crm_opportunities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_crm_events_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve legacy records and create deterministic CRM v4 counterparts.
INSERT IGNORE INTO `portfolio_crm_companies` (
  `id`, `name`, `normalizedName`, `taxId`, `normalizedTaxId`, `industry`, `ownerId`,
  `createdByUserId`, `status`, `version`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('crmco_', `id`), `companyName`, LOWER(TRIM(`companyName`)), `taxId`,
  NULLIF(UPPER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(`taxId`, '')), ' ', ''), '.', ''), '-', '')), ''),
  `industry`, `assignedToUserId`, `createdByUserId`, 'prospect', 0, `createdAt`, `updatedAt`
FROM `portfolio_crm_leads`;

INSERT IGNORE INTO `portfolio_crm_company_contacts` (
  `id`, `companyId`, `name`, `role`, `email`, `normalizedEmail`, `phone`, `normalizedPhone`,
  `isDecisionMaker`, `isPrimary`, `createdByUserId`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('crmcc_', contact.`id`), CONCAT('crmco_', contact.`leadId`), contact.`name`, contact.`role`,
  contact.`email`, LOWER(TRIM(contact.`email`)), contact.`phone`,
  NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(contact.`phone`, '')), ' ', ''), '-', ''), '(', ''), ')', ''), ''),
  false, contact.`isPrimary`, lead.`createdByUserId`, contact.`createdAt`, contact.`updatedAt`
FROM `portfolio_crm_contacts` contact
JOIN `portfolio_crm_leads` lead ON lead.`id` = contact.`leadId`;

INSERT IGNORE INTO `portfolio_crm_prospects` (
  `id`, `companyId`, `ownerId`, `createdByUserId`, `legacyLeadId`, `source`, `status`, `priority`,
  `contactState`, `qualificationSummary`, `initialSnapshot`, `qualifiedAt`, `returnAt`, `version`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('crmp_', `id`), CONCAT('crmco_', `id`), `assignedToUserId`, `createdByUserId`, `id`, `source`,
  CASE
    WHEN `status` IN ('cold', 'new', 'contacted', 'no_response') THEN 'prospecting'
    WHEN `status` = 'return_later' THEN 'return_later'
    WHEN `status` = 'inactive' THEN 'inactive'
    WHEN `status` = 'on_hold' THEN 'on_hold'
    ELSE 'qualified'
  END,
  'normal',
  CASE
    WHEN `status` IN ('contacted', 'qualified', 'brief_received', 'offer_preparation', 'offer_sent', 'in_negotiation', 'contracting', 'won', 'lost') THEN 'in_dialogue'
    WHEN `noResponseCount` > 0 THEN 'contact_attempt'
    ELSE 'uncontacted'
  END,
  `qualificationData`,
  JSON_OBJECT('legacyLeadId', `id`, 'companyName', `companyName`, 'status', `status`, 'notes', `notes`, 'nextStep', `nextStep`),
  COALESCE(`qualifiedAt`, CASE WHEN `status` NOT IN ('cold', 'new', 'contacted', 'no_response', 'return_later', 'inactive', 'on_hold') THEN `updatedAt` ELSE NULL END),
  CASE WHEN `status` = 'return_later' THEN `nextFollowUpDate` ELSE NULL END,
  0, `createdAt`, `updatedAt`
FROM `portfolio_crm_leads`;

INSERT IGNORE INTO `portfolio_crm_opportunities` (
  `id`, `companyId`, `sourceProspectId`, `ownerId`, `createdByUserId`, `legacyLeadId`, `name`, `needSummary`,
  `stage`, `geography`, `formats`, `currency`, `quotedValue`, `revisedValue`, `agreedValue`, `decisionDate`,
  `quotedAt`, `negotiationAt`, `contractingAt`, `wonAt`, `lostAt`, `lostReasonCode`, `lostReason`,
  `initialSnapshot`, `version`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('crmo_', `id`), CONCAT('crmco_', `id`), CONCAT('crmp_', `id`), `assignedToUserId`, `createdByUserId`, `id`,
  COALESCE(NULLIF(TRIM(`opportunityName`), ''), CONCAT(`companyName`, ' - OOH')), `locationsInterested`,
  CASE
    WHEN `status` IN ('brief_received', 'offer_preparation') THEN 'opportunity'
    WHEN `status` = 'offer_sent' THEN 'quoted'
    WHEN `status` = 'in_negotiation' THEN 'negotiation'
    WHEN `status` = 'contracting' THEN 'contracting'
    WHEN `status` IN ('won', 'account_management') THEN 'won'
    ELSE 'lost'
  END,
  `locationsInterested`, NULL, CASE WHEN `estimatedValue` IS NOT NULL THEN `currency` ELSE NULL END,
  CAST(`estimatedValue` AS DECIMAL(14, 2)),
  CASE WHEN `status` IN ('in_negotiation', 'contracting', 'won', 'account_management') THEN CAST(`estimatedValue` AS DECIMAL(14, 2)) ELSE NULL END,
  CASE WHEN `status` IN ('won', 'account_management') THEN CAST(`estimatedValue` AS DECIMAL(14, 2)) ELSE NULL END,
  `expectedCloseDate`,
  CASE WHEN `status` IN ('offer_sent', 'in_negotiation', 'contracting', 'won', 'account_management', 'lost') THEN `stageChangedAt` ELSE NULL END,
  CASE WHEN `status` IN ('in_negotiation', 'contracting', 'won', 'account_management') THEN `stageChangedAt` ELSE NULL END,
  CASE WHEN `status` IN ('contracting', 'won', 'account_management') THEN `stageChangedAt` ELSE NULL END,
  CASE WHEN `status` IN ('won', 'account_management') THEN `updatedAt` ELSE NULL END,
  CASE WHEN `status` = 'lost' THEN `updatedAt` ELSE NULL END,
  `lostReasonCode`, `lostReason`,
  JSON_OBJECT('legacyLeadId', `id`, 'status', `status`, 'estimatedValue', `estimatedValue`, 'currency', `currency`, 'probability', `probability`, 'notes', `notes`),
  0, `createdAt`, `updatedAt`
FROM `portfolio_crm_leads`
WHERE `status` IN ('brief_received', 'offer_preparation', 'offer_sent', 'in_negotiation', 'contracting', 'won', 'account_management', 'lost');

INSERT IGNORE INTO `portfolio_crm_next_actions` (
  `id`, `companyId`, `prospectId`, `opportunityId`, `ownerId`, `createdByUserId`, `type`, `description`,
  `dueAt`, `priority`, `status`, `version`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('crmna_', lead.`id`), CONCAT('crmco_', lead.`id`), CONCAT('crmp_', lead.`id`), opportunity.`id`,
  lead.`assignedToUserId`, lead.`createdByUserId`, 'other', COALESCE(lead.`nextStep`, 'Continua urmatorul pas comercial.'),
  COALESCE(lead.`nextFollowUpDate`, DATE_ADD(lead.`createdAt`, INTERVAL 3 DAY)), 'normal', 'open', 0, lead.`createdAt`, lead.`updatedAt`
FROM `portfolio_crm_leads` lead
LEFT JOIN `portfolio_crm_opportunities` opportunity ON opportunity.`legacyLeadId` = lead.`id`
WHERE lead.`status` NOT IN ('won', 'account_management', 'lost', 'inactive');

INSERT IGNORE INTO `portfolio_crm_events` (
  `id`, `companyId`, `prospectId`, `opportunityId`, `actorUserId`, `type`, `source`, `summary`,
  `metadata`, `idempotencyKey`, `occurredAt`, `createdAt`
)
SELECT
  CONCAT('crme_migration_', lead.`id`), CONCAT('crmco_', lead.`id`), CONCAT('crmp_', lead.`id`), opportunity.`id`,
  lead.`createdByUserId`, 'MIGRATED_FROM_LEGACY', 'CRM_MIGRATION', 'Inregistrare migrata fara modificarea datelor comerciale.',
  JSON_OBJECT('legacyLeadId', lead.`id`, 'legacyStatus', lead.`status`), CONCAT('migration:v4:', lead.`id`), lead.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `portfolio_crm_leads` lead
LEFT JOIN `portfolio_crm_opportunities` opportunity ON opportunity.`legacyLeadId` = lead.`id`;

INSERT IGNORE INTO `portfolio_crm_events` (
  `id`, `companyId`, `prospectId`, `opportunityId`, `actorUserId`, `type`, `source`, `summary`, `result`,
  `metadata`, `idempotencyKey`, `occurredAt`, `createdAt`
)
SELECT
  CONCAT('crme_', activity.`id`), CONCAT('crmco_', lead.`id`), CONCAT('crmp_', lead.`id`), opportunity.`id`, activity.`userId`,
  COALESCE(NULLIF(activity.`actionType`, ''), activity.`type`), 'LEGACY_ACTIVITY',
  COALESCE(NULLIF(activity.`note`, ''), NULLIF(activity.`details`, ''), activity.`type`), activity.`details`,
  JSON_OBJECT('legacyActivityId', activity.`id`, 'legacyStatus', activity.`statusAtTime`, 'nextStep', activity.`nextStep`, 'nextFollowUpDate', activity.`nextFollowUpDate`),
  CONCAT('migration:v4:activity:', activity.`id`), activity.`activityDate`, activity.`createdAt`
FROM `portfolio_crm_activities` activity
JOIN `portfolio_crm_leads` lead ON lead.`id` = activity.`leadId`
LEFT JOIN `portfolio_crm_opportunities` opportunity ON opportunity.`legacyLeadId` = lead.`id`;
