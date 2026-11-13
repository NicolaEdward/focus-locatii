import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasGlobalDataAccess } from "@/lib/rbac";
import { isSellerCapableRole } from "@/lib/sales-roles";
import { effectiveHoldExpiresAt, isEffectiveHold } from "@/lib/reservation-lifecycle-domain";
import { checkedPeriod, CommercialError, commercialHash } from "@/lib/commercial-workbench-core";

type Db = typeof prisma | Prisma.TransactionClient;
export type QuoteHoldReservation = Prisma.ReservationGetPayload<{}>;

export class QuoteHoldContextError extends CommercialError {}

export type QuoteHoldContextInput = {
  quoteId: string;
  expectedRevision?: number;
  /** Omit for a read-only inventory batch; supply for an exact draft/effect. */
  locationIds?: string[];
  periodStart: string;
  periodEnd: string;
  actor?: Pick<AuthSession, "id" | "role">;
  /** Undefined: inspect; null: expect no hold; string: expect this exact hold. */
  expectedSnapshot?: string | null;
  /** The caller must retain this transaction through its eventual write. */
  lock?: boolean;
};

export type QuoteHoldContext = {
  quoteId: string;
  expectedRevision: number;
  reservationIds: string[];
  snapshot: string | null;
  rows: QuoteHoldReservation[];
  latestReceiptRevisionId: string | null;
  latestReceiptSnapshot: string | null;
};

const receiptResultSchema = z.object({
  reservationIds: z.array(z.string().min(1).max(191)).min(1).max(500),
  state: z.literal("HOLD"),
  approvalId: z.string().min(1),
  quoteRevisionId: z.string().min(1),
  holdSnapshotAfter: z.string().regex(/^[a-f0-9]{64}$/).optional().nullable(),
});
const sourcePayloadSchema = z.object({
  clientId: z.string().min(1), campaignId: z.string().min(1),
  periodStart: z.string(), periodEnd: z.string(),
  lines: z.array(z.object({ locationId: z.string().min(1) })).min(1).max(500),
});
const unavailable = () => new QuoteHoldContextError("NOT_FOUND", "Oferta nu există sau nu este disponibilă în portofoliul autorizat.", 404);
const changed = (message = "Hold-ul acestei oferte s-a schimbat. Reîncarcă oferta și verifică grupul înainte de o nouă aprobare.") =>
  new QuoteHoldContextError("QUOTE_HOLD_CONTEXT_CHANGED", message, 409);
const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/** Full scalar row snapshots bind approval to changes in price, expiry,
 * ownership, membership and operational metadata without interpreting notes. */
export function quoteHoldRowsSnapshot(rows: QuoteHoldReservation[]): string {
  return commercialHash([...rows].sort((left, right) => left.id.localeCompare(right.id)).map((row) => JSON.parse(JSON.stringify(row))));
}

/** Resolve exclusions only from durable, hash-checked execution receipts.
 * Neither owner-wide holds nor user-supplied reservation IDs are accepted. */
