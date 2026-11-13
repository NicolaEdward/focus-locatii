import assert from "node:assert/strict";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { databaseIdentity } from "./release/env-utils";
import { collectReconciliationSnapshot } from "./release/reconciliation-snapshot";
import { decryptExport } from "./release/reconciliation-envelope";
const u=new URL(process.env.DATABASE_URL||"");
assert(["127.0.0.1","localhost"].includes(u.hostname)&&u.pathname==="/focus_preview_reconcile_export"&&process.env.VERCEL_ENV!=="production"&&process.env.APP_ENV!=="production"&&process.env.ALLOW_SYNTHETIC_SEED==="true","Isolated local synthetic export database required");
const db=new PrismaClient({log:[]});const id=`export-test-${crypto.randomUUID()}`;const day=new Date("2026-01-01T00:00:00Z");
async function main(){
 await db.financialLegalEntity.create({data:{id,code:id,legalName:"Synthetic Export Entity",normalizedName:"synthetic export entity"}});
 await db.financialReportUpload.create({data:{id,originalFileName:"synthetic-export.csv",fileHash:id,activeVersion:false,legalEntityId:id}});
 await db.clientAccount.create({data:{id,companyName:"Synthetic Export Client",normalizedName:"synthetic export client",taxId:"TEST12345678",generalEmail:"PRIVATE_CONTACT_MARKER"}});
 await db.financialBankAccount.create({data:{id,legalEntityId:id,ibanOriginal:"RO00SYNTHETICOWNACCOUNT",ibanNormalized:"RO00SYNTHETICOWNACCOUNT",currency:"RON"}});
 await db.financialBankStatement.create({data:{id,uploadId:id,legalEntityId:id,bankAccountId:id,statementFingerprint:id,periodStart:day,periodEnd:day,currency:"RON"}});
 await db.financialBankTransaction.create({data:{id,statementId:id,legalEntityId:id,bankAccountId:id,fingerprint:id,bookedAt:day,currency:"RON",creditAmount:100,description:"PRIVATE_NARRATIVE_MARKER",payerIban:"PRIVATE_COUNTERPARTY_MARKER",classification:"customer_receipt_candidate"}});
 await db.financialReceivable.create({data:{id,uploadId:id,legalEntityId:id,clientId:id,companyName:"Synthetic Export Entity",companyCode:"FOCUS_MEDIA",invoiceNumber:"TEST001",invoicedAmount:100,collectedAmount:30,remainingAmount:50,currency:"RON",status:"cancelled",includedInReport:false,rawRowJson:{normalizedFiscalCode:"TEST12345678",raw:{contact:"PRIVATE_RAW_MARKER"},smartBillAdjustments:[{adjustmentReceivableId:"synthetic-adjustment",adjustmentAmount:20,notes:"PRIVATE_ADJUSTMENT_MARKER"}]}}});
 await db.financialReceivablePayment.create({data:{id,receivableId:id,bankTransactionId:id,amount:30,currency:"RON",receivedAt:day,status:"cancelled",source:"synthetic_export_test",notes:"PRIVATE_PAYMENT_MARKER"}});
 const before=await db.financialReceivable.findUniqueOrThrow({where:{id},select:{updatedAt:true,collectedAmount:true,includedInReport:true}});
 const fp=databaseIdentity().fingerprint;const snapshot=await collectReconciliationSnapshot(db,fp);
 const invoice=snapshot.data.receivables.find(r=>r.id===id)!;
 assert(invoice&&!invoice.includedInReport&&invoice.status==="cancelled");
 assert.equal((invoice.rawRowJson.smartBillAdjustments as any[])[0].adjustmentReceivableId,"synthetic-adjustment");
 assert(snapshot.data.receivablePayments.some(r=>r.id===id&&r.status==="cancelled"));assert(!JSON.stringify(snapshot).includes("PRIVATE_"));
 const keys=crypto.generateKeyPairSync("rsa",{modulusLength:3072,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
 const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),"scripts/release/export-reconciliation.ts"],{env:{...process.env,ALLOW_PRODUCTION_RECONCILIATION_EXPORT:"true",RECONCILIATION_DATABASE_FINGERPRINT:fp,RECONCILIATION_EXPORT_PUBLIC_KEY:keys.publicKey},encoding:"utf8",maxBuffer:16*1024*1024,timeout:90000});
 assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes(id));assert(!result.stdout.includes("PRIVATE_"));
 const decoded=decryptExport(result.stdout.trim().split(/\r?\n/),keys.privateKey);
 assert.equal(decoded.counts.receivables,snapshot.counts.receivables);assert(decoded.data.receivables.some((r:any)=>r.id===id&&!r.includedInReport));
 const after=await db.financialReceivable.findUniqueOrThrow({where:{id},select:{updatedAt:true,collectedAmount:true,includedInReport:true}});assert.deepEqual(after,before);
 const concurrentId=id+"-concurrent";let inserted=false;
 const instrumented=db.$extends({query:{financialReceivable:{async findMany({args,query}){
   if(!inserted){inserted=true;await db.financialReceivable.create({data:{id:concurrentId,uploadId:id,companyName:"Synthetic Export Entity",companyCode:"FOCUS_MEDIA",currency:"RON",includedInReport:false}});}
   return query(args);
 }}}});
 const consistent=await collectReconciliationSnapshot(instrumented as unknown as PrismaClient,fp);
 assert(inserted);assert(!consistent.data.receivables.some(r=>r.id===concurrentId));assert(await db.financialReceivable.findUnique({where:{id:concurrentId}}));
 console.log(JSON.stringify({event:"reconciliation_export_db_test",ok:true,synthetic:true,productionCalls:0,checks:["excluded_cancelled_history","minimized_json","encrypted_child_runner","unchanged_source_rows","repeatable_read_concurrent_insert"]}));
}
main().finally(async()=>{
 await db.financialReceivablePayment.deleteMany({where:{id}});await db.financialReceivable.deleteMany({where:{id:{in:[id,id+"-concurrent"]}}});
 await db.financialBankTransaction.deleteMany({where:{id}});await db.financialBankStatement.deleteMany({where:{id}});await db.financialBankAccount.deleteMany({where:{id}});await db.financialReportUpload.deleteMany({where:{id}});await db.clientAccount.deleteMany({where:{id}});await db.financialLegalEntity.deleteMany({where:{id}});await db.$disconnect();
}).catch(error=>{console.error(error);process.exitCode=1;});
