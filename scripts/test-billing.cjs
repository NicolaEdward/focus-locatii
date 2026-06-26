const assert = require("node:assert/strict");
require("tsx/cjs");

const { calculateBillingItems } = require("../src/lib/billing.ts");

function d(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function day(value) {
  return value.toISOString().slice(0, 10);
}

{
  const items = calculateBillingItems({
    periodStart: d("2026-07-10"),
    periodEnd: d("2026-07-31"),
    monthlyAmount: 1000,
    currency: "EUR",
    billingRule: "month_start",
    billingFrequency: "monthly",
    paymentTermDays: 15
  });
  assert.equal(items.length, 1);
  assert.equal(day(items[0].invoiceDate), "2026-07-01");
  assert.equal(day(items[0].dueDate), "2026-07-16");
}

{
  const items = calculateBillingItems({
    periodStart: d("2026-07-01"),
    periodEnd: d("2026-07-31"),
    monthlyAmount: 1000,
    billingRule: "month_end",
    billingFrequency: "monthly",
    paymentTermDays: 30
  });
  assert.equal(day(items[0].invoiceDate), "2026-07-31");
  assert.equal(day(items[0].dueDate), "2026-08-30");
}

{
  const items = calculateBillingItems({
    periodStart: d("2026-07-10"),
    periodEnd: d("2026-08-09"),
    monthlyAmount: 1000,
    billingRule: "campaign_start",
    billingFrequency: "once",
    paymentTermDays: 7
  });
  assert.equal(items.length, 1);
  assert.equal(day(items[0].invoiceDate), "2026-07-10");
  assert.equal(day(items[0].dueDate), "2026-07-17");
}

{
  const items = calculateBillingItems({
    periodStart: d("2026-01-01"),
    periodEnd: d("2026-12-31"),
    monthlyAmount: 1000,
    billingRule: "month_start",
    billingFrequency: "monthly",
    paymentTermDays: 15
  });
  assert.equal(items.length, 12);
  assert.equal(items.reduce((sum, item) => sum + item.amount, 0), 12000);
}

{
  const items = calculateBillingItems({
    periodStart: d("2026-06-15"),
    periodEnd: d("2026-06-30"),
    monthlyAmount: 1000,
    billingRule: "month_start",
    billingFrequency: "monthly",
    paymentTermDays: 15
  });
  assert.equal(items[0].amount, 533.33);
}

console.log(JSON.stringify({ ok: true, checked: ["invoiceDate/dueDate", "month_end", "campaign_start", "12 luni", "pro-rata"] }, null, 2));
