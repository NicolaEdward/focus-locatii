import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ExportFailure, MAX_PLAINTEXT_BYTES } from "./reconciliation-envelope";

const caps = { legalEntities:20, bankAccounts:100, bankStatements:2000, bankTransactions:5000, receivables:10000, receivablePayments:20000, payablePayments:20000, clientCredits:10000, fiscalAttestationEvents:10000, clients:5000, campaigns:5000, reservations:10000, locations:5000, rentalPriceSegments:20000, rentalChangeLogs:20000 } as const;
export const RECEIVABLE_SELECT = {
  id:true,uploadId:true,companyCode:true,companyName:true,legalEntityId:true,invoiceNumber:true,normalizedInvoiceNumber:true,invoiceDate:true,dueDate:true,clientId:true,clientName:true,accountOwnerUserId:true,campaignId:true,currency:true,invoicedAmount:true,netAmount:true,vatAmount:true,collectedAmount:true,remainingAmount:true,collectedAt:true,sourceStatus:true,status:true,includedInReport:true,needsReview:true,sourceFingerprint:true,canonicalKey:true,sourceExternalId:true,rowType:true,createdAt:true,updatedAt:true,lastReportDate:true,lastImportedAt:true,rawRowJson:true,
  client:{select:{taxId:true,normalizedName:true}},_count:{select:{campaignAllocations:{where:{status:"active"}}}}
} satisfies Prisma.FinancialReceivableSelect;
export const BANK_TRANSACTION_SELECT = {id:true,statementId:true,legalEntityId:true,bankAccountId:true,fingerprint:true,bankReference:true,documentReference:true,bookedAt:true,valueDate:true,currency:true,debitAmount:true,creditAmount:true,classification:true,reconciliationStatus:true,updatedAt:true} satisfies Prisma.FinancialBankTransactionSelect;
const metadataScalarKeys = ["source","companyCode","companyName","fiscalCode","normalizedFiscalCode","normalizedClientFiscalCode","smartBillDedupeKey","smartBillReportKind","sourceStatus","rowNumber","netAmount","vatAmount","totalAmount","spvIndex","taxSplitSource","taxSplitVerifiedAt","taxSplitVerifiedByUserId","originalReceivableId","originalInvoiceNumber"];
const adjustmentKeys = ["adjustmentReceivableId","smartBillDedupeKey","adjustmentInvoiceNumber","adjustmentAmount","remainingAmountAfterAdjustment","kind","linkedReceivableId","linkedInvoiceNumber","appliedToRemainingAmount","appliedAt","appliedByUserId"];
function object(value: unknown): Record<string,unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {}; }
function pickScalars(value: unknown, keys: string[]) {
  const source = object(value); const result: Record<string,unknown> = {};
  for (const key of keys) {
    const item=source[key];
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (typeof item === "string" && item.length > 4096) throw new ExportFailure("EXPORT_METADATA_LIMIT");
      result[key]=item;
    }
  }
  return result;
}
export function minimizedReceivableMetadata(raw: unknown) {
  const source=object(raw);const result=pickScalars(source,metadataScalarKeys);
  if (Array.isArray(source.smartBillAdjustments)) {
    if (source.smartBillAdjustments.length > 1000) throw new ExportFailure("EXPORT_METADATA_LIMIT");
    result.smartBillAdjustments=source.smartBillAdjustments.map(a=>pickScalars(a,adjustmentKeys));
  }
  if (source.smartBillAdjustment) result.smartBillAdjustment=pickScalars(source.smartBillAdjustment,adjustmentKeys);
  if (source.fiscalTaxSplitAttestation) {
    const attestation=object(source.fiscalTaxSplitAttestation);
    result.fiscalTaxSplitAttestation={
      ...pickScalars(attestation,["verifiedByUserId","verifiedAt","netAmount","vatAmount","grossAmount"]),
      protected:Boolean(attestation.verifiedByUserId&&attestation.evidenceReference),
      ...(typeof attestation.evidenceReference==="string"?{evidenceHash:crypto.createHash("sha256").update(attestation.evidenceReference).digest("hex")}:{}),
    };
  }
  if(source.sourceFiscalReview===null)result.sourceFiscalReview=null;
  else if(source.sourceFiscalReview)result.sourceFiscalReview=pickScalars(source.sourceFiscalReview,["status","sourceNetAmount","sourceVatAmount","preservedNetAmount","preservedVatAmount"]);
  // Raw imported spreadsheet contents, notes and contact fields are intentionally omitted.
  return result;
}
function bounded<T>(name: keyof typeof caps, rows:T[]) { if(rows.length>caps[name])throw new ExportFailure("EXPORT_ROW_CAP");return rows; }