export async function resolveQuoteHoldContext(input: QuoteHoldContextInput, db: Db = prisma): Promise<QuoteHoldContext> {
  if (input.lock && db === prisma) throw new Error("Locked quote hold context requires the caller's transaction.");
  if (!input.quoteId || input.quoteId.length > 191 || input.expectedRevision !== undefined && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)) throw unavailable();
  const period = checkedPeriod(input.periodStart, input.periodEnd);
  if (input.lock) await db.$queryRaw`SELECT id FROM portfolio_commercial_quotes WHERE id = ${input.quoteId} FOR UPDATE`;
  const quote = await db.commercialQuote.findUnique({ where: { id: input.quoteId } });
  if (!quote || !quote.campaignId || input.actor && !hasGlobalDataAccess(input.actor.role) && quote.ownerUserId !== input.actor.id) throw unavailable();
  if (input.expectedRevision !== undefined && quote.latestRevision !== input.expectedRevision) {
    throw new QuoteHoldContextError("QUOTE_VERSION_CONFLICT", "Oferta are o versiune mai nouă. Reîncarcă oferta înainte de a continua.", 409);
  }
  const [client, campaign, owner] = await Promise.all([
    db.clientAccount.findUnique({ where: { id: quote.clientId }, select: { accountOwnerUserId: true, status: true } }),
    db.campaign.findUnique({ where: { id: quote.campaignId }, select: { clientId: true, sellerUserId: true, status: true, archivedAt: true } }),
    db.user.findUnique({ where: { id: quote.ownerUserId }, select: { active: true, role: true } }),
  ]);
  if (!owner?.active || !isSellerCapableRole(owner.role) || !client || !campaign || client.accountOwnerUserId !== quote.ownerUserId || campaign.sellerUserId !== quote.ownerUserId || campaign.clientId !== quote.clientId
    || ["archived", "merged", "cancelled", "completed"].includes(client.status) || ["archived", "merged", "cancelled", "completed"].includes(campaign.status) || campaign.archivedAt) throw unavailable();

  const empty: QuoteHoldContext = { quoteId: quote.id, expectedRevision: quote.latestRevision, reservationIds: [], snapshot: null, rows: [], latestReceiptRevisionId: null, latestReceiptSnapshot: null };
  const finish = (context: QuoteHoldContext) => {
    if (input.expectedSnapshot !== undefined && input.expectedSnapshot !== context.snapshot) throw changed();
    return context;
  };
  const revisions = await db.quoteRevision.findMany({ where: { quoteId: quote.id }, select: { id: true, payload: true, payloadHash: true } });
  const approvals = await db.commercialApproval.findMany({ where: { revisionId: { in: revisions.map((row) => row.id) }, action: "create_hold", state: "consumed" }, select: { id: true, revisionId: true, approvedByUserId: true } });
  if (!approvals.length) return finish(empty);
  const receipts = await db.agentCommand.findMany({
    where: { approvalId: { in: approvals.map((row) => row.id) }, tool: "approved_hold", status: "completed" },
    select: { id: true, approvalId: true, delegatorUserId: true, result: true, outputHash: true, completedAt: true, createdAt: true },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const bindings = receipts.map((receipt) => {
    const parsed = receiptResultSchema.safeParse(receipt.result);
    const approval = approvals.find((row) => row.id === receipt.approvalId);
    const revision = revisions.find((row) => row.id === approval?.revisionId);
    if (!parsed.success || !approval?.approvedByUserId || !revision || receipt.delegatorUserId !== quote.ownerUserId || receipt.outputHash !== commercialHash(receipt.result)
      || parsed.data.approvalId !== approval.id || parsed.data.quoteRevisionId !== revision.id || new Set(parsed.data.reservationIds).size !== parsed.data.reservationIds.length
      || commercialHash(revision.payload) !== revision.payloadHash) throw changed("Legătura documentată dintre ofertă și hold necesită verificarea unui manager.");
    const payload = sourcePayloadSchema.safeParse(revision.payload);
    if (!payload.success || payload.data.clientId !== quote.clientId || payload.data.campaignId !== quote.campaignId || new Set(payload.data.lines.map((row) => row.locationId)).size !== payload.data.lines.length) throw changed();
    return { receipt, result: parsed.data, approval, payload: payload.data };
  });
  const ids = [...new Set(bindings.flatMap((binding) => binding.result.reservationIds))].sort();
  if (!ids.length) return finish(empty);
  if (input.lock) await db.$queryRaw(Prisma.sql`SELECT id FROM portfolio_reservations WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const rows = await db.reservation.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
  if (rows.some((row) => row.status === "BOOKED")) {
    throw changed("Hold-ul ofertei a fost confirmat ca închiriere. Modificările se fac prin amendamentul contractului, fără ignorarea rezervării confirmate.");
  }
  const now = new Date();
  const activeBindings = bindings.filter((binding) => {
    const held = rows.filter((row) => binding.result.reservationIds.includes(row.id) && isEffectiveHold(row, now));
    if (held.length && held.length !== binding.result.reservationIds.length) throw changed("Grupul HOLD este incomplet sau are stări diferite. Rezolvă explicit întregul grup înainte de a continua.");
    return held.length > 0;
  });
  if (!activeBindings.length) return finish(empty);
  const activeIds = activeBindings[0].result.reservationIds;
  if (activeBindings.some((binding) => !sameIds(binding.result.reservationIds, activeIds))) throw changed("Oferta are mai multe grupuri HOLD active. Un manager trebuie să rezolve explicit grupurile înainte de reofertare.");
  const heldRows = rows.filter((row) => activeIds.includes(row.id));
  for (const binding of activeBindings) {
    const sourcePeriod = checkedPeriod(binding.payload.periodStart, binding.payload.periodEnd);
    if (!sameIds(heldRows.map((row) => row.locationId), binding.payload.lines.map((row) => row.locationId))
      || heldRows.some((row) => row.periodStart.getTime() !== sourcePeriod.from.getTime() || row.periodEnd.getTime() !== sourcePeriod.to.getTime())) throw changed();
  }
  if (heldRows.some((row) => row.clientId !== quote.clientId || row.campaignId !== quote.campaignId || row.ownerId !== quote.ownerUserId || row.sellerUserId !== quote.ownerUserId || row.externalSource !== "approved-sales-agent"
    || !bindings.some((binding) => binding.result.reservationIds.includes(row.id) && row.externalId === "agent-hold:" + createHash("sha256").update("commercial:" + binding.approval.id + ":" + row.locationId).digest("hex")))) throw changed();
  const groupId = heldRows[0].contractGroupId;
  if (heldRows.some((row) => row.contractGroupId !== groupId) || heldRows.length > 1 && !groupId) throw changed();
  if (groupId) {
    const members = await db.reservation.findMany({ where: { contractGroupId: groupId }, select: { id: true } });
    if (!sameIds(members.map((row) => row.id), activeIds)) throw changed();
  }
  if (heldRows.some((row) => row.periodStart.getTime() !== period.from.getTime() || row.periodEnd.getTime() !== period.to.getTime())
    || input.locationIds !== undefined && (!sameIds([...new Set(input.locationIds)], heldRows.map((row) => row.locationId)) || new Set(input.locationIds).size !== input.locationIds.length)) {
    throw changed("Oferta are deja un HOLD pentru alte amplasamente sau altă perioadă. Eliberează explicit hold-ul și replanifică înainte de a modifica selecția ori perioada.");
  }
  // TTL is checked at the final read as well; no expired row is excluded.
  if (heldRows.some((row) => effectiveHoldExpiresAt(row) <= new Date())) throw changed();
  const latest = activeBindings[0];
  return finish({ ...empty, reservationIds: heldRows.map((row) => row.id).sort(), snapshot: quoteHoldRowsSnapshot(heldRows), rows: heldRows,
    latestReceiptRevisionId: latest.result.quoteRevisionId, latestReceiptSnapshot: latest.result.holdSnapshotAfter || null });
}
