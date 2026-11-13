import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
import { prisma } from "../src/lib/prisma";
import { generateBillingPlan, listBillingPlan } from "../src/lib/billing-plan";
import {
  allocateInvoiceToCampaign,
  approveCampaignCost,
  approveCampaignFinanceCoverage,
  attestInvoiceTaxSplit,
  createCampaignCost,
  getCampaignFinance,
  reverseInvoiceAllocation,
} from "../src/lib/campaign-finance";
import { syncFinancialNotifications } from "../src/lib/notifications";
import { deriveCampaignCommercialSummary } from "../src/lib/campaigns/campaign-commercial-summary";
import { currentFinancialReportScope } from "../src/lib/financial-report-scope";

async function main() {
  loadEnvFile();
  assertSyntheticEnvironment();
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const prefix = `finance-workflow-${Date.now()}`;
  const actorId = `${prefix}-actor`,
    clientId = `${prefix}-client`,
    campaignId = `${prefix}-campaign`,
    secondCampaignId = `${prefix}-other`,
    categoryId = `${prefix}-category`,
    uploadId = `${prefix}-upload`,
    invoiceId = `${prefix}-invoice`;
  const actor = { id: actorId, role: "COO" } as any;
  let entity = await prisma.financialLegalEntity.findUnique({
    where: { code: "FOCUS_MEDIA" },
  });
  let ownsEntity = false;
  if (!entity) {
    entity = await prisma.financialLegalEntity.create({
      data: {
        id: `${prefix}-entity`,
        code: "FOCUS_MEDIA",
        legalName: "Synthetic Focus Media",
        normalizedName: prefix,
      },
    });
    ownsEntity = true;
  }
  const entityId = entity.id;
  try {
    await prisma.user.create({
      data: {
        id: actorId,
        email: `${prefix}@synthetic.test`,
        name: "Synthetic Finance Reviewer",
        passwordHash: "unusable-synthetic",
        role: "COO",
        active: true,
      },
    });
    await prisma.clientAccount.create({
      data: {
        id: clientId,
        companyName: "Synthetic Billing Client",
        normalizedName: prefix,
        accountOwnerUserId: actorId,
      },
    });
    await prisma.category.create({
      data: { id: categoryId, name: prefix, slug: prefix },
    });
    await prisma.campaign.createMany({
      data: [campaignId, secondCampaignId].map((id) => ({
        id,
        clientId,
        campaignName: id,
        companyEntity: "Focus Media",
        currency: "RON",
        startDate: new Date("2026-11-16Z"),
        endDate: new Date("2026-11-30Z"),
      })),
    });
    const shares = [33.34, 33.33, 33.33];
    for (let index = 0; index < 3; index++) {
      const locationId = `${prefix}-location${index}`;
      await prisma.location.create({
        data: { id: locationId, code: locationId, categoryId },
      });
      await prisma.reservation.create({
        data: {
          id: `${prefix}-reservation${index}`,
          locationId,
          campaignId,
          clientId,
          clientName: "Synthetic Client",
          ownerId: actorId,
          sellerUserId: actorId,
          status: "BOOKED",
          contractCompany: "Focus Media",
          contractGroupId: prefix,
          monthlyRentShare: shares[index],
          amount: shares[index],
          monthlyRentTotal: 100,
          currency: "RON",
          periodStart: new Date("2026-11-16Z"),
          periodEnd: new Date("2026-11-30Z"),
          billingRule: "month_start",
          billingFrequency: "monthly",
          paymentTermDays: 7,
        },
      });
    }
    const reservations = await prisma.reservation.findMany({
      where: { campaignId },
    });
    assert.equal(
      deriveCampaignCommercialSummary(reservations).totalContractValue,
      50,
    );
    const first = await generateBillingPlan({ campaignId, actor });
    assert.equal(first.created, 3);
    const second = await generateBillingPlan({ campaignId, actor });
    assert.equal(second.created, 0);
    assert.equal(second.unchanged, 3);
    let plan = await listBillingPlan({ campaignId });
    assert.equal(plan.total, 3);
    assert.equal(
      plan.items
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0))
        .toFixed(2),
      "50.00",
    );
    assert.ok(
      plan.items.every(
        (item) => item.responsible === "Synthetic Finance Reviewer",
      ),
    );
    await prisma.financialReportUpload.create({
      data: {
        id: uploadId,
        originalFileName: `${prefix}.xlsx`,
        fileHash: `smartbill-${prefix}`,
        status: "confirmed",
        activeVersion: false,
        legalEntityId: entityId,
      },
    });
    const common = {
      uploadId,
      clientId,
      legalEntityId: entityId,
      companyCode: "FOCUS_MEDIA",
      companyName: "Focus Media",
      currency: "RON",
      includedInReport: true,
      needsReview: false,
      status: "in_term",
    };
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: invoiceId,
        invoiceNumber: prefix,
        invoicedAmount: "1200",
        netAmount: "1000",
        vatAmount: "200",
        collectedAmount: "0",
        remainingAmount: "1200",
      },
    });
    const allocate = {
      campaignId,
      receivableId: invoiceId,
      currency: "RON",
      netAmount: "400",
      vatAmount: "80",
      grossAmount: "480",
      requestKey: `${prefix}-allocate`,
      actor,
    };
    const allocation = await allocateInvoiceToCampaign(allocate);
    assert.equal((await allocateInvoiceToCampaign(allocate)).duplicate, true);
    await assert.rejects(
      () =>
        allocateInvoiceToCampaign({
          ...allocate,
          netAmount: "300",
          grossAmount: "380",
        }),
      /alte date/,
    );
    await allocateInvoiceToCampaign({
      ...allocate,
      campaignId: secondCampaignId,
      netAmount: "600",
      vatAmount: "120",
      grossAmount: "720",
      requestKey: `${prefix}-second`,
    });
    await assert.rejects(
      () =>
        allocateInvoiceToCampaign({
          ...allocate,
          netAmount: "1",
          vatAmount: "0",
          grossAmount: "1",
          requestKey: `${prefix}-excess`,
        }),
      /depășesc/,
    );
    await assert.rejects(
      () =>
        allocateInvoiceToCampaign({
          ...allocate,
          currency: "EUR",
          requestKey: `${prefix}-currency`,
        }),
      /Moneda/,
    );
    const costInput = {
      campaignId,
      legalEntityId: entityId,
      currency: "RON",
      netAmount: "200",
      vatAmount: "40",
      grossAmount: "240",
      sourceReference: "Synthetic supplier invoice ref",
      description: "Synthetic printing and installation",
      costType: "print",
      requestKey: `${prefix}-cost`,
      actor,
    };
    const cost = await createCampaignCost(costInput);
    assert.equal((await createCampaignCost(costInput)).duplicate, true);
    let report = await getCampaignFinance(campaignId, "RON");
    assert.equal(report.marginNet, null);
    assert.ok(report.dataQualityReasons.includes("COSTS_PENDING_APPROVAL"));
    await approveCampaignCost({
      costId: cost.id,
      expectedVersion: 0,
      approve: true,
      reason: "Synthetic document verified",
      actor,
    });
    await assert.rejects(
      () =>
        approveCampaignCost({
          costId: cost.id,
          expectedVersion: 0,
          approve: true,
          reason: "Stale synthetic approval",
          actor,
        }),
      /schimbat/,
    );
    report = await getCampaignFinance(campaignId, "RON");
    await approveCampaignFinanceCoverage({
      campaignId,
      currency: "RON",
      expectedFingerprint: report.sourceFingerprint,
      coverageFrom: new Date("2026-11-16Z"),
      coverageTo: new Date("2026-11-30Z"),
      notes: "Synthetic all source costs reviewed for campaign",
      actor,
    });
    report = await getCampaignFinance(campaignId, "RON");
    assert.equal(report.marginNet, "200.00");
    await createCampaignCost({
      ...costInput,
      netAmount: "10",
      vatAmount: "2",
      grossAmount: "12",
      requestKey: `${prefix}-new-cost`,
    });
    report = await getCampaignFinance(campaignId, "RON");
    assert.equal(report.marginNet, null);
    assert.equal(report.coverageApproved, false);
    // Adjustment invalidates fiscal allocation capacity, never presents stale profit.
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: `${prefix}-credit`,
        invoiceNumber: `${prefix}-credit`,
        invoicedAmount: "-300",
        includedInReport: false,
        remainingAmount: "0",
        collectedAmount: "0",
      },
    });
    await assert.rejects(
      () =>
        attestInvoiceTaxSplit({
          receivableId: `${prefix}-credit`,
          netAmount: "250",
          vatAmount: "50",
          evidenceReference: "Synthetic negative fiscal document",
          actor,
        }),
      /reconcilieze/,
    );
    await attestInvoiceTaxSplit({
      receivableId: `${prefix}-credit`,
      netAmount: "-250",
      vatAmount: "-50",
      evidenceReference: "Synthetic negative fiscal document",
      actor,
    });
    await prisma.financialReceivable.update({
      where: { id: invoiceId },
      data: {
        rawRowJson: {
          smartBillAdjustments: [
            {
              adjustmentReceivableId: `${prefix}-credit`,
              adjustmentAmount: 300,
            },
          ],
        },
      },
    });
    report = await getCampaignFinance(campaignId, "RON");
    assert.ok(
      report.dataQualityReasons.includes(
        "INVOICE_OVERALLOCATED_AFTER_ADJUSTMENT",
      ),
    );
    await reverseInvoiceAllocation({
      allocationId: allocation.id,
      reason: "Synthetic allocation reversal",
      actor,
    });
    assert.equal(
      (
        await reverseInvoiceAllocation({
          allocationId: allocation.id,
          reason: "Synthetic repeat reversal",
          actor,
        })
      ).duplicate,
      true,
    );
    const billingInvoiceId = `${prefix}-billing-invoice`;
    await prisma.financialReceivable.create({
      data: {
        ...common,
        id: billingInvoiceId,
        campaignId,
        invoiceNumber: billingInvoiceId,
        invoicedAmount: "60",
        netAmount: "50",
        vatAmount: "10",
        collectedAmount: "0",
        remainingAmount: "60",
      },
    });
    plan = await listBillingPlan({ campaignId });
    for (let index = 0; index < plan.items.length; index++) {
      const item = plan.items[index];
      const vat = new Prisma.Decimal(20).minus(item.amount).toFixed(2);
      await allocateInvoiceToCampaign({
        campaignId,
        receivableId: billingInvoiceId,
        billingItemId: item.id,
        currency: "RON",
        netAmount: item.amount,
        vatAmount: vat,
        grossAmount: "20",
        requestKey: `${prefix}-billing-${index}`,
        actor,
      });
    }
    plan = await listBillingPlan({ campaignId });
    assert.ok(
      plan.items.every(
        (item) => item.status === "issued" && item.unlinkedAmount === "0.00",
      ),
    );
    assert.equal(
      (await generateBillingPlan({ campaignId, actor })).unchanged,
      3,
    );
    await prisma.reservation.update({
      where: { id: reservations[0].id },
      data: { periodStart: new Date("2026-11-17Z") },
    });
    await assert.rejects(
      () => generateBillingPlan({ campaignId, actor }),
      /Perioada|asociat/,
    );
    assert.equal(await prisma.billingItem.count({ where: { clientId } }), 3);
    // Canonical reporting is independent of the newest upload.
    const scope = await currentFinancialReportScope();
    assert.ok(scope.uploadIds.includes(uploadId));
    assert.equal(
      await prisma.financialReceivable.count({
        where: { AND: [scope.receivables, { id: invoiceId }] },
      }),
      1,
    );
    // More than one page, debts over 90 days old, and non-reminder day remain open.
    const debtRows = Array.from({ length: 505 }, (_, index) => ({
      ...common,
      id: `${prefix}-debt-${String(index).padStart(4, "0")}`,
      canonicalKey: `${prefix}-debt-${index}`,
      invoiceNumber: `${prefix}-${index}`,
      invoicedAmount: new Prisma.Decimal(10),
      collectedAmount: new Prisma.Decimal(0),
      remainingAmount: new Prisma.Decimal(10),
      dueDate: new Date("2026-01-01Z"),
    }));
    await prisma.financialReceivable.createMany({ data: debtRows });
    await syncFinancialNotifications(new Date("2026-11-13Z"));
    assert.equal(
      await prisma.appNotification.count({
        where: {
          userId: actorId,
          entityId: { startsWith: `${prefix}-debt-` },
          status: { in: ["open", "in_progress"] },
        },
      }),
      505,
    );
    await syncFinancialNotifications(new Date("2026-11-14Z"));
    assert.equal(
      await prisma.appNotification.count({
        where: {
          userId: actorId,
          entityId: { startsWith: `${prefix}-debt-` },
          status: { in: ["open", "in_progress"] },
        },
      }),
      505,
    );
    await prisma.financialReceivable.update({
      where: { id: debtRows[0].id },
      data: { collectedAmount: "10", remainingAmount: "0" },
    });
    await syncFinancialNotifications(new Date("2026-11-14Z"));
    assert.equal(
      await prisma.appNotification.count({
        where: {
          userId: actorId,
          entityId: debtRows[0].id,
          status: "archived",
        },
      }),
      1,
    );
    console.log(
      JSON.stringify(
        {
          billingIdempotent: true,
          partialGroupTotal: "50.00",
          multiCampaignInvoiceCapacity: true,
          marginRequiresApprovedCompleteCosts: true,
          adjustmentInvalidatesMargin: true,
          canonicalOlderImportIncluded: true,
          unpaid505OldDebtsRemainOpenAcrossNonReminderDays: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    await prisma.appNotification.deleteMany({ where: { userId: actorId } });
    await prisma.financialCampaignFinanceReview.deleteMany({
      where: { campaignId: { in: [campaignId, secondCampaignId] } },
    });
    await prisma.financialCampaignCost.deleteMany({
      where: { campaignId: { in: [campaignId, secondCampaignId] } },
    });
    await prisma.financialInvoiceAllocation.deleteMany({
      where: { campaignId: { in: [campaignId, secondCampaignId] } },
    });
    await prisma.billingItem.deleteMany({ where: { clientId } });
    await prisma.financialReceivable.deleteMany({ where: { clientId } });
    await prisma.reservation.deleteMany({ where: { campaignId } });
    await prisma.location.deleteMany({ where: { categoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.campaign.deleteMany({
      where: { id: { in: [campaignId, secondCampaignId] } },
    });
    await prisma.financialReportUpload.deleteMany({ where: { id: uploadId } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    if (ownsEntity)
      await prisma.financialLegalEntity.delete({ where: { id: entityId } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
