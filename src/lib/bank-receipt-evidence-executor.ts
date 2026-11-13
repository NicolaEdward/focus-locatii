import { Prisma } from "@prisma/client";
import { z } from "zod";
import { invoiceNumberComparisonKey } from "@/lib/clients";
import { canonicalTaxId } from "@/lib/tax-id";
import { financialRequestFingerprint } from "@/lib/financial-request-intent";
import { receivableAdjustmentEntries, receivableNetAmount } from "@/lib/receivable-adjustments";
import { activeReceivablePaymentTotal, synchronizeReceivableLedger } from "@/lib/receivables-payment-service";
import { activeBankAllocationTotal, synchronizeBankTransaction } from "@/lib/financial-bank-ledger";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { isReceiptBankSource,isReceiptInvoiceSource,proveReceiptEvidence,receiptAssert,type ReceiptBankSource,type ReceiptInvoiceSource } from "@/lib/bank-receipt-evidence";

const sha=z.string().regex(/^[a-f0-9]{64}$/), id=z.string().min(1).max(191), time=z.string().datetime({offset:true}), money=z.string().regex(/^\d{1,14}\.\d{2}$/);
const base=z.object({
  operationId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),companyCode:z.enum(["FOCUS_MEDIA","EXCELLENCE_MEDIA"]),bankSourceHash:sha,invoiceSourceHash:sha,invoiceIssuerBinding:z.literal("owner-approved-source-sha256"),
  bankEvidence:z.object({rowNumber:z.number().int().positive(),fingerprint:sha}).strict(),
  invoiceEvidence:z.object({rowNumber:z.number().int().positive(),dedupeKey:z.string().min(1).max(512)}).strict(),
  amount:money,
  expectedAccount:z.object({id,legalEntityId:id,ibanNormalized:z.string().min(1).max(512),currency:z.enum(["RON","EUR"]),updatedAt:time}).strict(),
  expectedBank:z.object({id,updatedAt:time,fingerprint:sha}).strict(),
  expectedInvoice:z.object({id,updatedAt:time,clientId:id,clientUpdatedAt:time,invoiceComparisonKey:z.string().regex(/^[a-z]+\d+$/),grossAmount:money,collectedAmount:money,remainingAmount:money,netAfterAdjustments:money,ledgerHash:sha,adjustmentsHash:sha}).strict(),
}).strict();
export const bankReceiptOperationSchema=z.discriminatedUnion("kind",[
  base.extend({kind:z.literal("bank.receipt-create")}).strict(),
  base.extend({kind:z.literal("bank.receipt-link-existing"),expectedPayment:z.object({id,updatedAt:time,source:z.literal("report_import"),receivedAt:time,requestKey:z.string().nullable(),sourceImportRowId:id,sourceRowHash:sha}).strict()} ).strict(),
]);
export type BankReceiptOperation=z.infer<typeof bankReceiptOperationSchema>;
export const hashBankReceiptOperation=(input:BankReceiptOperation)=>financialRequestFingerprint(bankReceiptOperationSchema.parse(input));
export const bankReceiptTransactionOptions={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:60000} as const;
const contextSchema=z.object({mode:z.enum(["check","apply"]),manifestHash:sha,approvedOperationHash:sha,runId:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),bankSource:z.custom<ReceiptBankSource>(isReceiptBankSource),invoiceSource:z.custom<ReceiptInvoiceSource>(isReceiptInvoiceSource)}).strict();
export type BankReceiptContext=z.infer<typeof contextSchema>;
function raw(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}};
const iso=(value:Date|string)=>new Date(value).toISOString();
const decimal=(value:Prisma.Decimal.Value|null|undefined)=>new Prisma.Decimal(value||0);
export function hashReceiptLedgerState(rows:readonly {id:string;amount:Prisma.Decimal.Value;currency:string;status:string;source:string;bankTransactionId:string|null;receivedAt:Date|string;updatedAt:Date|string;requestKey:string|null}[]){
 return financialRequestFingerprint({payments:rows.map(p=>({id:p.id,amount:decimal(p.amount).toFixed(2),currency:p.currency,status:p.status,source:p.source,bankTransactionId:p.bankTransactionId,receivedAt:iso(p.receivedAt),updatedAt:iso(p.updatedAt),requestKey:p.requestKey})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function hashReceiptAdjustmentState(value:unknown){return financialRequestFingerprint({adjustments:receivableAdjustmentEntries(value).map(e=>({key:e.key,id:e.receivableId,amount:e.amount.toFixed(2)})).sort((a,b)=>a.key.localeCompare(b.key))});}
export function hashReceiptImportRowState(row:{id:string;updatedAt:Date|string;sourceHash:string;uploadId:string;receivableId:string|null;clientId:string|null;companyCode:string;normalizedInvoiceNumber:string|null;currency:string|null;invoiceAmount:Prisma.Decimal.Value|null;reportCollectedAmount:Prisma.Decimal.Value|null;reportRemainingAmount:Prisma.Decimal.Value|null;upload:{fileHash:string;reportDate:Date|string|null}}){
 return financialRequestFingerprint({id:row.id,updatedAt:iso(row.updatedAt),sourceHash:row.sourceHash,uploadId:row.uploadId,receivableId:row.receivableId,clientId:row.clientId,companyCode:row.companyCode,normalizedInvoiceNumber:row.normalizedInvoiceNumber,currency:row.currency,invoiceAmount:decimal(row.invoiceAmount).toFixed(2),reportCollectedAmount:decimal(row.reportCollectedAmount).toFixed(2),reportRemainingAmount:decimal(row.reportRemainingAmount).toFixed(2),upload:{fileHash:row.upload.fileHash,reportDate:row.upload.reportDate?iso(row.upload.reportDate):null}});
}
function fiscal(row:{rawRowJson:unknown;client?:{taxId:string|null}|null}){const r=raw(row.rawRowJson);return canonicalTaxId(row.client?.taxId||String(r.normalizedFiscalCode||r.normalizedClientFiscalCode||r.fiscalCode||""));}

/** Only a reciprocal stored adjustment link proves a same-party credit note belongs elsewhere. */
async function verifyNegativeDocuments(tx:Prisma.TransactionClient,op:BankReceiptOperation,proof:ReturnType<typeof proveReceiptEvidence>){
 const rows=await tx.financialReceivable.findMany({where:{companyCode:op.companyCode,currency:op.expectedAccount.currency,invoicedAmount:{lt:0}},include:{client:{select:{taxId:true}}},take:2001});
 receiptAssert(rows.length<=2000,"RECEIPT_NEGATIVE_CHECK_LIMIT");
 receiptAssert(rows.every(r=>Boolean(fiscal(r))),"RECEIPT_NEGATIVE_FISCAL_UNVERIFIED");
 const relevant=rows.filter(r=>fiscal(r)===proof.taxId);
 for(const source of proof.samePartyNegativeRows){
  const matching=relevant.filter(r=>invoiceNumberComparisonKey(r.invoiceNumber||r.normalizedInvoiceNumber)===invoiceNumberComparisonKey(source.invoiceNumber)&&decimal(r.invoicedAmount).equals(source.totalAmount));
  receiptAssert(matching.length===1,"RECEIPT_UNLINKED_SOURCE_NEGATIVE");
 }
 for(const negative of relevant){
  const linked=raw(raw(negative.rawRowJson).smartBillAdjustment).linkedReceivableId;
  receiptAssert(typeof linked==="string"&&linked!==negative.id,"RECEIPT_UNLINKED_NEGATIVE");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_receivables WHERE id = ${linked} FOR UPDATE`);
  const parent=await tx.financialReceivable.findUnique({where:{id:linked},include:{client:{select:{taxId:true}}}});
  receiptAssert(parent&&parent.companyCode===op.companyCode&&parent.currency===op.expectedAccount.currency&&decimal(parent.invoicedAmount).gt(0)&&fiscal(parent)===proof.taxId,"RECEIPT_NEGATIVE_LINK_SCOPE");
  const entries=receivableAdjustmentEntries(parent.rawRowJson).filter(a=>a.receivableId===negative.id);
  receiptAssert(entries.length===1&&entries[0].amount.equals(decimal(negative.invoicedAmount).abs()),"RECEIPT_NEGATIVE_LINK_NOT_RECIPROCAL");
 }
}

export async function applyBankReceiptEvidenceOperation(tx:Prisma.TransactionClient,input:BankReceiptOperation,execution:BankReceiptContext){
 receiptAssert(typeof(tx as unknown as {$transaction?:unknown}).$transaction!=="function","RECEIPT_TRANSACTION_REQUIRED");
 const op=bankReceiptOperationSchema.parse(input),context=contextSchema.parse(execution),operationHash=hashBankReceiptOperation(op);
 receiptAssert(operationHash===context.approvedOperationHash,"RECEIPT_OPERATION_NOT_APPROVED");
 const proof=proveReceiptEvidence({bankSource:context.bankSource,invoiceSource:context.invoiceSource,companyCode:op.companyCode,bankSourceHash:op.bankSourceHash,invoiceSourceHash:op.invoiceSourceHash,bankRowNumber:op.bankEvidence.rowNumber,bankFingerprint:op.bankEvidence.fingerprint,invoiceRowNumber:op.invoiceEvidence.rowNumber,invoiceDedupeKey:op.invoiceEvidence.dedupeKey});
 receiptAssert(proof.account.storageIdentifier===op.expectedAccount.ibanNormalized&&proof.account.currency===op.expectedAccount.currency&&proof.bankRow.fingerprint===op.expectedBank.fingerprint&&op.bankEvidence.fingerprint===op.expectedBank.fingerprint&&decimal(op.amount).equals(proof.bankRow.creditAmount)&&decimal(op.amount).gt(0),"RECEIPT_APPROVED_SOURCE_MISMATCH");
 receiptAssert(proof.invoiceKey===op.expectedInvoice.invoiceComparisonKey&&decimal(op.expectedInvoice.grossAmount).equals(proof.invoice.totalAmount),"RECEIPT_APPROVED_INVOICE_MISMATCH");
 // Lock before the first consistent read; Serializable range locks below prevent
 // an unlinked credit note being inserted between validation and cash creation.
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_legal_entities WHERE id = ${op.expectedAccount.legalEntityId} FOR UPDATE`);
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_bank_accounts WHERE id = ${op.expectedAccount.id} FOR UPDATE`);
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_bank_transactions WHERE id = ${op.expectedBank.id} FOR UPDATE`);
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_client_accounts WHERE id = ${op.expectedInvoice.clientId} FOR UPDATE`);
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_receivables WHERE companyCode = ${op.companyCode} AND currency = ${op.expectedAccount.currency} ORDER BY id FOR UPDATE`);
 const intentKey=`receipt-evidence:${financialRequestFingerprint({kind:op.kind,bankId:op.expectedBank.id,invoiceId:op.expectedInvoice.id})}`;
 const receipt=await tx.auditLog.findFirst({where:{action:"financial.bank_receipt_evidence.committed",entityType:"bank_receipt_evidence",entityId:intentKey}});
 if(receipt){receiptAssert(raw(receipt.metadata).operationHash===operationHash,"RECEIPT_INTENT_CONFLICT");return{applied:false,replay:true,createdPayments:0,linkedPayments:0,wouldCreate:0,wouldLink:0};}
 const account=await tx.financialBankAccount.findUnique({where:{id:op.expectedAccount.id},include:{legalEntity:true}});
 receiptAssert(account&&account.active&&account.legalEntity.active&&account.legalEntity.code===op.companyCode&&account.legalEntityId===op.expectedAccount.legalEntityId&&account.ibanNormalized===op.expectedAccount.ibanNormalized&&account.currency===op.expectedAccount.currency&&iso(account.updatedAt)===iso(op.expectedAccount.updatedAt),"RECEIPT_ACCOUNT_DRIFT");
 const bank=await tx.financialBankTransaction.findUnique({where:{id:op.expectedBank.id}});
 receiptAssert(bank&&iso(bank.updatedAt)===iso(op.expectedBank.updatedAt)&&bank.fingerprint===op.expectedBank.fingerprint&&bank.bankAccountId===account.id&&bank.legalEntityId===account.legalEntityId&&bank.currency===account.currency&&bank.creditAmount.equals(proof.bankRow.creditAmount)&&bank.debitAmount.equals(0)&&bank.bookedAt.getTime()===proof.bankRow.bookedAt.getTime()&&bank.bankReference===proof.bankRow.bankReference&&bank.classification==="customer_receipt_candidate"&&bank.reconciliationStatus==="unmatched","RECEIPT_BANK_DRIFT");
 const invoice=await tx.financialReceivable.findUnique({where:{id:op.expectedInvoice.id},include:{client:true}});
 receiptAssert(invoice&&invoice.includedInReport&&!invoice.needsReview&&!['cancelled','archived','excluded'].includes(invoice.status)&&iso(invoice.updatedAt)===iso(op.expectedInvoice.updatedAt)&&invoice.clientId===op.expectedInvoice.clientId&&invoice.client&&iso(invoice.client.updatedAt)===iso(op.expectedInvoice.clientUpdatedAt)&&invoice.companyCode===op.companyCode&&invoice.legalEntityId===account.legalEntityId&&invoice.currency===bank.currency&&invoiceNumberComparisonKey(invoice.invoiceNumber||invoice.normalizedInvoiceNumber)===proof.invoiceKey&&invoice.invoiceDate&&invoice.invoiceDate.getTime()===proof.invoice.issueDate!.getTime()&&canonicalTaxId(invoice.client.taxId)===proof.taxId&&fiscal(invoice)===proof.taxId,"RECEIPT_INVOICE_DRIFT");
 receiptAssert(decimal(invoice.invoicedAmount).equals(op.expectedInvoice.grossAmount)&&decimal(invoice.collectedAmount).equals(op.expectedInvoice.collectedAmount)&&decimal(invoice.remainingAmount).equals(op.expectedInvoice.remainingAmount),"RECEIPT_INVOICE_BALANCE_DRIFT");
 const scope=await tx.financialReceivable.findMany({where:{companyCode:op.companyCode,currency:bank.currency},select:{id:true,invoiceNumber:true,normalizedInvoiceNumber:true},take:2001});
 receiptAssert(scope.length<=2000,"RECEIPT_IDENTITY_CHECK_LIMIT");
 receiptAssert(scope.filter(r=>invoiceNumberComparisonKey(r.invoiceNumber||r.normalizedInvoiceNumber)===proof.invoiceKey).length===1,"RECEIPT_DATABASE_INVOICE_AMBIGUOUS");
 const originalFiscal=canonicalTaxId(String(raw(invoice.rawRowJson).normalizedFiscalCode||raw(invoice.rawRowJson).normalizedClientFiscalCode||raw(invoice.rawRowJson).fiscalCode||""));
 receiptAssert(!originalFiscal||originalFiscal===proof.taxId,"RECEIPT_INVOICE_FISCAL_CONFLICT");
 const payments=await tx.financialReceivablePayment.findMany({where:{receivableId:invoice.id},orderBy:{id:"asc"},take:1001});
 receiptAssert(payments.length<=1000,"RECEIPT_PAYMENT_CHECK_LIMIT");
 receiptAssert(hashReceiptLedgerState(payments)===op.expectedInvoice.ledgerHash&&hashReceiptAdjustmentState(invoice.rawRowJson)===op.expectedInvoice.adjustmentsHash,"RECEIPT_LEDGER_DRIFT");
 await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_receivables WHERE companyCode = ${op.companyCode} AND currency = ${bank.currency} AND invoicedAmount < 0 ORDER BY id FOR UPDATE`);
 await verifyNegativeDocuments(tx,op,proof);
 const net=receivableNetAmount(invoice.invoicedAmount,invoice.rawRowJson),collected=await activeReceivablePaymentTotal(tx,invoice.id),available=bank.creditAmount.minus(await activeBankAllocationTotal(tx,bank.id));
 receiptAssert(net.equals(op.expectedInvoice.netAfterAdjustments)&&net.gt(0)&&available.gte(op.amount),"RECEIPT_CAPACITY_OR_NET_DRIFT");
 receiptAssert(collected.equals(decimal(invoice.collectedAmount))&&Prisma.Decimal.max(net.minus(collected),0).equals(decimal(invoice.remainingAmount)),"RECEIPT_LEGACY_CASH_OR_SNAPSHOT_MISMATCH");
 const requestKey=`receipt-evidence-${operationHash}`;
 let linkPayment:typeof payments[number]|undefined;
 if(op.kind==="bank.receipt-create"){
  receiptAssert(collected.equals(0)&&decimal(invoice.collectedAmount).equals(0)&&payments.every(p=>p.status!=="active")&&net.minus(collected).gte(op.amount),"RECEIPT_EXISTING_CASH_OR_OVERPAYMENT");
  receiptAssert(!(await tx.financialReceivablePayment.findUnique({where:{requestKey}})),"RECEIPT_PAYMENT_WITHOUT_RECEIPT");
 }else{
  linkPayment=payments.find(p=>p.id===op.expectedPayment.id);
  receiptAssert(linkPayment&&linkPayment.status==="active"&&linkPayment.bankTransactionId===null&&linkPayment.source===op.expectedPayment.source&&iso(linkPayment.updatedAt)===iso(op.expectedPayment.updatedAt)&&iso(linkPayment.receivedAt)===iso(op.expectedPayment.receivedAt)&&linkPayment.requestKey===op.expectedPayment.requestKey&&linkPayment.amount.equals(op.amount)&&linkPayment.currency===bank.currency&&collected.lte(net)&&linkPayment.sourceImportRowId===op.expectedPayment.sourceImportRowId,"RECEIPT_IMPORTED_PAYMENT_DRIFT");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM portfolio_financial_receivable_import_rows WHERE id = ${op.expectedPayment.sourceImportRowId} FOR UPDATE`);
  const imported=await tx.financialReceivableImportRow.findUnique({where:{id:op.expectedPayment.sourceImportRowId},include:{upload:{select:{fileHash:true,reportDate:true}}}});
  receiptAssert(imported&&hashReceiptImportRowState(imported)===op.expectedPayment.sourceRowHash&&imported.receivableId===invoice.id&&imported.clientId===invoice.clientId&&imported.companyCode===op.companyCode&&imported.currency===bank.currency&&invoiceNumberComparisonKey(imported.normalizedInvoiceNumber||imported.rawInvoiceNumber)===proof.invoiceKey&&decimal(imported.invoiceAmount).equals(invoice.invoicedAmount||0)&&decimal(imported.reportCollectedAmount).equals(op.amount)&&decimal(imported.reportRemainingAmount).equals(0)&&imported.upload.reportDate&&bank.bookedAt<=imported.upload.reportDate&&bank.bookedAt<=linkPayment.receivedAt,"RECEIPT_IMPORTED_SOURCE_OR_CUTOFF_MISMATCH");
 }
 if(context.mode==="check")return{applied:false,replay:false,createdPayments:0,linkedPayments:0,wouldCreate:op.kind==="bank.receipt-create"?1:0,wouldLink:op.kind==="bank.receipt-link-existing"?1:0};
 let paymentId:string;
 if(op.kind==="bank.receipt-create"){
  const payment=await tx.financialReceivablePayment.create({data:{id:`receipt-evidence-${operationHash}`,receivableId:invoice.id,bankTransactionId:bank.id,requestKey,amount:new Prisma.Decimal(op.amount),currency:bank.currency,receivedAt:bank.bookedAt,paymentMethod:"bank_transfer",paymentReference:bank.bankReference||bank.documentReference,source:"bank_reconciliation",verificationStatus:"verified",createdByUserId:null}});paymentId=payment.id;
 }else{
  paymentId=linkPayment!.id;
  await tx.financialReceivablePayment.update({where:{id:paymentId},data:{bankTransactionId:bank.id}});
 }
 await synchronizeReceivableLedger(tx,invoice.id);await synchronizeBankTransaction(tx,bank.id);
 if(op.kind==="bank.receipt-link-existing"){
  const after=await tx.financialReceivable.findUniqueOrThrow({where:{id:invoice.id}});
  receiptAssert(decimal(after.collectedAmount).equals(collected)&&decimal(after.remainingAmount).equals(invoice.remainingAmount||0),"RECEIPT_LINK_CHANGED_CASH");
 }
 await recordTransactionalAudit(tx,{actor:null,action:"financial.bank_receipt_evidence.committed",entityType:"bank_receipt_evidence",entityId:intentKey,correlationId:context.runId,metadata:{actorKind:"SYSTEM",systemName:"bank-receipt-evidence",manifestHash:context.manifestHash,operationHash,operationId:op.operationId,bankSourceHash:op.bankSourceHash,invoiceSourceHash:op.invoiceSourceHash,bankFingerprint:bank.fingerprint,bankTransactionId:bank.id,receivableId:invoice.id,paymentId,amount:op.amount,currency:bank.currency,action:op.kind,payerBasis:proof.payerBasis,collectedBefore:collected.toFixed(2),collectedDelta:op.kind==="bank.receipt-create"?op.amount:"0.00"}});
 return{applied:true,replay:false,createdPayments:op.kind==="bank.receipt-create"?1:0,linkedPayments:op.kind==="bank.receipt-link-existing"?1:0,wouldCreate:0,wouldLink:0};
}
