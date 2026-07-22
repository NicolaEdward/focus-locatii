CREATE TABLE `portfolio_auth_mfa_credentials` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `secretCiphertext` LONGTEXT NOT NULL,
  `secretIv` VARCHAR(191) NOT NULL,
  `secretTag` VARCHAR(191) NOT NULL,
  `enabledAt` DATETIME(3) NULL,
  `lastUsedStep` BIGINT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `portfolio_auth_mfa_credentials_userId_key`(`userId`),
  INDEX `portfolio_auth_mfa_credentials_enabledAt_idx`(`enabledAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_auth_mfa_credentials_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `portfolio_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portfolio_auth_recovery_codes` (
  `id` VARCHAR(191) NOT NULL,
  `credentialId` VARCHAR(191) NOT NULL,
  `codeHash` VARCHAR(191) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `portfolio_auth_recovery_codes_codeHash_key`(`codeHash`),
  INDEX `portfolio_auth_recovery_codes_credentialId_usedAt_idx`(`credentialId`, `usedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_auth_recovery_codes_credentialId_fkey`
    FOREIGN KEY (`credentialId`) REFERENCES `portfolio_auth_mfa_credentials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portfolio_auth_action_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `email` VARCHAR(254) NULL,
  `name` VARCHAR(191) NULL,
  `role` VARCHAR(64) NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `portfolio_auth_action_tokens_tokenHash_key`(`tokenHash`),
  INDEX `portfolio_auth_action_tokens_type_expiresAt_usedAt_idx`(`type`, `expiresAt`, `usedAt`),
  INDEX `portfolio_auth_action_tokens_userId_idx`(`userId`),
  INDEX `portfolio_auth_action_tokens_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_auth_action_tokens_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `portfolio_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `portfolio_auth_action_tokens_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `portfolio_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portfolio_auth_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `ipHash` VARCHAR(191) NULL,
  `userAgent` VARCHAR(512) NULL,
  `mfaVerifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  INDEX `portfolio_auth_sessions_userId_revokedAt_expiresAt_idx`(`userId`, `revokedAt`, `expiresAt`),
  INDEX `portfolio_auth_sessions_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `portfolio_auth_sessions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `portfolio_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `portfolio_security_rate_limits` (
  `keyHash` VARCHAR(191) NOT NULL,
  `scope` VARCHAR(64) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `windowStartedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `portfolio_security_rate_limits_scope_expiresAt_idx`(`scope`, `expiresAt`),
  PRIMARY KEY (`keyHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
