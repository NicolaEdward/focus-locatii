const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const schema = read("prisma", "schema.prisma");
const migration = read("prisma", "migrations", "20260702000000_location_status_availability_architecture", "migration.sql");
const overrides = read("src", "lib", "location-availability-overrides.ts");
const selectionAvailability = read("src", "lib", "location-selection-availability.ts");
const availability = read("src", "lib", "availability.ts");
const blockRoute = read("src", "app", "api", "admin", "locations", "[id]", "block", "route.ts");
const conflictPreview = read("src", "app", "api", "admin", "reservations", "conflict-preview", "route.ts");
const editor = read("src", "components", "admin", "LocationEditor.tsx");
const validation = read("src", "lib", "validation.ts");
const locations = read("src", "lib", "locations.ts");
const publicSerialization = read("scripts", "test-public-location-serialization.cjs");

assert(schema.includes("enum LocationLifecycleStatus"), "schema must separate location lifecycle status");
for (const value of ["ACTIVE", "INACTIVE", "ARCHIVED", "MAINTENANCE"]) {
  assert(schema.includes(value), `LocationLifecycleStatus must include ${value}`);
}
assert(schema.includes("enum LocationAvailabilityOverrideType"), "schema must define manual availability override types");
assert(schema.includes("model LocationAvailabilityOverride"), "schema must include a dedicated manual availability override model");
assert(schema.includes("lifecycleStatus            LocationLifecycleStatus @default(ACTIVE)"), "Location must keep a safe ACTIVE lifecycle default");
assert(schema.includes("availabilityOverrides LocationAvailabilityOverride[]"), "Location must relate to availability overrides");

assert(migration.includes("ADD COLUMN `lifecycleStatus`"), "migration must add lifecycleStatus additively");
assert(migration.includes("CREATE TABLE `portfolio_location_availability_overrides`"), "migration must create override table");
assert(!/\bDROP\b/i.test(migration), "migration must not drop data");
assert(!/MODIFY COLUMN `status`/i.test(migration), "migration must not rewrite legacy Location.status");

assert(overrides.includes("listLocationAvailabilityOverrideConflicts"), "override helper must expose safe conflict listing");
assert(overrides.includes("isMissingAvailabilityOverrideStorage"), "override helper must tolerate missing migration during staged rollout");
assert(overrides.includes("P2021") && overrides.includes("P2022"), "override helper must catch missing table/column Prisma errors");
assert(overrides.includes("legacyManualBlockConflict"), "legacy block fields must remain supported");
assert(overrides.includes("createManualAvailabilityOverride"), "manual block route should be able to create a real override");
assert(overrides.includes("clearManualAvailabilityOverrides"), "manual unblock route should clear active overrides");

assert(selectionAvailability.includes("listLocationAvailabilityOverrideConflicts"), "selector availability must read override conflicts");
assert(selectionAvailability.includes("legacyManualBlockConflict"), "selector availability must include legacy block fields");
assert(selectionAvailability.includes("isManualAvailabilityStatus"), "selector labels should distinguish manual blocks from reservations");
assert(selectionAvailability.includes("current.openEnded || isManualAvailabilityStatus(current.status)"), "open-ended manual blocks must not become fake available-from dates");
assert(selectionAvailability.includes("Blocat din"), "open-ended manual blocks should show a block label, not an artificial availability date");
assert(!selectionAvailability.includes("Locatie blocata: ${location.blockedReason}"), "manual block must not be a duplicate warning beside conflict state");

assert(availability.includes("manualAvailabilityIntervals"), "shared availability calculator must treat manual blocks as occupied intervals");
assert(availability.includes("lifecycleStatus"), "shared availability calculator must understand lifecycle status");
assert(availability.includes("Locatie inactiva"), "inactive lifecycle status should suspend availability");

assert(!blockRoute.includes('status: "UNKNOWN"'), "block route must not abuse UNKNOWN for unavailable locations");
assert(!blockRoute.includes('status: "AVAILABLE"'), "unblock route must not overwrite legacy availability status");
assert(blockRoute.includes("prisma.$transaction"), "block route should update legacy fields and override records atomically");
assert(blockRoute.includes("createManualAvailabilityOverride"), "block route must sync the new override model");
assert(blockRoute.includes("clearManualAvailabilityOverrides"), "unblock route must clear override model entries");

assert(conflictPreview.includes("listLocationAvailabilityOverrideConflicts"), "reservation conflict preview must include manual overrides");
assert(conflictPreview.includes("legacyManualBlockConflict"), "reservation conflict preview must include legacy manual blocks");

assert(editor.includes("Stare locatie"), "location editor must expose lifecycle status separately");
assert(editor.includes("Status disponibilitate vechi"), "legacy status must be labelled as compatibility state");
assert(editor.includes("Statusul vechi ramane pentru compatibilitate"), "editor must warn users about legacy status meaning");
assert(editor.includes("lifecycleStatus"), "editor payload must include lifecycleStatus");
assert(validation.includes("locationLifecycleStatusSchema"), "validation must accept lifecycle status");
assert(locations.includes('"lifecycleStatus"'), "public serializer must remove lifecycleStatus from public DTOs");
assert(publicSerialization.includes('"lifecycleStatus" in visible, false'), "public serialization test must guard lifecycle status privacy");

console.log("Status / availability architecture source checks passed.");
