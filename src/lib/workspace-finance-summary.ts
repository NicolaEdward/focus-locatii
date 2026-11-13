import { Prisma } from "@prisma/client";
import type { FinanceSummary } from "@/lib/client-campaign-workspaces";
import { invoiceCapacity } from "@/lib/campaign-finance";
import { prisma } from "@/lib/prisma";
import { receivableNetAmount, receivableNetRemaining } from "@/lib/receivable-adjustments";
import { bucharestDateKey } from "@/lib/campaigns/campaign-effective-status";

type AmountKey = "invoicedRon" | "invoicedEur" | "collectedRon" | "collectedEur" | "remainingRon" | "remainingEur" | "overdueRon" | "overdueEur";
const projection = {
  id: true, invoiceNumber: true, dueDate: true, currency: true, invoicedAmount: true,
  collectedAmount: true, remainingAmount: true, rawRowJson: true, status: true,
  includedInReport: true, needsReview: true,
  campaignAllocations: { where: { status: "active" }, select: { campaignId: true, currency: true, grossAmount: true, netAmount: true, vatAmount: true } },
} satisfies Prisma.FinancialReceivableSelect;

/** Invoice cash is never apportioned between campaigns by an invented ratio. */
export async function getWorkspaceFinanceSummary(where: Prisma.FinancialReceivableWhereInput, campaignId?: string): Promise<FinanceSummary> {
  return prisma.$transaction(async (tx) => {
    const totals: Record<AmountKey, Prisma.Decimal | null> = { invoicedRon: zero(), invoicedEur: zero(), collectedRon: zero(), collectedEur: zero(), remainingRon: zero(), remainingEur: zero(), overdueRon: zero(), overdueEur: zero() };
    const reasons = new Set<string>();
    const rows: FinanceSummary["rows"] = [];
    let unknownCurrencyCount = 0, unattributedInvoiceCount = 0, openCount: number | null = 0, cursor: string | undefined;
    const scope: Prisma.FinancialReceivableWhereInput = campaignId
      ? { AND: [where, { OR: [{ includedInReport: true }, { campaignAllocations: { some: { campaignId, status: "active" } } }] }] }
      : { AND: [where, { includedInReport: true, needsReview: false }] };
    const today = Date.parse(`${bucharestDateKey(new Date())}T00:00:00.000Z`);
    while (true) {
      const page = await tx.financialReceivable.findMany({ where: scope, select: projection, orderBy: { id: "asc" }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const invoice of page) {
        const unit = invoice.currency === "RON" || invoice.currency === "EUR" ? invoice.currency : null;
        const suffix = unit === "EUR" ? "Eur" : "Ron";
        let invoiced: Prisma.Decimal | null = receivableNetAmount(invoice.invoicedAmount, invoice.rawRowJson);
        let collected: Prisma.Decimal | null = invoice.collectedAmount;
        let remaining: Prisma.Decimal | null = receivableNetRemaining(invoice);
        if (!unit) { unknownCurrencyCount++; reasons.add("UNKNOWN_INVOICE_CURRENCY"); openCount = null; }
        if (campaignId) {
          const selected = invoice.campaignAllocations.filter((allocation) => allocation.campaignId === campaignId);
          const assigned = sum(selected, "grossAmount");
          const totalAssigned = sum(invoice.campaignAllocations, "grossAmount");
          let valid = selected.length > 0 && invoice.includedInReport && !invoice.needsReview && Boolean(unit)
            && invoice.campaignAllocations.every((allocation) => allocation.currency === invoice.currency
              && allocation.grossAmount.gte(0) && allocation.netAmount.gte(0) && allocation.vatAmount.gte(0)
              && allocation.netAmount.plus(allocation.vatAmount).equals(allocation.grossAmount));
          if (!selected.length) {
            reasons.add("CAMPAIGN_INVOICE_ALLOCATION_MISSING");
            unattributedInvoiceCount++;
          } else if (valid) {
            try {
              const capacity = await invoiceCapacity(tx, invoice.id);
              if (!capacity.taxVerified) { reasons.add("FISCAL_DATA_UNVERIFIED"); valid = false; }
              if (totalAssigned.gt(capacity.gross) || sum(invoice.campaignAllocations, "netAmount").gt(capacity.net) || sum(invoice.campaignAllocations, "vatAmount").gt(capacity.vat)) valid = false;
            } catch { valid = false; }
          }
          if (!valid) {
            if (selected.length) reasons.add("CAMPAIGN_INVOICE_ALLOCATION_INVALID");
            invoiced = null; collected = null; remaining = null;
          } else {
            invoiced = assigned;
            const exclusive = invoice.campaignAllocations.every((allocation) => allocation.campaignId === campaignId) && assigned.equals(receivableNetAmount(invoice.invoicedAmount, invoice.rawRowJson));
            if (!exclusive) {
              // A fully paid invoice settles all valid allocated shares. An
              // entirely unpaid invoice has no receipt to apportion. Partial
              // cash on a shared/partial invoice has no campaign attribution.
              const invoiceBalance = receivableNetRemaining(invoice);
              if (invoiceBalance.equals(0)) { collected = assigned; remaining = zero(); }
              else if (new Prisma.Decimal(invoice.collectedAmount || 0).equals(0)) { collected = zero(); remaining = assigned; }
              else {
                collected = null; remaining = null;
                reasons.add("CAMPAIGN_RECEIPTS_NOT_ATTRIBUTABLE");
              }
            }
          }
        }
        if (unit) {
          add(totals, `invoiced${suffix}`, invoiced);
          add(totals, `collected${suffix}`, collected);
          add(totals, `remaining${suffix}`, remaining);
          if (!remaining) { totals[`overdue${suffix}`] = null; openCount = null; }
          else if (remaining.gt(0)) {
            if (openCount != null) openCount++;
            if (invoice.dueDate && utcDay(invoice.dueDate) < today) add(totals, `overdue${suffix}`, remaining);
          }
        }
        rows.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate?.toISOString() || null, currency: invoice.currency || "Monedă nesetată", invoiced: value(invoiced), collected: value(collected), remaining: value(remaining), status: invoice.status });
      }
      // Keep a useful bounded preview while every eligible invoice contributes
      // to totals. Pagination here avoids silently truncating at 50 invoices.
      rows.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || a.id.localeCompare(b.id));
      rows.splice(50);
      if (page.length < 250) break;
      cursor = page[page.length - 1].id;
    }
    return {
      ...Object.fromEntries(Object.entries(totals).map(([key, amount]) => [key, value(amount)])),
      openCount, rows, source: campaignId ? "campaign-invoice-allocations" : "invoice-ledger",
      dataQualityReasons: [...reasons], unattributedInvoiceCount, unknownCurrencyCount,
    } as FinanceSummary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}

function zero() { return new Prisma.Decimal(0); }
function value(amount: Prisma.Decimal | null) { return amount == null ? null : amount.toDecimalPlaces(2).toNumber(); }
function add(totals: Record<AmountKey, Prisma.Decimal | null>, key: AmountKey, amount: Prisma.Decimal | null) { totals[key] = totals[key] == null || amount == null ? null : totals[key].plus(amount); }
function sum<T extends { grossAmount: Prisma.Decimal; netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal }>(rows: T[], field: "grossAmount" | "netAmount" | "vatAmount") { return rows.reduce((total, row) => total.plus(row[field]), zero()); }
function utcDay(date: Date) { return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