export async function collectReconciliationSnapshot(client: PrismaClient, databaseFingerprint: string) {
  return client.$transaction(async tx => {
    const legalEntities=bounded("legalEntities",await tx.financialLegalEntity.findMany({select:{id:true,code:true,taxIdNormalized:true,active:true},orderBy:{id:"asc"},take:caps.legalEntities+1}));
    const bankAccounts=bounded("bankAccounts",await tx.financialBankAccount.findMany({select:{id:true,legalEntityId:true,ibanNormalized:true,currency:true,bankName:true,accountLabel:true,active:true,updatedAt:true},orderBy:{id:"asc"},take:caps.bankAccounts+1}));
    const bankStatements=bounded("bankStatements",await tx.financialBankStatement.findMany({select:{id:true,uploadId:true,legalEntityId:true,bankAccountId:true,statementFingerprint:true,periodStart:true,periodEnd:true,currency:true,openingBalance:true,closingBalance:true,status:true},orderBy:{id:"asc"},take:caps.bankStatements+1}));
    const bankTransactions=bounded("bankTransactions",await tx.financialBankTransaction.findMany({select:BANK_TRANSACTION_SELECT,orderBy:{id:"asc"},take:caps.bankTransactions+1}));
    // No active-report/status/date filter: excluded, cancelled, historical and previous uploads remain visible.
    const rawReceivables=bounded("receivables",await tx.financialReceivable.findMany({select:RECEIVABLE_SELECT,orderBy:{id:"asc"},take:caps.receivables+1}));
    const receivables=rawReceivables.map(r=>({...r,rawRowJson:minimizedReceivableMetadata(r.rawRowJson)}));
    const receivablePayments=bounded("receivablePayments",await tx.financialReceivablePayment.findMany({select:{id:true,receivableId:true,sourceImportRowId:true,bankTransactionId:true,requestKey:true,amount:true,currency:true,receivedAt:true,paymentReference:true,status:true,source:true,verificationStatus:true,correctsPaymentId:true,cancelledAt:true,createdAt:true,updatedAt:true},orderBy:{id:"asc"},take:caps.receivablePayments+1}));
    const payablePayments=bounded("payablePayments",await tx.financialPayablePayment.findMany({select:{id:true,payableId:true,bankTransactionId:true,requestKey:true,amount:true,currency:true,paidAt:true,paymentReference:true,status:true,source:true,verificationStatus:true,replacesPaymentId:true,cancelledAt:true,createdAt:true,updatedAt:true},orderBy:{id:"asc"},take:caps.payablePayments+1}));
    const clientCredits=bounded("clientCredits",await tx.financialClientCredit.findMany({select:{id:true,clientId:true,receivableId:true,sourcePaymentId:true,companyCode:true,currency:true,amount:true,remainingAmount:true,status:true,createdAt:true,updatedAt:true},orderBy:{id:"asc"},take:caps.clientCredits+1}));
    const fiscalAttestationEvents=bounded("fiscalAttestationEvents",await tx.auditLog.findMany({where:{entityType:"financial_receivable",action:"financial.invoice_tax_split_attested"},select:{id:true,entityId:true,action:true,createdAt:true},orderBy:{id:"asc"},take:caps.fiscalAttestationEvents+1}));
    const clients=bounded("clients",await tx.clientAccount.findMany({select:{id:true,taxId:true,companyName:true,normalizedName:true,accountOwnerUserId:true,status:true,mergedIntoClientId:true,updatedAt:true},orderBy:{id:"asc"},take:caps.clients+1}));
    const campaigns=bounded("campaigns",await tx.campaign.findMany({select:{id:true,clientId:true,campaignName:true,currency:true,status:true,companyEntity:true,totalContractValue:true,billingFrequency:true,paymentTermType:true,paymentTermDays:true,billingRule:true,accountOwnerUserId:true,sellerUserId:true,startDate:true,endDate:true,archivedAt:true,createdAt:true,updatedAt:true},orderBy:{id:"asc"},take:caps.campaigns+1}));
    const reservations=bounded("reservations",await tx.reservation.findMany({select:{id:true,locationId:true,clientId:true,clientName:true,clientCompany:true,campaignId:true,campaignName:true,ownerId:true,sellerUserId:true,bookedAt:true,status:true,periodStart:true,periodEnd:true,holdExpiresAt:true,createdAt:true,updatedAt:true,contractNumber:true,contractCompany:true,contractGroupId:true,currency:true,monthlyRentShare:true,monthlyRentTotal:true,amount:true,paymentTermType:true,paymentTermDays:true,billingRule:true,billingDayOfMonth:true,billingFrequency:true,nextInvoiceDate:true},orderBy:{id:"asc"},take:caps.reservations+1}));
    const locations=bounded("locations",await tx.location.findMany({select:{id:true,code:true,city:true,address:true,type:true,lifecycleStatus:true,status:true,updatedAt:true},orderBy:{id:"asc"},take:caps.locations+1}));
    const rentalPriceSegments=bounded("rentalPriceSegments",await tx.rentalPriceSegment.findMany({select:{id:true,rentalId:true,effectiveFrom:true,effectiveTo:true,monthlyRent:true,currency:true,createdAt:true},orderBy:{id:"asc"},take:caps.rentalPriceSegments+1}));
    const rentalChangeLogs=bounded("rentalChangeLogs",await tx.rentalChangeLog.findMany({select:{id:true,rentalId:true,action:true,createdAt:true},orderBy:{id:"asc"},take:caps.rentalChangeLogs+1}));
    const data={legalEntities,bankAccounts,bankStatements,bankTransactions,receivables,receivablePayments,payablePayments,clientCredits,fiscalAttestationEvents,clients,campaigns,reservations,locations,rentalPriceSegments,rentalChangeLogs};
    const result={schemaVersion:1,readOnly:true,isolation:"RepeatableRead",databaseFingerprint,generatedAt:new Date().toISOString(),counts:Object.fromEntries(Object.entries(data).map(([name,rows])=>[name,rows.length])),caps,data};
    if(Buffer.byteLength(JSON.stringify(result))>MAX_PLAINTEXT_BYTES)throw new ExportFailure("EXPORT_PAYLOAD_LIMIT");
    return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:60000});
}
