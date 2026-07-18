const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const [, , beforeFile, afterFile] = process.argv;
if (!beforeFile || !afterFile) {
  console.error("Usage: pnpm run release:compare-snapshots <before.json> <after.json>");
  process.exit(1);
}

const before = JSON.parse(readFileSync(resolve(process.cwd(), beforeFile), "utf8"));
const after = JSON.parse(readFileSync(resolve(process.cwd(), afterFile), "utf8"));

if (before.databaseFingerprint !== after.databaseFingerprint) {
  throw new Error("Snapshots belong to different databases.");
}
if (JSON.stringify(before.counts) !== JSON.stringify(after.counts)) {
  throw new Error(`Sensitive counts changed: ${JSON.stringify({ before: before.counts, after: after.counts })}`);
}

console.log(JSON.stringify({ ok: true, databaseFingerprint: before.databaseFingerprint, counts: after.counts }, null, 2));
