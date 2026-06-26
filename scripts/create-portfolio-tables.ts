import mysql from "mysql2/promise";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

const statements = [
  `CREATE TABLE IF NOT EXISTS portfolio_categories (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    slug VARCHAR(191) NOT NULL,
    description TEXT NULL,
    sortOrder INT NOT NULL DEFAULT 0,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY portfolio_categories_name_key (name),
    UNIQUE KEY portfolio_categories_slug_key (slug)
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_locations (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    nr VARCHAR(191) NULL,
    code VARCHAR(191) NOT NULL,
    categoryId VARCHAR(191) NOT NULL,
    city VARCHAR(191) NULL,
    county VARCHAR(191) NULL,
    address TEXT NULL,
    type VARCHAR(191) NULL,
    size VARCHAR(191) NULL,
    sqm DOUBLE NULL,
    illum BOOLEAN NULL,
    rateCard VARCHAR(191) NULL,
    rateCardValue DOUBLE NULL,
    installationRemoval VARCHAR(191) NULL,
    installationRemovalValue DOUBLE NULL,
    availabilityText VARCHAR(191) NULL,
    availableFrom DATETIME(3) NULL,
    status ENUM('AVAILABLE','AVAILABLE_FROM','BOOKED','RESERVED','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    latReal DOUBLE NULL,
    lngReal DOUBLE NULL,
    latDisplay DOUBLE NULL,
    lngDisplay DOUBLE NULL,
    mapsUrl TEXT NULL,
    mainPhotoUrl TEXT NULL,
    photoOriginalUrl TEXT NULL,
    showPricePublic BOOLEAN NOT NULL DEFAULT FALSE,
    showInstallationCostPublic BOOLEAN NOT NULL DEFAULT FALSE,
    showInPublic BOOLEAN NOT NULL DEFAULT TRUE,
    isPremium BOOLEAN NOT NULL DEFAULT FALSE,
    isFeatured BOOLEAN NOT NULL DEFAULT FALSE,
    coordinateSource VARCHAR(191) NULL,
    gpsAuditStatus ENUM('OK','CORRECTED','MISSING','NEEDS_CONFIRMATION','SUSPECT') NOT NULL DEFAULT 'NEEDS_CONFIRMATION',
    benefits JSON NULL,
    mediaDetails JSON NULL,
    campaignDetails JSON NULL,
    internalNotes TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY portfolio_locations_code_key (code),
    KEY portfolio_locations_categoryId_idx (categoryId),
    KEY portfolio_locations_status_idx (status),
    KEY portfolio_locations_city_idx (city),
    KEY portfolio_locations_showInPublic_idx (showInPublic),
    KEY portfolio_locations_gpsAuditStatus_idx (gpsAuditStatus),
    CONSTRAINT portfolio_locations_categoryId_fkey
      FOREIGN KEY (categoryId) REFERENCES portfolio_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_images (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    locationId VARCHAR(191) NOT NULL,
    url TEXT NOT NULL,
    alt VARCHAR(191) NULL,
    sortOrder INT NOT NULL DEFAULT 0,
    isMain BOOLEAN NOT NULL DEFAULT FALSE,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY portfolio_images_locationId_idx (locationId),
    CONSTRAINT portfolio_images_locationId_fkey
      FOREIGN KEY (locationId) REFERENCES portfolio_locations(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_import_batches (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    fileName VARCHAR(191) NOT NULL,
    importedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    importedBy VARCHAR(191) NULL,
    totalRows INT NOT NULL DEFAULT 0,
    createdCount INT NOT NULL DEFAULT 0,
    updatedCount INT NOT NULL DEFAULT 0,
    missingGpsCount INT NOT NULL DEFAULT 0,
    suspectGpsCount INT NOT NULL DEFAULT 0,
    okGpsCount INT NOT NULL DEFAULT 0,
    notes TEXT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_gps_audit_logs (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    locationId VARCHAR(191) NOT NULL,
    status ENUM('OK','CORRECTED','MISSING','NEEDS_CONFIRMATION','SUSPECT') NOT NULL,
    message TEXT NULL,
    oldLat DOUBLE NULL,
    oldLng DOUBLE NULL,
    newLat DOUBLE NULL,
    newLng DOUBLE NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY portfolio_gps_audit_logs_locationId_idx (locationId),
    KEY portfolio_gps_audit_logs_status_idx (status),
    CONSTRAINT portfolio_gps_audit_logs_locationId_fkey
      FOREIGN KEY (locationId) REFERENCES portfolio_locations(id) ON DELETE CASCADE ON UPDATE CASCADE
  )`
];

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection({
    ...mysqlOptions(),
    multipleStatements: false
  });

  for (const statement of statements) {
    await connection.query(statement);
  }

  await connection.end();
  console.log("portfolio tables ready");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
