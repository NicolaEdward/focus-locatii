const { spawnSync } = require('node:child_process');
if (process.env.RUN_REMEDIATION_HISTORY_AUDIT === 'true') {
  const result = spawnSync(process.execPath,[require.resolve('tsx/cli'),'scripts/audit-remediation-history.ts'],{encoding:'utf8',env:process.env,timeout:180000,maxBuffer:1024*1024});
  if (result.status !== 0) {
    // The child already emits a bounded allowlisted error without records.
    console.error(result.stderr || JSON.stringify({event:'remediation_history_inventory',ok:false,code:'INVENTORY_PROCESS_FAILED'}));
    process.exitCode = result.status || 1;
  } else {
    const inventory = JSON.parse(result.stdout);
    console.log(JSON.stringify({event:'remediation_history_inventory',...inventory,aggregates:undefined}));
    for (const aggregate of inventory.aggregates) console.log(JSON.stringify({event:'remediation_history_aggregate',...aggregate}));
  }
} else console.log(JSON.stringify({event:'remediation_history_inventory',skipped:true}));
