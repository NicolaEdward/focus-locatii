import { z } from "zod";
import { normalizeCompanyEntity } from "@/lib/company-entities";
import { canonicalTaxId } from "@/lib/tax-id";
import type { DocumentFact } from "@/lib/document-source-domain";

export const CONTRACT_CONTROL_ROLES = ["SUPER_ADMIN", "COO", "D_CEO", "SALES_DIRECTOR", "SALES_AGENT"] as const;
export const contractIssueLabels = {
  missing_price: "Chirie lunară lipsă",
  missing_currency: "Monedă nevalidată",
  missing_contract: "Număr contract lipsă",
  entity_mismatch: "Firma rezervării diferă de campanie",
  missing_entity: "Firmă contractantă nevalidată",
  missing_client_campaign: "Client sau campanie neasociate",
  missing_owner: "Responsabil comercial lipsă",
  evidence_missing: "Contractul nu este verificat din original",
  evidence_partial: "Dovadă contractuală incompletă",
  evidence_stale: "Dovada necesită resincronizare",
  evidence_conflict: "Documentele verificate se contrazic",
  contract_difference: "Datele diferă de contractul verificat",
  price_history_conflict: "Segmente de preț suprapuse",
  price_history_review: "Acte adiționale și tarife pe intervale de verificat",
  price_history_invalid: "Istoricul chiriei necesită reconciliere",
} as const;
export type ContractIssue = keyof typeof contractIssueLabels;
const issueKeys = Object.keys(contractIssueLabels) as [ContractIssue, ...ContractIssue[]];
export const contractControlQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  scope: z.enum(["current", "upcoming", "history", "all"]).default("current"),
  issue: z.union([z.literal("all"), z.literal("any"), z.enum(issueKeys)]).default("all"),
  evidence: z.enum(["all", "matched", "difference", "unverified"]).default("all"),
  entity: z.enum(["", "Focus Media", "Excellence Media", "Focus BG / Focus Media LLC EOOD"]).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type ContractControlQuery = z.infer<typeof contractControlQuerySchema>;
type ReservationFact = Extract<DocumentFact, { kind: "reservation" }>;
export type ContractEvidence = {
  documentId: string;
  documentVersionId: string;
  displayName: string;
  sha256: string;
  reviewVersion: number;
  reviewedAt: string;
  fresh: boolean;
  fact: ReservationFact;
};
export type ContractReservation = {
  id: string;
  locationCode: string;
  periodStart: string;
  periodEnd: string;
  contractNumber: string | null;
  contractCompany: string | null;
  clientTaxId: string | null;
  currency: string | null;
  monthlyRent: string | null;
  priceDate?: string;
  priceScheduleValid?: boolean;
};
export type ContractDifference = { field: string; label: string; current: string | null; contractual: string | null };
const key = (v: string | null | undefined) => String(v || "").trim().toLocaleUpperCase("ro-RO").replace(/\s+/g, " ");
const positive = (v: string | null | undefined) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;

/** A file name or a shared location code is never sufficient identity evidence. */
export function factIdentifiesReservation(row: ContractReservation, fact: ReservationFact) {
  if (fact.reservationId) return fact.reservationId === row.id;
  return key(fact.locationCode) === key(row.locationCode)
    && fact.periodStart === row.periodStart && fact.periodEnd === row.periodEnd
    && Boolean(fact.contractNumber && row.contractNumber && key(fact.contractNumber) === key(row.contractNumber))
    && Boolean(fact.clientTaxId && row.clientTaxId && canonicalTaxId(fact.clientTaxId) === canonicalTaxId(row.clientTaxId));
}

export function compareContractEvidence(row: ContractReservation, values: ContractEvidence[]) {
  const matching = values.filter((value) => factIdentifiesReservation(row, value.fact));
  const fresh = matching.filter((value) => value.fresh);
  const priceDate = row.priceDate || row.periodStart;
  const coversPriceDate = (fact: ReservationFact) => fact.periodStart <= priceDate && fact.periodEnd >= priceDate;
  const differences: ContractDifference[] = [];
  const compare = (field: string, label: string, current: string | null, contractual: string | null) => {
    if (current !== contractual && !differences.some((d) => d.field === field && d.contractual === contractual)) differences.push({ field, label, current, contractual });
  };
  const valuesOf = (fact: ReservationFact) => ({ location: key(fact.locationCode), contract: key(fact.contractNumber), client: canonicalTaxId(fact.clientTaxId), monthly: fact.monthlyRent === undefined ? null : Number(fact.monthlyRent).toFixed(2), currency: fact.currency || null, entity: normalizeCompanyEntity(fact.companyEntity) });
  const contradictory = fresh.some(({ fact: first }, index) => fresh.slice(index + 1).some(({ fact: second }) => {
    if (first.periodEnd < second.periodStart || second.periodEnd < first.periodStart) return false;
    const a = valuesOf(first), b = valuesOf(second);
    return (Object.keys(a) as Array<keyof typeof a>).some((field) => a[field] && b[field] && a[field] !== b[field]);
  }));
  for (const { fact } of fresh) {
    compare("locationCode", "Amplasament", key(row.locationCode), key(fact.locationCode));
    compare("periodStart", "Prima zi inclusă", row.periodStart, fact.periodStart);
    compare("periodEnd", "Ultima zi inclusă", row.periodEnd, fact.periodEnd);
    if (fact.contractNumber) compare("contractNumber", "Număr contract", key(row.contractNumber) || null, key(fact.contractNumber));
    if (fact.clientTaxId) compare("clientTaxId", "CUI client", canonicalTaxId(row.clientTaxId) || null, canonicalTaxId(fact.clientTaxId) || null);
    if (row.priceScheduleValid !== false && fact.currency && coversPriceDate(fact)) compare("currency", "Monedă", row.currency, fact.currency);
    if (fact.companyEntity) compare("contractCompany", "Firma contractantă", normalizeCompanyEntity(row.contractCompany), normalizeCompanyEntity(fact.companyEntity));
    if (row.priceScheduleValid !== false && coversPriceDate(fact) && fact.monthlyRent !== undefined && fact.currency && fact.currency === row.currency) compare("monthlyRent", "Chirie lunară", positive(row.monthlyRent) ? Number(row.monthlyRent).toFixed(2) : null, Number(fact.monthlyRent).toFixed(2));
  }
  const complete = row.priceScheduleValid !== false && fresh.some(({ fact }) => coversPriceDate(fact) && Boolean(fact.contractNumber && fact.clientTaxId && fact.currency && fact.companyEntity && positive(fact.monthlyRent)));
  const state = !matching.length ? "unverified" as const
    : !fresh.length ? "stale" as const
      : contradictory ? "conflicting" as const
        : differences.length ? "difference" as const
          : complete ? "matched" as const : "partial" as const;
  return { state, differences, documents: matching };
}

export function contractRecordScope(from: string, to: string, today: string) {
  return to < today ? "history" as const : from > today ? "upcoming" as const : "current" as const;
}

/** CSV formulas must remain text when the report is opened in a spreadsheet. */
export function contractCsvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
