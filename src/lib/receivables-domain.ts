import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeClientName, normalizeInvoiceNumber } from "@/lib/clients";

export type ReceivableMoney = Prisma.Decimal.Value | null | undefined;

export function normalizeReceivableInvoiceNumber(value?: string | null) {
  const normalized = normalizeInvoiceNumber(value);
  if (normalized.startsWith("fscm")) return `fcsm${normalized.slice(4)}`;
  if (normalized.startsWith("fcsm")) return normalized;
  return normalized;
}

export function receivableCanonicalKey(input: {
  companyCode: string;
  normalizedInvoiceNumber: string;
  currency: string;
}) {
  return [input.companyCode, input.normalizedInvoiceNumber, input.currency].map((value) => value.trim().toLowerCase()).join("|");
}

export function receivableRowHash(input: {
  companyCode: string;
  normalizedInvoiceNumber: string;
  currency: string | null;
  normalizedClientName: string;
  invoiceAmount: ReceivableMoney;
  collectedAmount: ReceivableMoney;
  remainingAmount: ReceivableMoney;
  dueDate: Date | null;
}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    ...input,
    invoiceAmount: money(input.invoiceAmount).toFixed(2),
    collectedAmount: money(input.collectedAmount).toFixed(2),
    remainingAmount: money(input.remainingAmount).toFixed(2),
    dueDate: input.dueDate?.toISOString().slice(0, 10) || null
  })).digest("hex");
}

export function reconcileReceivableAmounts(input: {
  invoiceAmount: ReceivableMoney;
  ledgerCollectedAmount: ReceivableMoney;
  reportCollectedAmount?: ReceivableMoney;
  allowOverpayment?: boolean;
}) {
  const invoiceAmount = money(input.invoiceAmount);
  const ledgerCollectedAmount = money(input.ledgerCollectedAmount);
  const reportCollectedAmount = input.reportCollectedAmount == null ? null : money(input.reportCollectedAmount);
  if (invoiceAmount.isNegative()) throw new Error("Valoarea facturii nu poate fi negativă.");
  if (ledgerCollectedAmount.isNegative()) throw new Error("Totalul încasat nu poate fi negativ.");

  if (reportCollectedAmount && reportCollectedAmount.lessThan(ledgerCollectedAmount.minus("0.01"))) {
    return {
      state: "conflict" as const,
      invoiceAmount,
      ledgerCollectedAmount,
      reportCollectedAmount,
      importDelta: money(0),
      remainingAmount: Prisma.Decimal.max(invoiceAmount.minus(ledgerCollectedAmount), 0),
      creditAmount: Prisma.Decimal.max(ledgerCollectedAmount.minus(invoiceAmount), 0),
      message: "Raportul indică mai puțin încasat decât registrul aplicației. Încasările existente nu vor fi suprascrise."
    };
  }

  const targetCollected = reportCollectedAmount && reportCollectedAmount.greaterThan(ledgerCollectedAmount)
    ? reportCollectedAmount
    : ledgerCollectedAmount;
  const importDelta = targetCollected.minus(ledgerCollectedAmount);
  const creditAmount = Prisma.Decimal.max(targetCollected.minus(invoiceAmount), 0);
  if (creditAmount.greaterThan(0) && !input.allowOverpayment) {
    return {
      state: "overpayment_confirmation" as const,
      invoiceAmount,
      ledgerCollectedAmount,
      reportCollectedAmount,
      importDelta,
      remainingAmount: money(0),
      creditAmount,
      message: "Încasarea depășește soldul și necesită confirmare explicită pentru credit client."
    };
  }
  return {
    state: importDelta.greaterThan(0) ? "payment_delta" as const : "unchanged" as const,
    invoiceAmount,
    ledgerCollectedAmount,
    reportCollectedAmount,
    importDelta,
    remainingAmount: Prisma.Decimal.max(invoiceAmount.minus(targetCollected), 0),
    creditAmount,
    message: null
  };
}

export function shouldKeepExistingReceivableLedger(input: {
  reconciliationState: ReturnType<typeof reconcileReceivableAmounts>["state"];
  rowStatus: string;
  resolutionAction?: string | null;
}) {
  return input.reconciliationState === "conflict" && (
    input.resolutionAction === "confirm_ledger" ||
    (input.rowStatus === "resolved" && input.resolutionAction === "confirm")
  );
}

