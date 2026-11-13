import type { FinanceSummary } from "@/lib/client-campaign-workspaces";

export function FinanceQualityNotice({ finance }: { finance: FinanceSummary }) {
  if (!finance.dataQualityReasons.length) return null;
  return <div role="status" className="mb-4 rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm text-amber-100">
    <strong>Rezumat financiar cu date de verificat</strong>
    {finance.unknownCurrencyCount > 0 ? <p className="mt-1">{finance.unknownCurrencyCount} facturi au o monedă diferită de RON/EUR sau necompletată. Sumele lor nu sunt incluse în totalurile pe aceste monede.</p> : null}
    {finance.unattributedInvoiceCount > 0 ? <p className="mt-1">{finance.unattributedInvoiceCount} facturi necesită alocare explicită înaintea raportării pe campanie.</p> : null}
    {finance.dataQualityReasons.includes("CAMPAIGN_RECEIPTS_NOT_ATTRIBUTABLE") ? <p className="mt-1">Unele încasări nu pot fi atribuite unei singure campanii. Valorile neconfirmate sunt afișate separat de zero.</p> : null}
  </div>;
}
