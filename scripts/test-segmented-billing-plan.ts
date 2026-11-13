import assert from "node:assert/strict";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { generateBillingPlan, listBillingPlan } from "../src/lib/billing-plan";

const d = (value: string) => new Date(value + "T00:00:00.000Z");
async function main() {
  loadEnvFile();
  assertSyntheticEnvironment();
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL || "").hostname));
  const prefix = `segment-billing-${Date.now()}`;
  const actorId = `${prefix}-actor`, clientId = `${prefix}-client`, campaignId = `${prefix}-campaign`, categoryId = `${prefix}-category`, locationId = `${prefix}-face`, reservationId = `${prefix}-rental`;
  const actor = { id: actorId, role: "COO" } as any;
  try {
    await prisma.user.create({ data: { id: actorId, email: `${prefix}@synthetic.test`, name: "Synthetic Finance", passwordHash: "unusable", role: "COO", active: true } });
    await prisma.clientAccount.create({ data: { id: clientId, companyName: prefix, normalizedName: prefix, accountOwnerUserId: actorId } });
    await prisma.campaign.create({ data: { id: campaignId, clientId, campaignName: prefix, currency: "RON", companyEntity: "Focus Media" } });
    await prisma.category.create({ data: { id: categoryId, name: prefix, slug: prefix } });
    await prisma.location.create({ data: { id: locationId, code: locationId, categoryId } });
    await prisma.reservation.create({ data: { id: reservationId, locationId, campaignId, clientId, ownerId: actorId, sellerUserId: actorId, clientName: prefix, status: "BOOKED", periodStart: d("2026-11-01"), periodEnd: d("2026-12-31"), amount: 200, monthlyRentShare: 200, currency: "RON", contractCompany: "Focus Media", billingRule: "month_start", billingFrequency: "monthly", paymentTermDays: 7 } });
    await prisma.rentalPriceSegment.createMany({ data: [
      { id: `${prefix}-old`, rentalId: reservationId, effectiveFrom: d("2026-11-01"), effectiveTo: d("2026-11-15"), monthlyRent: 100, currency: "RON" },
      { id: `${prefix}-new`, rentalId: reservationId, effectiveFrom: d("2026-11-16"), effectiveTo: d("2026-12-31"), monthlyRent: 200, currency: "RON" },
    ] });
    assert.equal((await generateBillingPlan({ campaignId, actor })).created, 2);
    let plan = await listBillingPlan({ campaignId });
    assert.deepEqual(plan.items.map((row) => row.amount), ["150.00", "200.00"]);
    assert.equal((await generateBillingPlan({ campaignId, actor })).unchanged, 2);

    // A committed November document is immutable while a future draft may be regenerated.
    const novemberId = plan.items[0].id;
    await prisma.billingItem.update({ where: { id: novemberId }, data: { status: "invoiced", invoiceNumber: "SYNTHETIC-NOV" } });
    await prisma.rentalPriceSegment.update({ where: { id: `${prefix}-new` }, data: { effectiveTo: d("2026-11-30") } });
    await prisma.rentalPriceSegment.create({ data: { id: `${prefix}-dec`, rentalId: reservationId, effectiveFrom: d("2026-12-01"), effectiveTo: d("2026-12-31"), monthlyRent: 300, currency: "RON" } });
    await prisma.reservation.update({ where: { id: reservationId }, data: { monthlyRentShare: 300, amount: 300 } });
    const changed = await generateBillingPlan({ campaignId, actor });
    assert.equal(changed.updated, 1);
    assert.equal(changed.unchanged, 1);
    plan = await listBillingPlan({ campaignId });
    assert.deepEqual(plan.items.map((row) => row.amount), ["150.00", "300.00"]);
    assert.equal(plan.items[0].status, "invoiced");
    const before = JSON.stringify(await prisma.billingItem.findMany({ where: { reservationId }, orderBy: { id: "asc" } }));

    await prisma.rentalPriceSegment.update({ where: { id: `${prefix}-old` }, data: { monthlyRent: 110 } });
    await assert.rejects(() => generateBillingPlan({ campaignId, actor }), /document fiscal asociat|asociat unei facturi/);
    assert.equal(JSON.stringify(await prisma.billingItem.findMany({ where: { reservationId }, orderBy: { id: "asc" } })), before, "No partial draft rewrites after an immutable historical mismatch");
    await prisma.rentalPriceSegment.update({ where: { id: `${prefix}-old` }, data: { monthlyRent: 100 } });
    await prisma.rentalPriceSegment.update({ where: { id: `${prefix}-dec` }, data: { effectiveFrom: d("2026-12-02") } });
    await assert.rejects(() => generateBillingPlan({ campaignId, actor }), /PRICE_SEGMENT_GAP/);
    await prisma.rentalPriceSegment.update({ where: { id: `${prefix}-dec` }, data: { effectiveFrom: d("2026-12-01"), currency: "EUR" } });
    await assert.rejects(() => generateBillingPlan({ campaignId, actor }), /PRICE_SEGMENT_CURRENCY_MISMATCH/);
    assert.equal(JSON.stringify(await prisma.billingItem.findMany({ where: { reservationId }, orderBy: { id: "asc" } })), before);
    console.log(JSON.stringify({ ok: true, database: "synthetic-local", checked: ["price-segment join", "monthly effective-date values", "idempotent generation", "future-only draft refresh", "committed history preservation", "atomic refusal", "gap and mixed-currency gates"] }));
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    await prisma.billingItem.deleteMany({ where: { reservationId } });
    await prisma.reservation.deleteMany({ where: { id: reservationId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.location.deleteMany({ where: { id: locationId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