export function receivableStatus(input: {
  invoiceAmount: ReceivableMoney;
  collectedAmount: ReceivableMoney;
  dueDate?: Date | null;
  now?: Date;
}) {
  const invoiceAmount = money(input.invoiceAmount);
  const collectedAmount = money(input.collectedAmount);
  if (collectedAmount.greaterThan(invoiceAmount)) return "client_credit";
  if (collectedAmount.equals(invoiceAmount) && invoiceAmount.greaterThanOrEqualTo(0)) return "collected";
  if (collectedAmount.greaterThan(0)) return "collected_partial";
  if (!input.dueDate) return "needs_review";
  const due = utcDay(input.dueDate);
  const now = utcDay(input.now || new Date());
  if (due < now) return "overdue";
  if (due.getTime() === now.getTime()) return "due_today";
  if ((due.getTime() - now.getTime()) / 86_400_000 <= 7) return "due_soon";
  return "in_term";
}

export function receivableLedgerSnapshot(input: {
  invoiceAmount: ReceivableMoney;
  dueDate?: Date | null;
  now?: Date;
  payments: Array<{ amount: ReceivableMoney; status: string }>;
}) {
  const invoiceAmount = money(input.invoiceAmount);
  const collectedAmount = input.payments
    .filter((payment) => payment.status === "active")
    .reduce((sum, payment) => sum.plus(money(payment.amount)), money(0));
  const remainingAmount = Prisma.Decimal.max(invoiceAmount.minus(collectedAmount), 0);
  const creditAmount = Prisma.Decimal.max(collectedAmount.minus(invoiceAmount), 0);
  return {
    invoiceAmount,
    collectedAmount,
    remainingAmount,
    creditAmount,
    status: receivableStatus({ invoiceAmount, collectedAmount, dueDate: input.dueDate, now: input.now })
  };
}

export function matchClientCandidates(input: {
  clientName: string;
  companyCode: string;
  clients: Array<{ id: string; companyName: string; normalizedName: string | null; aliases?: unknown }>;
  aliases: Array<{ companyCode: string; normalizedAlias: string; clientId: string }>;
}) {
  const normalized = normalizeClientName(input.clientName);
  const exactAlias = input.aliases.find((alias) => alias.companyCode === input.companyCode && alias.normalizedAlias === normalized);
  if (exactAlias) return { level: "safe" as const, score: 100, clientIds: [exactAlias.clientId], reason: "Alias financiar confirmat." };

  const exact = input.clients.filter((client) => clientNames(client).includes(normalized));
  if (exact.length === 1) return { level: "safe" as const, score: 100, clientIds: [exact[0].id], reason: "Denumire client identică după normalizare." };
  if (exact.length > 1) return { level: "conflict" as const, score: 0, clientIds: exact.map((client) => client.id), reason: "Mai mulți clienți au aceeași denumire normalizată." };

  const probable = input.clients
    .map((client) => ({ id: client.id, score: nameSimilarity(normalized, normalizeClientName(client.companyName)) }))
    .filter((candidate) => candidate.score >= 0.72)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  if (probable.length && (probable.length === 1 || probable[0].score - probable[1].score >= 0.08)) {
    return { level: "probable" as const, score: Math.round(probable[0].score * 100), clientIds: probable.map((candidate) => candidate.id), reason: "Denumire similară; necesită confirmare." };
  }
  return { level: "unmatched" as const, score: 0, clientIds: probable.map((candidate) => candidate.id), reason: "Clientul nu a fost identificat sigur." };
}

export function nameSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = union ? intersection / union : 0;
  const editScore = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  return Math.max(tokenScore, editScore);
}

function clientNames(client: { companyName: string; normalizedName: string | null; aliases?: unknown }) {
  const aliases = Array.isArray(client.aliases) ? client.aliases.filter((value): value is string => typeof value === "string") : [];
  return Array.from(new Set([client.companyName, client.normalizedName || "", ...aliases].map(normalizeClientName).filter(Boolean)));
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function money(value: ReceivableMoney) {
  if (value == null || value === "") return new Prisma.Decimal(0);
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
