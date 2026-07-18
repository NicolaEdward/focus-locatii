import { spawnSync } from "child_process";
import path from "path";
import { assertSyntheticEnvironment, loadEnvFile } from "./env-utils";

loadEnvFile();
const identity = assertSyntheticEnvironment();
const prismaCli = require.resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
  cwd: path.resolve(process.cwd()),
  env: process.env,
  stdio: "inherit"
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(JSON.stringify({ ok: true, action: "preview-schema-sync", databaseFingerprint: identity.fingerprint }));
