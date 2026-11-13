const { spawnSync } = require('node:child_process');
if (process.env.RUN_REMEDIATION_HISTORY_AUDIT === 'true') {
  const result = spawnSync(process.execPath,[require.resolve('tsx/cli'),'scripts/audit-remediation-history.ts'],{stdio:'inherit',env:process.env,timeout:180000});
  if (result.status !== 0) process.exitCode = result.status || 1;
} else console.log(JSON.stringify({event:'remediation_history_inventory',skipped:true}));
