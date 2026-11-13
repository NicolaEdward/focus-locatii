import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import type { AuthSession } from "../src/lib/auth";
import { createApprovedAgentHold, reservationWriteTransactionOptions, createReservation, updateReservation, updateReservationGroup, updateReservationGroupStatus } from "../src/lib/reservations";
import { amendedPriceIntervals } from "../src/lib/reservation-amendments";

const endpoint = new URL(process.env.DATABASE_URL || "invalid:");
if (!["127.0.0.1", "localhost"].includes(endpoint.hostname) || !endpoint.pathname.startsWith("/focus_preview_") || process.env.VERCEL_ENV === "production" || !["test", "ci", "preview"].includes(process.env.APP_ENV || "")) throw new Error("An isolated local synthetic database is required.");
const tag = `amendment-qa-${Date.now()}`;
const made = { users: [] as string[], locations: [] as string[], clients: [] as string[], campaigns: [] as string[], categories: [] as string[] };
const day = (value: string) => new Date(value + "T00:00:00.000Z");
const code = (status: number) => (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === status;
const versions = (rows: Array<{ id: string; updatedAt: string }>) => Object.fromEntries(rows.map((row) => [row.id, row.updatedAt]));
let cases = 0;
function passed(label: string) { cases++; console.log(`✓ ${label}`); }

async function main() {
  const category = await prisma.category.create({ data: { name: tag, slug: tag } }); made.categories.push(category.id);
  const users = await Promise.all((["COO", "SALES_AGENT", "SALES_AGENT"] as const).map(async (role, i) => {
    const user = await prisma.user.create({ data: { name: `${tag}-${i}`, email: `${tag}-${i}@example.invalid`, role, active: true, passwordHash: "synthetic-only" } });
    made.users.push(user.id); return { ...user, tokenVersion: 0, iat: 1, exp: 9999999999 } as AuthSession;
  }));
  const [coo, seller, foreign] = users;
  const client = await prisma.clientAccount.create({ data: { companyName: tag, normalizedName: tag, status: "active", accountOwnerUserId: seller.id, generalEmail: "verified@example.invalid" } }); made.clients.push(client.id);
  const campaign = await prisma.campaign.create({ data: { campaignName: tag, clientId: client.id, sellerUserId: seller.id, accountOwnerUserId: seller.id, currency: "EUR", companyEntity: "Focus Media", paymentTermDays: 14, status: "planned" } }); made.campaigns.push(campaign.id);
  for (let i = 0; i < 8; i++) { const location = await prisma.location.create({ data: { categoryId: category.id, code: `${tag}-${i}`, showInPublic: false, city: "Synthetic" } }); made.locations.push(location.id); }
  const hold = (locationId: string) => createReservation({ locationId, status: "HOLD", clientName: tag, periodStart: "2090-01-01", periodEnd: "2090-03-31" }, seller);
  const booked = (locationIds: string[], extra: Record<string, unknown> = {}) => createReservation({ locationIds, status: "BOOKED", clientId: client.id, campaignId: campaign.id, sellerUserId: seller.id, monthlyRentTotal: 100 * locationIds.length, periodStart: "2090-01-01", periodEnd: "2090-03-31", currency: "EUR", ...extra }, coo);
  let [h] = await hold(made.locations[0]);
  await assert.rejects(() => updateReservation(h.id, { notes: "no token" }, seller), code(428));
  const first = await updateReservation(h.id, { notes: "first", expectedUpdatedAt: h.updatedAt }, seller);
  await assert.rejects(() => updateReservation(h.id, { notes: "stale", expectedUpdatedAt: h.updatedAt }, seller), code(409));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: h.id } })).notes, "first");
  passed("missing and stale versions refuse writes");
  const outcomes = await Promise.allSettled(["concurrent A", "concurrent B"].map((notes) => updateReservation(h.id, { notes, expectedUpdatedAt: first.updatedAt }, seller)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected" && code(409)(outcome.reason)).length, 1);
  passed("two forms at the same version have one winner");

  let [rental] = await booked([made.locations[1]]);
  const countBefore = await prisma.rentalPriceSegment.count({ where: { rentalId: rental.id } });
  await assert.rejects(() => updateReservation(rental.id, { amount: 200, expectedUpdatedAt: rental.updatedAt }, coo), /data efectivă/);
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: rental.id } })).amount, 100);
  assert.equal(await prisma.rentalPriceSegment.count({ where: { rentalId: rental.id } }), countBefore);
  const amended = await updateReservation(rental.id, { amount: 200, monthlyRentShare: 200, currency: "RON", expectedUpdatedAt: rental.updatedAt, amendmentEffectiveDate: "2090-02-01", amendmentReference: "Synthetic signed addendum 1", amendmentMode: "amendment" }, coo);
  assert.deepEqual(amended.priceSegments?.map((s) => [s.effectiveFrom.slice(0, 10), s.effectiveTo?.slice(0, 10), s.monthlyRent, s.currency]), [["2090-01-01", "2090-01-31", 100, "EUR"], ["2090-02-01", "2090-03-31", 200, "RON"]]);
  assert.equal(amended.updatedAt, (await prisma.reservation.findUniqueOrThrow({ where: { id: amended.id } })).updatedAt.toISOString());
  passed("effective-date and currency amendments preserve prior contractual prices");
  const note = await updateReservation(amended.id, { notes: "follow up", expectedUpdatedAt: amended.updatedAt }, seller);
  assert.equal(note.clientEmail, "verified@example.invalid");
  assert.deepEqual(note.priceSegments, amended.priceSegments);
  passed("notes-only edits preserve verified contacts and price history");
  await assert.rejects(() => updateReservation(note.id, { amount: 250, expectedUpdatedAt: note.updatedAt, amendmentEffectiveDate: "2090-03-01", amendmentReference: "Unauthorized price", amendmentMode: "amendment" }, seller), code(403));
  const trimmed = await updateReservation(note.id, { periodEnd: "2090-02-28", expectedUpdatedAt: note.updatedAt, amendmentEffectiveDate: "2090-02-28", amendmentReference: "Synthetic signed early end", amendmentMode: "amendment" }, coo);
  assert.deepEqual(trimmed.priceSegments?.map((s) => [s.effectiveFrom.slice(0, 10), s.effectiveTo?.slice(0, 10), s.monthlyRent, s.currency]), [["2090-01-01", "2090-01-31", 100, "EUR"], ["2090-02-01", "2090-02-28", 200, "RON"]]);
  const extended = await updateReservation(trimmed.id, { periodEnd: "2090-04-30", expectedUpdatedAt: trimmed.updatedAt, amendmentEffectiveDate: "2090-03-01", amendmentReference: "Synthetic signed extension", amendmentMode: "amendment" }, coo);
  assert.equal(extended.priceSegments?.at(-1)?.effectiveTo?.slice(0, 10), "2090-04-30");
  assert.equal(extended.priceSegments?.at(-1)?.monthlyRent, 200);
  passed("period-only trim and extension retain the correct price segments");

  const group = await booked(made.locations.slice(2, 4));
  await assert.rejects(() => updateReservationGroup(group[0].id, { notes: "incomplete group", expectedVersions: { [group[0].id]: group[0].updatedAt } }, coo), code(409));
  await assert.rejects(() => updateReservationGroup(group[0].id, { monthlyRentTotal: 500, expectedVersions: versions(group) }, coo), /distribuția explicită/);
  const input = { groupRentShares: [{ reservationId: group[0].id, monthlyRent: 200 }, { reservationId: group[1].id, monthlyRent: 300 }], monthlyRentTotal: 500, expectedVersions: versions(group), amendmentEffectiveDate: "2090-02-01", amendmentReference: "Synthetic unequal addendum", amendmentMode: "amendment" };
  await assert.rejects(() => updateReservationGroup(group[0].id, { ...input, monthlyRentTotal: 600 }, coo), /Suma chiriilor/);
  const repriced = await updateReservationGroup(group[0].id, input, coo);
  assert.deepEqual(repriced.map((r) => r.amount).sort(), [200, 300]);
  for (const r of repriced) assert.equal(r.priceSegments?.[0].monthlyRent, 100);
  await assert.rejects(() => updateReservationGroupStatus(group[0].id, "CANCELLED", coo, { expectedVersions: versions(group) }), code(409));
  await assert.rejects(() => updateReservationGroup(group[0].id, { notes: "foreign", expectedVersions: versions(repriced) }, foreign), code(403));
  passed("group mutations check every version and explicit unequal pricing atomically");

  const [ambiguous] = await booked([made.locations[4]]);
  await prisma.rentalPriceSegment.create({ data: { rentalId: ambiguous.id, effectiveFrom: day("2090-01-10"), effectiveTo: day("2090-03-31"), monthlyRent: 999, currency: "EUR" } });
  await assert.rejects(() => updateReservation(ambiguous.id, { amount: 300, expectedUpdatedAt: ambiguous.updatedAt, amendmentEffectiveDate: "2090-02-01", amendmentReference: "Cannot infer history", amendmentMode: "amendment" }, coo), code(409));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: ambiguous.id } })).amount, 100);
  passed("ambiguous historical segments stop amendments without guessing");
  const [audited] = await booked([made.locations[5]]);
  const tx = prisma.$transaction.bind(prisma);
  (prisma as any).$transaction = (callback: any, options: any) => tx(async (client: any) => callback(new Proxy(client, { get(target, key) {
    if (key === "auditLog") return { create: async ({ data }: any) => { if (data.action === "reservation.amendment.committed") throw new Error("synthetic audit failure"); return target.auditLog.create({ data }); } };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } })), options);
  try { await assert.rejects(() => updateReservation(audited.id, { amount: 400, expectedUpdatedAt: audited.updatedAt, amendmentEffectiveDate: "2090-02-01", amendmentReference: "Must rollback completely", amendmentMode: "amendment" }, coo), /synthetic audit failure/); }
  finally { (prisma as any).$transaction = tx; }
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: audited.id } })).amount, 100);
  assert.equal(await prisma.rentalPriceSegment.count({ where: { rentalId: audited.id } }), 1);
  assert.equal(await prisma.rentalChangeLog.count({ where: { rentalId: audited.id, action: "contract_amendment" } }), 0);
  passed("audit failure rolls back reservation, price segments and amendment log");
  const pricedHoldInput = { locationIds: [made.locations[6]], periodStart: day("2090-06-01"), periodEnd: day("2090-06-30"), clientId: client.id, campaignId: campaign.id, ownerUserId: seller.id, requestKey: `${tag}-quoted-hold`, holdExpiresAt: new Date(Date.now() + 3_600_000), quotedTerms: { currency: "EUR" as const, companyEntity: "Focus Media", quoteRevisionId: `${tag}-revision`, lines: [{ locationId: made.locations[6], monthlyRate: "123.45" }] } };
  // Earlier amendment fixtures made the campaign mixed-currency, so restore an explicit
  // source-currency fixture before testing independent quote-to-hold preservation.
  await prisma.campaign.update({ where: { id: campaign.id }, data: { currency: "EUR" } });
  const pricedHolds = await prisma.$transaction((tx) => createApprovedAgentHold(tx, pricedHoldInput, coo), reservationWriteTransactionOptions);
  assert.equal(pricedHolds[0].amount, 123.45);
  assert.equal(pricedHolds[0].currency, "EUR");
  assert.equal(pricedHolds[0].paymentTermDays, 14);
  const replayed = await prisma.$transaction((tx) => createApprovedAgentHold(tx, pricedHoldInput, coo), reservationWriteTransactionOptions);
  assert.equal(replayed[0].id, pricedHolds[0].id);
  await assert.rejects(() => prisma.$transaction((tx) => createApprovedAgentHold(tx, { ...pricedHoldInput, quotedTerms: { ...pricedHoldInput.quotedTerms, lines: [{ locationId: made.locations[6], monthlyRate: "999.99" }] } }, coo), reservationWriteTransactionOptions), /rezultat diferit/);
  const confirmed = await updateReservationGroupStatus(pricedHolds[0].id, "BOOKED", coo, { expectedVersions: versions(pricedHolds) });
  assert.equal(confirmed[0].amount, 123.45);
  assert.equal(confirmed[0].priceSegments?.[0].monthlyRent, 123.45);
  assert.equal(confirmed[0].paymentTermDays, 14);
  assert.ok(confirmed[0].notes?.includes(pricedHoldInput.quotedTerms.quoteRevisionId));
  passed("approved quote prices and provenance survive HOLD, replay and BOOKED confirmation");
  const unpriced = await prisma.reservation.create({ data: { locationId: made.locations[7], clientId: client.id, campaignId: campaign.id, clientName: tag, ownerId: seller.id, sellerUserId: seller.id, status: "BOOKED", periodStart: day("2090-01-01"), periodEnd: day("2090-03-31") } });
  const repaired = await updateReservation(unpriced.id, { monthlyRentTotal: 456, currency: "EUR", expectedUpdatedAt: unpriced.updatedAt.toISOString(), amendmentEffectiveDate: "2090-01-01", amendmentReference: "Synthetic verified original contract", amendmentMode: "correction" }, coo);
  assert.equal(repaired.amount, 456); assert.equal(repaired.monthlyRentShare, 456); assert.equal(repaired.monthlyRentTotal, 456);
  assert.equal(repaired.priceSegments?.[0].monthlyRent, 456);
  passed("a documented original contract can repair a legacy unpriced rental explicitly");
  const corrected = amendedPriceIntervals({ previousStart: day("2090-01-01"), previousEnd: day("2090-03-31"), nextStart: day("2090-01-01"), nextEnd: day("2090-03-31"), previousRent: 100, previousCurrency: "EUR", nextRent: 123, nextCurrency: "EUR", segments: [], effectiveFrom: day("2090-01-01"), reference: "Verified correction", mode: "correction" });
  assert.equal(corrected[0].monthlyRent, 123);
  assert.equal(await prisma.rentalChangeLog.count({ where: { rentalId: rental.id, action: "contract_amendment" } }), 3);
  passed("documented corrections are explicit and amendments retain reconstructible audit");
  console.log(JSON.stringify({ ok: true, suites: cases, productionTouched: false }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.reservation.deleteMany({ where: { locationId: { in: made.locations } } });
  await prisma.campaign.deleteMany({ where: { id: { in: made.campaigns } } });
  await prisma.clientAccount.deleteMany({ where: { id: { in: made.clients } } });
  await prisma.location.deleteMany({ where: { id: { in: made.locations } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.$disconnect();
});
