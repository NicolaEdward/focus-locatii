import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAnyPermission, hasGlobalDataAccess } from "@/lib/rbac";
import { checkedPeriod, commercialHash, commercialManagerRoles, tokenHash } from "@/lib/commercial-workbench-core";

const money = z.string().regex(/^\d{1,12}\.\d{2}$/);
const payloadSchema = z.object({
  clientId: z.string().min(1), campaignId: z.string().min(1), clientName: z.string().min(1).max(500),
  campaignName: z.string().min(1).max(500), companyEntity: z.string().min(1).max(100),
  recipient: z.string().email().max(254), periodStart: z.string(), periodEnd: z.string(),
  currency: z.enum(["RON", "EUR"]), policyVersion: z.number().int().positive(),
  paymentTermType: z.string().nullable().optional(), paymentTermDays: z.number().int().min(0).max(3650).nullable(),
  billingRule: z.string().nullable().optional(), billingFrequency: z.string().nullable().optional(),
  vatRateBps: z.number().int().min(0).max(10000), vatTreatment: z.enum(["inclusive", "exclusive", "exempt"]),
  assumptions: z.string().max(2000),
  lines: z.array(z.object({ locationId: z.string().min(1), code: z.string().max(191), city: z.string().max(500).nullable(), monthlyRate: money, net: money, tax: money, gross: money })).min(1).max(50),
  totals: z.object({ net: money, tax: money, gross: money }),
});

export class QuotePrintError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

