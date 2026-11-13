import type { FinancialReceivable, Prisma } from "@prisma/client";
import type { smartBillCustomerReceivableData, smartBillSupplierPayableData } from "@/lib/smartbill-import";
import { mergeSmartBillSourceMetadata } from "@/lib/smartbill-source-metadata";

/** Metadata-only refresh data. This helper never creates cash or runs payment rules.
 * Caller must lock/reload the invoice and verify company, identity and expected
 * version in the same transaction before applying this data and auditing it. */
export async function prepareSmartBillReceivableRefresh(
  tx: Prisma.TransactionClient,
  current: Pick<FinancialReceivable, "id" | "rawRowJson" | "netAmount" | "vatAmount">,
  incoming: Parameters<typeof smartBillReceivableUpdateData>[0]
): Promise<Prisma.FinancialReceivableUpdateInput> {
  const raw = current.rawRowJson && typeof current.rawRowJson === "object" && !Array.isArray(current.rawRowJson)
    ? current.rawRowJson as Record<string, unknown> : {};
  const attestation = raw.fiscalTaxSplitAttestation && typeof raw.fiscalTaxSplitAttestation === "object" && !Array.isArray(raw.fiscalTaxSplitAttestation)
    ? raw.fiscalTaxSplitAttestation as Record<string, unknown> : {};
  const fiscalProtected = Boolean(attestation.verifiedByUserId && attestation.evidenceReference) || Boolean(await tx.auditLog.findFirst({
    where: { entityType: "financial_receivable", entityId: current.id, action: "financial.invoice_tax_split_attested" },
    select: { id: true }
  })) || Boolean(await tx.financialInvoiceAllocation.count({ where: { receivableId: current.id, status: "active" } }));
  const fiscalDiffers = fiscalProtected && (Number(current.netAmount) !== incoming.netAmount || Number(current.vatAmount) !== incoming.vatAmount);
  const refresh = smartBillReceivableUpdateData(incoming, current.rawRowJson);
  if (fiscalDiffers) refresh.rawRowJson = {
    ...refresh.rawRowJson as Prisma.InputJsonObject,
    sourceFiscalReview: {
      status: "open", sourceNetAmount: incoming.netAmount, sourceVatAmount: incoming.vatAmount,
      preservedNetAmount: current.netAmount?.toString() || null,
      preservedVatAmount: current.vatAmount?.toString() || null
    }
  };
  return {
    ...refresh,
    ...(fiscalProtected ? { netAmount: current.netAmount, vatAmount: current.vatAmount } : {}),
    ...(fiscalDiffers ? { needsReview: true, reviewNote: "Defalcarea net/TVA din sursă diferă de verificarea fiscală existentă; valorile aprobate au fost păstrate." } : {})
  };
}

export function smartBillReceivableUpdateData(data: ReturnType<typeof smartBillCustomerReceivableData> & { legalEntityId?: string | null; partnerId?: string | null }, existingRaw: unknown) {
  return {
    legalEntityId: data.legalEntityId,
    partnerId: data.partnerId,
    companyName: data.companyName,
    companyCode: data.companyCode,
    invoiceDate: data.invoiceDate,
    sourceStatus: data.sourceStatus,
    sourceExternalId: data.sourceExternalId,
    sourceFingerprint: data.sourceFingerprint,
    spvIndex: data.spvIndex,
    netAmount: data.netAmount,
    vatAmount: data.vatAmount,
    dueDate: data.dueDate,
    invoicedAmount: data.invoicedAmount,
    currency: data.currency,
    rawRowJson: mergeSmartBillSourceMetadata(existingRaw, data.rawRowJson) as Prisma.InputJsonValue,
    rowType: data.rowType,
    reviewedByUserId: data.reviewedByUserId,
    reviewedAt: data.reviewedAt
  };
}

export function smartBillPayableUpdateData(data: ReturnType<typeof smartBillSupplierPayableData> & { legalEntityId?: string | null; partnerId?: string | null; documentType?: string }, existingRaw: unknown) {
  return {
    legalEntityId: data.legalEntityId,
    partnerId: data.partnerId,
    companyName: data.companyName,
    companyCode: data.companyCode,
    invoiceDate: data.invoiceDate,
    documentType: data.documentType,
    sourceStatus: data.sourceStatus,
    sourceFingerprint: data.sourceFingerprint,
    netAmount: data.netAmount,
    vatAmount: data.vatAmount,
    dueDate: data.dueDate,
    amountToPay: data.amountToPay,
    currency: data.currency,
    rawRowJson: mergeSmartBillSourceMetadata(existingRaw, data.rawRowJson) as Prisma.InputJsonValue,
    rowType: data.rowType,
    reviewedByUserId: data.reviewedByUserId,
    reviewedAt: data.reviewedAt
  };
}

