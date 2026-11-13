import assert from "node:assert/strict";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { parseSmartBillCustomerInvoices } from "../src/lib/smartbill-import";
import { invoiceNumberComparisonKey } from "../src/lib/clients";
import { receivableAdjustmentEntries, receivableNetAmount } from "../src/lib/receivable-adjustments";
import { executeInvoiceEvidenceOperation, hashInvoiceEvidenceOperation, invoiceEvidenceOperationSchema, verifyInvoiceEvidenceSource, type InvoiceEvidenceOperation, type InvoiceEvidenceExecutionContext } from "../src/lib/invoice-evidence-reconciliation";
loadEnvFile(); assertSyntheticEnvironment();
assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL || "").hostname));
const tag = `invoice-evidence-test-${randomUUID()}`, sequence = `FIX${Date.now()}`;
const sha = (v: string | Buffer) => crypto.createHash("sha256").update(v).digest("hex");
const tax = `8${Date.now().toString().slice(-8)}`, newTax = `7${Date.now().toString().slice(-8)}`;
const ownerId = `${tag}-owner`;
const clientId = `${tag}-client`, uploadId = `${tag}-upload`, invoiceId = `${tag}-invoice`, legacyId = `${tag}-legacy`, inactiveId = `${tag}-inactive`;
let generatedClientId = "";
const createdIds: string[] = [invoiceId, legacyId, inactiveId];
function line(suffix: string, gross: number, paid = false, newClient = false) { return [1, newClient ? "Synthetic New Tax Client" : "Synthetic Existing Tax Client", newClient ? newTax : tax, "", `${sequence}${suffix}`, "01/11/2026", "01/12/2026", paid ? "incasata" : "emisa", "RON", gross * .8, gross * .2, gross, "", "", ""]; }
function workbook() { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Nr. crt.", "Client", "CIF", "Adresa", "Factura", "Data emiterii", "Data scadentei", "Status", "Moneda", "Valoare fara TVA", "Valoare TVA", "Valoare Totala", "Aviz insotire", "Observatii", "Index SPV"], line("01",1000),line("02",500,true),line("03",100,true),line("04",-200),line("05",50),line("06",100,false,true),line("07",200,false,true)]), "Synthetic");return XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer; }
async function counts() { const [invoices,clients,payments,uploads,audits,credits] = await Promise.all([prisma.financialReceivable.count(),prisma.clientAccount.count(),prisma.financialReceivablePayment.count(),prisma.financialReportUpload.count(),prisma.auditLog.count(),prisma.financialClientCredit.count()]); return {invoices,clients,payments,uploads,audits,credits}; }
function expected(row: any): NonNullable<InvoiceEvidenceOperation["expectedTarget"]> { return { id:row.id,updatedAt:row.updatedAt.toISOString(),companyCode:row.companyCode,companyName:row.companyName,legalEntityId:row.legalEntityId,invoiceNumberKey:invoiceNumberComparisonKey(row.invoiceNumber),invoiceDate:row.invoiceDate?.toISOString()||null,currency:row.currency,invoicedAmount:row.invoicedAmount?.toFixed(2)||null,collectedAmount:row.collectedAmount?.toFixed(2)||null,remainingAmount:row.remainingAmount?.toFixed(2)||null,clientId:row.clientId,includedInReport:row.includedInReport,status:row.status,sourceFingerprint:row.sourceFingerprint}; }
async function main() {
 await prisma.user.create({data:{id:ownerId,email:`${tag}@synthetic.test`,name:"Synthetic Portfolio Owner",role:"SALES_AGENT",passwordHash:"unusable-synthetic"}});
 const client=await prisma.clientAccount.create({data:{id:clientId,companyName:"Synthetic Existing Tax Client",normalizedName:tag,taxId:tax,accountOwnerUserId:ownerId}});
 const entity=await prisma.financialLegalEntity.findUniqueOrThrow({where:{code:"FOCUS_MEDIA"}});
 await prisma.financialReportUpload.create({data:{id:uploadId,originalFileName:`${tag}.xlsx`,fileHash:tag,status:"confirmed",activeVersion:false}});
 const common={uploadId,companyName:"Focus Media",companyCode:"FOCUS_MEDIA",legalEntityId:entity.id,clientId,clientName:"Synthetic Existing Tax Client",currency:"RON",invoiceDate:new Date("2026-11-01Z"),dueDate:new Date("2026-12-01Z"),includedInReport:true,needsReview:false,status:"in_term"};
 const raw={smartBillAdjustments:[{adjustmentReceivableId:`${tag}-existing-negative`,adjustmentAmount:200}],fiscalTaxSplitAttestation:{verifiedByUserId:"synthetic-prior-reviewer",evidenceReference:"synthetic-prior-tax-proof"},ledgerProvenance:{source:"prior-verified-ledger"}};
 const target=await prisma.financialReceivable.create({data:{...common,id:invoiceId,invoiceNumber:`${sequence}01`,invoicedAmount:"1000",netAmount:"850",vatAmount:"150",collectedAmount:"150",remainingAmount:"650",rawRowJson:raw}});
 await prisma.financialReceivablePayment.create({data:{receivableId:invoiceId,amount:"150",currency:"RON",receivedAt:new Date("2026-11-02Z"),source:"manual",status:"active"}});
 const legacy=await prisma.financialReceivable.create({data:{...common,id:legacyId,invoiceNumber:`${sequence}02`,invoicedAmount:"500",collectedAmount:"250",remainingAmount:"250"}});
 await prisma.financialReceivable.create({data:{...common,id:inactiveId,invoiceNumber:`${sequence}05`,invoicedAmount:"50",collectedAmount:"0",remainingAmount:"50",includedInReport:false,status:"archived"}});
 const bytes=workbook(),sourceSha256=sha(bytes),fileName=`${tag}-source.xlsx`;
 const verified=await verifyInvoiceEvidenceSource({bytes,fileName,expectedHash:sourceSha256,companyCode:"FOCUS_MEDIA"});
 const parsed=await parseSmartBillCustomerInvoices(bytes,{fileName});
 const clientSpec={strategy:"existing" as const,id:client.id,taxId:tax,updatedAt:client.updatedAt.toISOString(),status:client.status};
 function operation(suffix:string,type:InvoiceEvidenceOperation["type"],target:any=null,newClient=false):InvoiceEvidenceOperation { const row=parsed.rows.find((r:any)=>r.invoiceNumber===`${sequence}${suffix}`)!;return invoiceEvidenceOperationSchema.parse({schemaVersion:1,id:`${tag}-${suffix}`,type,sourceSha256,sourceRowNumber:row.rowNumber,sourceDedupeKey:row.dedupeKey,expectedTarget:target?expected(target):null,client:newClient?{strategy:"create_unassigned",normalizedFiscalCode:newTax}:clientSpec}); }
 const ops=[operation("01","refresh",target),operation("02","refresh",legacy),operation("03","create"),operation("04","negative_unlinked"),operation("06","create",null,true),operation("07","create",null,true)];
 const base={manifestHash:sha(tag),runId:tag,source:verified};
 const context=(op:InvoiceEvidenceOperation,mode:"check"|"apply"):InvoiceEvidenceExecutionContext=>({...base,mode,approvedOperationHash:hashInvoiceEvidenceOperation(op)});
 const before=await counts();for(const op of ops)assert.equal((await executeInvoiceEvidenceOperation(op,context(op,"check"))).applied,false);assert.deepEqual(await counts(),before,"Check mode must perform no DML, including audit/uploads/clients");
 await assert.rejects(verifyInvoiceEvidenceSource({bytes,fileName,expectedHash:"0".repeat(64),companyCode:"FOCUS_MEDIA"}),/SHA-256/);
 await assert.rejects(executeInvoiceEvidenceOperation(ops[0],{...context(ops[0],"check"),source:{...verified}}),/Unverified/);
 await assert.rejects(executeInvoiceEvidenceOperation({...ops[0],sourceRowNumber:999},context(ops[0],"check")),/approval hash/);
 assert.throws(()=>hashInvoiceEvidenceOperation({...ops[0],unexpected:"forbidden"}));
 const inactiveOp=operation("05","create");await assert.rejects(executeInvoiceEvidenceOperation(inactiveOp,context(inactiveOp,"check")),/historical\/excluded/);
 for(const op of ops.slice(0,2))await executeInvoiceEvidenceOperation(op,context(op,"apply"));
 const concurrent=await Promise.all([executeInvoiceEvidenceOperation(ops[2],context(ops[2],"apply")),executeInvoiceEvidenceOperation(ops[2],context(ops[2],"apply"))]);assert.equal(concurrent.filter(r=>r.replay).length,1,"Concurrent identical operations must return one committed result and one replay");
 for(const op of ops.slice(3)){const result=await executeInvoiceEvidenceOperation(op,context(op,"apply"));createdIds.push(result.receivableId!);if("createClient" in result && result.createClient)generatedClientId=result.clientId!;}
 createdIds.push(concurrent[0].receivableId!);
 for(const op of ops)assert.equal((await executeInvoiceEvidenceOperation(op,context(op,"apply"))).replay,true);
 const after=await prisma.financialReceivable.findUniqueOrThrow({where:{id:invoiceId}});assert.equal(receivableNetAmount(after.invoicedAmount,after.rawRowJson).toFixed(2),"800.00");assert.equal(after.collectedAmount?.toFixed(2),"150.00");assert.equal(after.remainingAmount?.toFixed(2),"650.00");assert.equal(after.netAmount?.toFixed(2),"850.00");assert.equal(after.vatAmount?.toFixed(2),"150.00");assert.equal(receivableAdjustmentEntries(after.rawRowJson).length,1);assert.deepEqual((after.rawRowJson as any).ledgerProvenance,raw.ledgerProvenance);assert.equal(after.needsReview,true);
 const legacyAfter=await prisma.financialReceivable.findUniqueOrThrow({where:{id:legacyId}});assert.equal(legacyAfter.collectedAmount?.toFixed(2),"250.00");assert.equal(legacyAfter.remainingAmount?.toFixed(2),"250.00");assert.equal(await prisma.financialReceivablePayment.count({where:{receivableId:legacyId}}),0,"Legacy snapshot collections must not be zeroed or converted into new payments");
 const paid=await prisma.financialReceivable.findFirstOrThrow({where:{invoiceNumber:`${sequence}03`}});assert.equal(paid.collectedAmount?.toFixed(2),"0.00");assert.equal(paid.collectedAt,null);assert.equal(paid.needsReview,true);assert.equal(paid.accountOwnerUserId,ownerId,"New invoices inherit the verified client portfolio without reassigning it");
 const negative=await prisma.financialReceivable.findFirstOrThrow({where:{invoiceNumber:`${sequence}04`}});assert.equal(negative.includedInReport,false);assert.equal(negative.needsReview,true);assert.equal(negative.remainingAmount?.toFixed(2),"0.00");assert.equal(negative.collectedAt,null);assert.equal((negative.rawRowJson as any).adjustmentReview.automaticallyApplied,false);
 assert.equal(await prisma.financialImportIssue.count({where:{uploadId:negative.uploadId,issueType:"SMARTBILL_UNLINKED_ADJUSTMENT"}}),1);
 assert.equal(await prisma.financialImportIssue.count({where:{uploadId:paid.uploadId,issueType:"SMARTBILL_SOURCE_PAID_UNVERIFIED"}}),2);
 const importUpload=await prisma.financialReportUpload.findUniqueOrThrow({where:{id:paid.uploadId}});assert.equal(importUpload.rowsCreated,4);assert.equal(importUpload.rowsUpdated,2);assert.equal(importUpload.warningCount,3);
 assert.equal(await prisma.clientAccount.count({where:{taxId:newTax}}),1);const newClient=await prisma.clientAccount.findUniqueOrThrow({where:{id:generatedClientId}});assert.equal(newClient.accountOwnerUserId,null);
 const events=await prisma.auditLog.findMany({where:{action:"financial.invoice_source_reconciled",metadata:{path:"$.runId",equals:tag}}});assert.equal(events.length,ops.length);assert.ok(events.every(e=>e.userId===null),"System imports cannot impersonate a human");
 const stale={...ops[0],id:`${tag}-stale`};await assert.rejects(executeInvoiceEvidenceOperation(stale,context(stale,"apply")),/guard changed|version or identity changed/);
 const modified={...ops[0],sourceRowNumber:parsed.rows[1].rowNumber,sourceDedupeKey:parsed.rows[1].dedupeKey};await assert.rejects(executeInvoiceEvidenceOperation(modified,context(modified,"apply")),/already used/);
 console.log(JSON.stringify({ok:true,syntheticOnly:true,readOnlyCheck:true,exactSourceHash:true,forgedSourceDenied:true,concurrentReplaySingleEffect:true,sourcePaidNoCash:true,legacyNoLedgerCashPreserved:true,canonicalStornoPreserved:true,fiscalAttestationPreserved:true,negativeUnlinkedNoDebtEffect:true,newClientUnassignedAndDeduplicated:true,systemAuditUserNull:true,staleGuardDenied:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 await prisma.financialReceivablePayment.deleteMany({where:{receivableId:{in:createdIds}}});
 await prisma.financialClientCredit.deleteMany({where:{receivableId:{in:createdIds}}});
 await prisma.financialReceivable.deleteMany({where:{OR:[{id:{in:createdIds}},{invoiceNumber:{startsWith:sequence}}]}});
 await prisma.financialReportUpload.deleteMany({where:{OR:[{id:uploadId},{originalFileName:{startsWith:tag}}]}});
 await prisma.clientAccount.deleteMany({where:{id:{in:[clientId,...(generatedClientId?[generatedClientId]:[])]}}});
 await prisma.auditLog.deleteMany({where:{action:"financial.invoice_source_reconciled",metadata:{path:"$.runId",equals:tag}}});
 await prisma.user.deleteMany({where:{id:ownerId}});
 await prisma.$disconnect();
});
