import { PrismaClient } from "@prisma/client";
import { databaseConnectionUrl } from "../../src/lib/database-connection-policy";
import { assertExportTarget,encryptExport,ExportFailure,validateExportPublicKey } from "./reconciliation-envelope";
import { collectReconciliationSnapshot } from "./reconciliation-snapshot";

async function main() {
  // Approve target and recipient before creating a client or issuing a query.
  const fingerprint=assertExportTarget(process.env);
  validateExportPublicKey(process.env.RECONCILIATION_EXPORT_PUBLIC_KEY);
  const client=new PrismaClient({datasources:{db:{url:databaseConnectionUrl()}},log:[]});
  try {
    const snapshot=await collectReconciliationSnapshot(client,fingerprint);
    const lines=encryptExport(snapshot,process.env.RECONCILIATION_EXPORT_PUBLIC_KEY!,fingerprint);
    for(const line of lines)process.stdout.write(line+"\n");
  } finally { await client.$disconnect(); }
}
main().catch(error=>{
  process.stderr.write(JSON.stringify({event:"reconciliation_export_failed",ok:false,code:error instanceof ExportFailure?error.code:"EXPORT_UNAVAILABLE"})+"\n");
  process.exitCode=1;
});
