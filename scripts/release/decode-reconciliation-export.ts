import fs from "node:fs";
import { decryptExport,ExportFailure } from "./reconciliation-envelope";

try {
  if(process.env.VERCEL || process.env.VERCEL_ENV === "production")throw new ExportFailure("EXPORT_DECODE_LOCAL_ONLY");
  const [logFile,keyFile,outputFile,runId]=process.argv.slice(2);
  if(!logFile||!keyFile||!outputFile)throw new ExportFailure("EXPORT_DECODE_ARGUMENTS");
  if(fs.statSync(logFile).size>128*1024*1024)throw new ExportFailure("EXPORT_LOG_LIMIT");
  const keyStat=fs.statSync(keyFile);
  if((keyStat.mode&0o077)!==0)throw new ExportFailure("EXPORT_PRIVATE_KEY_PERMISSIONS");
  const snapshot=decryptExport(fs.readFileSync(logFile,"utf8").split(/\r?\n/),fs.readFileSync(keyFile,"utf8"),runId);
  fs.writeFileSync(outputFile,JSON.stringify(snapshot,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({event:"reconciliation_export_decoded",ok:true,readOnly:snapshot.readOnly,counts:snapshot.counts}));
} catch(error) {
  console.error(JSON.stringify({event:"reconciliation_export_decode_failed",ok:false,code:error instanceof ExportFailure?error.code:"EXPORT_DECODE_UNAVAILABLE"}));
  process.exitCode=1;
}
