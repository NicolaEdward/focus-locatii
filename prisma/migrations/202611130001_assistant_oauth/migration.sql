-- CreateTable
CREATE TABLE `portfolio_assistant_oauth_clients` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `secretHash` VARCHAR(64) NULL,
    `redirectUris` JSON NOT NULL,
    `allowedScopes` JSON NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `disabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_assistant_oauth_consents` (
    `id` VARCHAR(191) NOT NULL,
    `nonceHash` VARCHAR(64) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `tokenVersion` INTEGER NOT NULL,
    `request` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_assistant_oauth_consents_nonceHash_key`(`nonceHash`),
    INDEX `portfolio_assistant_oauth_consents_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_assistant_oauth_grants` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `roleAtConsent` VARCHAR(40) NOT NULL,
    `tokenVersion` INTEGER NOT NULL,
    `scopes` JSON NOT NULL,
    `resource` VARCHAR(1000) NOT NULL,
    `offline` BOOLEAN NOT NULL DEFAULT false,
    `mfaVerifiedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_assistant_oauth_grants_userId_revokedAt_idx`(`userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_assistant_oauth_codes` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `grantId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `redirectUri` VARCHAR(1000) NOT NULL,
    `challenge` VARCHAR(43) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_assistant_oauth_codes_codeHash_key`(`codeHash`),
    INDEX `portfolio_assistant_oauth_codes_grantId_idx`(`grantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_assistant_oauth_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `grantId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portfolio_assistant_oauth_tokens_tokenHash_key`(`tokenHash`),
    INDEX `portfolio_assistant_oauth_tokens_grantId_kind_idx`(`grantId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
