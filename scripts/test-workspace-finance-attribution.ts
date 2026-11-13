import assert from "node:assert/strict";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { getCampaignFinanceSummary, getClientFinanceSummary } from "../src/lib/client-campaign-workspaces";

async function main() {
  loadEnvFile(); assertSyntheticEnvironment();
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL || "").hostname));
  const p = `finance-attribution-${Date.now()}`, owner = `${p}-owner`, other = `${p}-other`, clientId = `${p}-client`, uploadId = `${p}-upload`, a = `${p}-a`, b = `${p}-b`, invoiceId = `${p}-invoice`;
  const actor = { id: owner, role: "SALES_AGENT" } as any;
  try {
    await prisma.user.createMany({ data: [owner, other].map((id) => ({ id, email: `${id}@synthetic.test`, name: id, passwordHash: "unusable", role: "SALES_AGENT", active: true })) });
    await prisma.clientAccount.create({ data: { id: clientId, companyName: p, normalizedName: p, accountOwnerUserId: owner } });
    await prisma.campaign.createMany({ data: [a, b].map((id) => ({ id, clientId, campaignName: id, currency: "RON", companyEntity: "Focus Media", sellerUserId: owner, accountOwnerUserId: owner })) });
    await prisma.financialReportUpload.create({ data: { id: uploadId, originalFileName: p, fileHash: p, status: "confirmed" } });
    const common = { uploadId, clientId, companyName: "Focus Media", companyCode: "FOCUS_MEDIA", includedInReport: true, needsReview: false, currency: "RON", status: "collected_partial", dueDate: new Date("2026-01-01Z") };
    await prisma.financialReceivable.create({ data: { ...common, id: invoiceId, campaignId: a, invoiceNumber: `${p}-shared`, invoicedAmount: 1000, netAmount: 800, vatAmount: 200, collectedAmount: 200, remainingAmount: 800 } });
    await prisma.financialInvoiceAllocation.createMany({ data: [
      { id: `${p}-allocation-a`, receivableId: invoiceId, campaignId: a, requestKey: `${p}-a`, requestFingerprint: "a".repeat(64), grossAmount: 600, netAmount: 480, vatAmount: 120, currency: "RON", createdByUserId: owner },
      { id: `${p}-allocation-b`, receivableId: invoiceId, campaignId: b, requestKey: `${p}-b`, requestFingerprint: "b".repeat(64), grossAmount: 400, netAmount: 320, vatAmount: 80, currency: "RON", createdByUserId: owner },
    ] });
    const firstA = await getCampaignFinanceSummary(actor, a), firstB = await getCampaignFinanceSummary(actor, b);
    assert.equal(firstA.invoicedRon, 600); assert.equal(firstB.invoicedRon, 400);
    assert.equal(firstA.remainingRon, null); assert.equal(firstB.collectedRon, null);
    assert.ok(firstA.dataQualityReasons.includes("CAMPAIGN_RECEIPTS_NOT_ATTRIBUTABLE"));
    assert.equal(firstA.rows[0].invoiced, 600); assert.equal(firstB.rows[0].invoiced, 400);
    let client = await getClientFinanceSummary(actor, clientId);
    assert.equal(client.invoicedRon, 1000); assert.equal(client.collectedRon, 200); assert.equal(client.remainingRon, 800);
    await assert.rejects(() => getCampaignFinanceSummary({ id: other, role: "SALES_AGENT" } as any, a), /acces/);

    await prisma.financialReceivable.update({ where: { id: invoiceId }, data: { collectedAmount: 1000, remainingAmount: 0 } });
    const paidA = await getCampaignFinanceSummary(actor, a), paidB = await getCampaignFinanceSummary(actor, b);
    assert.equal(paidA.collectedRon, 600); assert.equal(paidB.collectedRon, 400); assert.equal(paidA.remainingRon, 0);
    await prisma.financialReceivable.update({ where: { id: invoiceId }, data: { collectedAmount: 0, remainingAmount: 1000 } });
    assert.equal((await getCampaignFinanceSummary(actor, b)).remainingRon, 400);

    // A direct campaign link is context, not an authorization to duplicate the
    // complete fiscal invoice into that campaign's financial allocations.
    await prisma.financialInvoiceAllocation.deleteMany({ where: { campaignId: b } });
    await prisma.financialInvoiceAllocation.update({ where: { id: `${p}-allocation-a` }, data: { grossAmount: 1000, netAmount: 800, vatAmount: 200 } });
    await prisma.financialReceivable.update({ where: { id: invoiceId }, data: { collectedAmount: 250, remainingAmount: 750 } });
    assert.equal((await getCampaignFinanceSummary(actor, a)).remainingRon, 750);
    await prisma.financialReceivable.create({ data: { ...common, id: `${p}-unallocated`, campaignId: b, invoiceNumber: `${p}-unallocated`, invoicedAmount: 200, netAmount: 160, vatAmount: 40, collectedAmount: 0, remainingAmount: 200 } });
    const missing = await getCampaignFinanceSummary(actor, b);
    assert.equal(missing.invoicedRon, null); assert.equal(missing.unattributedInvoiceCount, 1);
    assert.ok(missing.dataQualityReasons.includes("CAMPAIGN_INVOICE_ALLOCATION_MISSING"));

    await prisma.financialReceivable.create({ data: { ...common, id: `${p}-usd`, invoiceNumber: `${p}-usd`, currency: "USD", invoicedAmount: 500, collectedAmount: 0, remainingAmount: 500 } });
    client = await getClientFinanceSummary(actor, clientId);
    assert.equal(client.invoicedRon, 1200); assert.equal(client.unknownCurrencyCount, 1);
    assert.ok(client.rows.some((row) => row.currency === "USD" && row.invoiced === 500));
    assert.ok(client.dataQualityReasons.includes("UNKNOWN_INVOICE_CURRENCY"));

    // Canonical storno affects the ledger, even when an old stored balance was
    // never refreshed. It invalidates an oversized campaign allocation.
    await prisma.financialReceivable.create({ data: { ...common, id: `${p}-credit`, invoiceNumber: `${p}-credit`, includedInReport: false, invoicedAmount: -200, netAmount: -160, vatAmount: -40, collectedAmount: 0, remainingAmount: 0 } });
    await prisma.financialReceivable.update({ where: { id: invoiceId }, data: { rawRowJson: { smartBillAdjustments: [{ adjustmentReceivableId: `${p}-credit`, adjustmentAmount: 200 }] } } });
    const adjusted = await getCampaignFinanceSummary(actor, a);
    assert.equal(adjusted.invoicedRon, null); assert.ok(adjusted.dataQualityReasons.includes("CAMPAIGN_INVOICE_ALLOCATION_INVALID"));
    client = await getClientFinanceSummary(actor, clientId);
    assert.equal(client.invoicedRon, 1000); assert.equal(client.remainingRon, 750);

    await prisma.financialReceivable.createMany({ data: Array.from({ length: 260 }, (_, index) => ({ ...common, id: `${p}-bulk-${String(index).padStart(3, "0")}`, invoiceNumber: `${p}-bulk-${index}`, invoicedAmount: 1, collectedAmount: 0, remainingAmount: 1 })) });
    client = await getClientFinanceSummary(actor, clientId);
    assert.equal(client.invoicedRon, 1260); assert.equal(client.remainingRon, 1010); assert.equal(client.rows.length, 50);
    console.log(JSON.stringify({ ok: true, checked: ["600/400 invoice allocation", "no guessed partial campaign cash", "paid/unpaid exact boundaries", "exclusive invoice cash", "unallocated context is unknown", "actual unknown currency retained", "canonical storno", "foreign seller refused", "totals across 250-row pages"] }));
  } finally {
    await prisma.financialInvoiceAllocation.deleteMany({ where: { createdByUserId: owner } });
    await prisma.financialReportUpload.deleteMany({ where: { id: uploadId } });
    await prisma.campaign.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
