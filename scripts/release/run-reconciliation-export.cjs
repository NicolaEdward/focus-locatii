const { spawnSync } = require("node:child_process");
if (process.env.RUN_PRODUCTION_RECONCILIATION_EXPORT === "true") {
  const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),"scripts/release/export-reconciliation.ts"],{env:process.env,stdio:"inherit",timeout:180000});
  if(result.status!==0) {
    console.error(JSON.stringify({event:"reconciliation_export_failed",ok:false,code:"EXPORT_PROCESS_FAILED"}));
    process.exitCode=result.status||1;
  }
}
