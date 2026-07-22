import type { SagaShadowSnapshot } from "@/lib/integrations/saga/contracts";

export function sagaShadowFixture(now = new Date()): SagaShadowSnapshot {
  return {
    source: "FIXTURE",
    generatedAt: now.toISOString(),
    companies: [
      { code: "FOCUS_MEDIA", fiscalCode: "PREVIEW-FOCUS", name: "Focus Media - fixture" },
      { code: "EXCELLENCE_MEDIA", fiscalCode: "PREVIEW-EXCELLENCE", name: "Excellence Media - fixture" },
      { code: "FOCUS_BG", fiscalCode: "PREVIEW-BG", name: "Focus BG - fixture" }
    ],
    customers: [
      { externalId: "customer-preview-1", legalEntityCode: "FOCUS_MEDIA", name: "Client sintetic A", taxId: "PREVIEW001", registryNumber: null, country: "RO", county: null, city: null, address: null, email: null, phone: null, bank: null, iban: null, active: true, updatedAt: now.toISOString() }
    ],
    invoices: [
      {
        externalId: "invoice-preview-1", guid: "fixture-guid-1", legalEntityCode: "FOCUS_MEDIA", series: "PV", number: "0001",
        issueDate: "2026-07-01", dueDate: "2026-07-31", customerExternalId: "customer-preview-1", customerTaxId: "PREVIEW001",
        customerName: "Client sintetic A", currency: "EUR", exchangeRate: "1.0000", netAmount: "1000.00", vatAmount: "190.00",
        grossAmount: "1190.00", outstandingAmount: "1190.00", cancelled: false, storno: false, vatOnReceipt: false,
        reverseCharge: false, spvId: null, updatedAt: now.toISOString(),
        lines: [{ externalId: "line-preview-1", description: "Serviciu OOH sintetic", itemCode: "OOH", quantity: "1", unit: "serv", unitPrice: "1000.00", netAmount: "1000.00", vatRate: "19.00", vatAmount: "190.00", grossAmount: "1190.00", account: null, costCenter: null }]
      },
      {
        externalId: null, guid: null, legalEntityCode: "EXCELLENCE_MEDIA", series: "PV", number: "0002",
        issueDate: "2026-07-02", dueDate: "2026-08-01", customerExternalId: null, customerTaxId: "PREVIEW002",
        customerName: "Client sintetic B", currency: "RON", exchangeRate: null, netAmount: "5000.00", vatAmount: "950.00",
        grossAmount: "5950.00", outstandingAmount: "3000.00", cancelled: false, storno: false, vatOnReceipt: null,
        reverseCharge: null, spvId: null, updatedAt: now.toISOString(), lines: []
      }
    ],
    collections: [
      { externalId: "collection-preview-1", legalEntityCode: "FOCUS_MEDIA", invoiceExternalId: "invoice-preview-1", invoiceNumber: "PV 0001", receivedAt: "2026-07-10", amount: "200.00", currency: "EUR", paymentMethod: "bank", account: "5121", reference: "PREVIEW-REFERENCE", reversed: false, updatedAt: now.toISOString() }
    ]
  };
}
