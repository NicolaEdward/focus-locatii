export type SagaLegalEntityCode = "FOCUS_MEDIA" | "EXCELLENCE_MEDIA" | "FOCUS_BG";
export type SagaCurrency = "RON" | "EUR";

export type SagaCompanyDto = {
  code: SagaLegalEntityCode;
  fiscalCode: string;
  name: string;
};

export type SagaCustomerDto = {
  externalId: string | null;
  legalEntityCode: SagaLegalEntityCode;
  name: string;
  taxId: string | null;
  registryNumber: string | null;
  country: string | null;
  county: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  bank: string | null;
  iban: string | null;
  active: boolean | null;
  updatedAt: string | null;
};

export type SagaIssuedInvoiceLineDto = {
  externalId: string | null;
  description: string;
  itemCode: string | null;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  netAmount: string;
  vatRate: string;
  vatAmount: string;
  grossAmount: string;
  account: string | null;
  costCenter: string | null;
};

export type SagaIssuedInvoiceDto = {
  externalId: string | null;
  guid: string | null;
  legalEntityCode: SagaLegalEntityCode;
  series: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  customerExternalId: string | null;
  customerTaxId: string | null;
  customerName: string;
  currency: SagaCurrency;
  exchangeRate: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  outstandingAmount: string;
  cancelled: boolean;
  storno: boolean;
  vatOnReceipt: boolean | null;
  reverseCharge: boolean | null;
  spvId: string | null;
  updatedAt: string | null;
  lines: SagaIssuedInvoiceLineDto[];
};

export type SagaCollectionDto = {
  externalId: string | null;
  legalEntityCode: SagaLegalEntityCode;
  invoiceExternalId: string | null;
  invoiceNumber: string | null;
  receivedAt: string;
  amount: string;
  currency: SagaCurrency;
  paymentMethod: string | null;
  account: string | null;
  reference: string | null;
  reversed: boolean;
  updatedAt: string | null;
};

export type SagaSyncCursor = {
  legalEntityCode: SagaLegalEntityCode;
  updatedAfter: string | null;
  continuationToken: string | null;
};

export type SagaShadowSnapshot = {
  source: "FIXTURE";
  generatedAt: string;
  companies: SagaCompanyDto[];
  customers: SagaCustomerDto[];
  invoices: SagaIssuedInvoiceDto[];
  collections: SagaCollectionDto[];
};

export type SagaSyncResult = {
  mode: "SHADOW_READ_ONLY";
  generatedAt: string;
  recordsRead: number;
  accepted: number;
  rejected: number;
  exactMatches: number;
  probableMatches: number;
  newInvoices: number;
  exactPaymentMatches: number;
  newPayments: number;
  reversedPayments: number;
  conflicts: number;
  unmatchedPayments: number;
  potentialDuplicatePayments: number;
  manualPaymentsPendingReconciliation: number;
};