/** Reads an immutable offer version. Printing does not approve, reserve or send it. */
export async function getCommercialQuotePrint(quoteId: string, revisionId: string | undefined, actor: AuthSession, now = new Date()) {
  if (!hasAnyPermission(actor.role, ["reservations.view", "reservations.view.own"])) throw new QuotePrintError("Nu ai acces la ofertele comerciale.", 403, "QUOTE_PRINT_FORBIDDEN");
  if (!quoteId || quoteId.length > 191 || revisionId && revisionId.length > 191) throw new QuotePrintError("Oferta nu a fost găsită.", 404, "QUOTE_PRINT_NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, tokenVersion: true } });
    if (!user?.active || user.role !== actor.role || user.tokenVersion !== actor.tokenVersion || actor.exp * 1000 <= now.getTime()) throw new QuotePrintError("Sesiunea s-a schimbat. Autentifică-te din nou.", 401, "QUOTE_PRINT_SESSION_CHANGED");
    if (actor.sessionId && !await tx.authSessionRecord.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } })) throw new QuotePrintError("Sesiunea a fost revocată.", 401, "QUOTE_PRINT_SESSION_CHANGED");
    const revision = await tx.quoteRevision.findFirst({
      where: { quoteId, ...(revisionId ? { id: revisionId } : {}), quote: hasGlobalDataAccess(actor.role) ? {} : { ownerUserId: actor.id } },
      orderBy: { revision: "desc" }, include: { quote: true },
    });
    if (!revision) throw new QuotePrintError("Oferta nu există sau nu îți este alocată.", 404, "QUOTE_PRINT_NOT_FOUND");
    const parsed = payloadSchema.safeParse(revision.payload);
    if (!parsed.success || commercialHash(revision.payload) !== revision.payloadHash) throw new QuotePrintError("Integritatea versiunii trebuie verificată înainte de export.", 409, "QUOTE_PRINT_INTEGRITY");
    const payload = parsed.data;
    try { checkedPeriod(payload.periodStart, payload.periodEnd); }
    catch { throw new QuotePrintError("Perioada ofertei trebuie verificată.", 409, "QUOTE_PRINT_INTEGRITY"); }
    const total = (field: "net" | "tax" | "gross") => payload.lines.reduce((sum, line) => sum.plus(line[field]), new Prisma.Decimal(0));
    if (payload.clientId !== revision.quote.clientId || payload.campaignId !== revision.quote.campaignId || payload.currency !== revision.currency
      || new Set(payload.lines.map((line) => line.locationId)).size !== payload.lines.length
      || payload.lines.some((line) => new Prisma.Decimal(line.monthlyRate).lte(0) || !new Prisma.Decimal(line.net).plus(line.tax).equals(line.gross))
      || !total("net").equals(payload.totals.net) || !total("tax").equals(payload.totals.tax) || !total("gross").equals(payload.totals.gross)
      || !revision.totalNet.equals(payload.totals.net) || !revision.totalTax.equals(payload.totals.tax) || !revision.totalGross.equals(payload.totals.gross))
      throw new QuotePrintError("Totalurile versiunii trebuie verificate înainte de export.", 409, "QUOTE_PRINT_INTEGRITY");
    const [client, campaign, policy, approvals] = await Promise.all([
      tx.clientAccount.findUnique({ where: { id: payload.clientId }, select: { accountOwnerUserId: true, status: true } }),
      tx.campaign.findUnique({ where: { id: payload.campaignId }, select: { clientId: true, sellerUserId: true, archivedAt: true, status: true, currency: true, companyEntity: true, paymentTermType: true, paymentTermDays: true, billingRule: true, billingFrequency: true } }),
      tx.commercialPolicy.findUnique({ where: { id: "default" } }),
      tx.commercialApproval.findMany({ where: { revisionId: revision.id, action: "send_quote", state: { in: ["approved", "consumed"] }, expiresAt: { gt: now }, approvedByUserId: { not: null } }, select: { approvedByUserId: true, payloadHash: true, recipientHash: true, holdExpiresAt: true } }),
    ]);
    if (!hasGlobalDataAccess(actor.role) && (!client || !campaign || client.accountOwnerUserId !== actor.id || campaign.sellerUserId !== actor.id || campaign.clientId !== payload.clientId)) throw new QuotePrintError("Portofoliul ofertei s-a schimbat. Cere acces responsabilului actual.", 404, "QUOTE_PRINT_NOT_FOUND");
    const approvers = await tx.user.findMany({ where: { id: { in: approvals.flatMap((approval) => approval.approvedByUserId || []) }, active: true, role: { in: ["SUPER_ADMIN", "COO", "SALES_DIRECTOR"] } }, select: { id: true, role: true } });
    const validApprovers = new Set(approvers.filter((approver) => commercialManagerRoles.has(approver.role)).map((approver) => approver.id));
    const recipientHash = tokenHash(payload.recipient);
    const approvedHash = commercialHash({ revisionHash: revision.payloadHash, action: "send_quote", recipientHash, holdExpiresAt: null });
    const approved = approvals.some((approval) => approval.approvedByUserId && validApprovers.has(approval.approvedByUserId) && approval.payloadHash === approvedHash && approval.recipientHash === recipientHash && approval.holdExpiresAt === null);
    const currentPolicy = Boolean(policy && payload.policyVersion === policy.version && payload.vatRateBps === policy.vatRateBps && payload.vatTreatment === policy.vatTreatment && payload.currency === policy.rateCardCurrency);
    const currentTerms = Boolean(client && campaign && !["archived", "merged", "cancelled"].includes(client.status) && !campaign.archivedAt && !["archived", "cancelled"].includes(campaign.status)
      && client.accountOwnerUserId === revision.quote.ownerUserId && campaign.sellerUserId === revision.quote.ownerUserId && campaign.clientId === payload.clientId
      && campaign.currency === payload.currency && campaign.companyEntity === payload.companyEntity && payload.paymentTermType && payload.paymentTermDays != null && payload.billingRule && payload.billingFrequency
      && payload.billingRule !== "fixed_custom_date" && payload.billingFrequency !== "custom"
      && campaign.paymentTermType === payload.paymentTermType && campaign.paymentTermDays === payload.paymentTermDays && campaign.billingRule === payload.billingRule && campaign.billingFrequency === payload.billingFrequency);
    const state = revision.revision !== revision.quote.latestRevision ? "historical" as const : revision.quote.state === "rejected" ? "rejected" as const : revision.expiresAt <= now ? "expired" as const : approved && currentPolicy && currentTerms ? "approved" as const : "draft" as const;
    return { quoteId: revision.quoteId, revisionId: revision.id, revision: revision.revision, payloadHash: revision.payloadHash, payload, state, createdAt: revision.createdAt.toISOString(), expiresAt: revision.expiresAt.toISOString(), printedAt: now.toISOString(), currentPolicy, currentTerms };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
}
