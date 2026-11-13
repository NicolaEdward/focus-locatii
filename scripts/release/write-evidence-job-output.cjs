// This separate deployment is an execution receipt, never the application.
// It contains no data, source documents, credentials or diagnostic output.
const fs = require('node:fs');
fs.mkdirSync('.evidence-job-output', { recursive: true });
fs.writeFileSync('.evidence-job-output/index.html', '<!doctype html><meta charset="utf-8"><title>Evidence job</title><p>The controlled evidence job completed. This deployment must not be promoted to the application domain.</p>');
console.log(JSON.stringify({ event: 'evidence_job_build', ok: true, applicationDeployment: false, promotionAllowed: false }));
