import { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/receivables-domain";
import {
  receivableAdjustmentEntries,
  receivableNetAmount,
} from "@/lib/receivable-adjustments";
import { companyCodeForEntity } from "@/lib/company-entities";
import { hasAnyPermission } from "@/lib/rbac";
import { recordTransactionalAudit } from "@/lib/transactional-audit";
import { hasUnresolvedSourceFiscalReview } from "@/lib/smartbill-source-metadata";
import {
  assertSameFinancialIntent,
  financialRequestFingerprint,
} from "@/lib/financial-request-intent";

type Actor = { actor: AuthSession };
type Amounts = {
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  currency: string;
};
const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 30_000,
} as const;

function authorize(actor: AuthSession, approve = false) {
  if (
    !hasAnyPermission(
      actor.role,
      approve
        ? ["finance.confirm", "finance.manage"]
        : ["finance.validate", "finance.manage"],
    )
  )
    throw new Error("Nu ai permisiunea pentru această operație financiară.");
}
function amounts(input: Amounts) {
  if (!["RON", "EUR"].includes(input.currency))
    throw new Error(
      "Moneda trebuie să fie RON sau EUR; conversia automată nu este permisă.",
    );
  const net = money(input.netAmount),
    vat = money(input.vatAmount),
    gross = money(input.grossAmount);
  if (
    net.lessThan(0) ||
    vat.lessThan(0) ||
    !gross.greaterThan(0) ||
    !net.plus(vat).equals(gross)
  )
    throw new Error(
      "Sumele trebuie să fie pozitive și net + TVA să fie exact brutul.",
    );
  return {
    netAmount: net,
    vatAmount: vat,
    grossAmount: gross,
    currency: input.currency,
  };
}
function validateRequestKey(key: string) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new Error("Cheia operației este invalidă.");
}

async function invoiceCapacity(tx: Prisma.TransactionClient, id: string) {
  const invoice = await tx.financialReceivable.findUnique({ where: { id } });
  if (
    !invoice ||
    !invoice.includedInReport ||
    invoice.needsReview ||
    !invoice.currency
  )
    throw new Error("Factura nu există, este exclusă sau necesită verificare.");
  const adjustments = receivableAdjustmentEntries(invoice.rawRowJson);
  const creditIds = adjustments
    .map((line) => line.receivableId)
    .filter((id): id is string => Boolean(id));
  const credits = creditIds.length
    ? await tx.financialReceivable.findMany({
        where: { id: { in: creditIds } },
        select: { id: true, netAmount: true, vatAmount: true, currency: true },
      })
    : [];
  let net = money(invoice.netAmount),
    vat = money(invoice.vatAmount);
  let taxVerified = invoice.netAmount != null && invoice.vatAmount != null;
  for (const adjustment of adjustments) {
    const credit = credits.find((line) => line.id === adjustment.receivableId);
    if (
      !credit ||
      credit.currency !== invoice.currency ||
      credit.netAmount == null ||
      credit.vatAmount == null ||
      !credit.netAmount
        .abs()
        .plus(credit.vatAmount.abs())
        .equals(adjustment.amount)
    ) {
      taxVerified = false;
      continue;
    }
    net = net.minus(credit.netAmount.abs());
    vat = vat.minus(credit.vatAmount.abs());
  }
  const gross = receivableNetAmount(invoice.invoicedAmount, invoice.rawRowJson);
  taxVerified =
    taxVerified &&
    !net.lessThan(0) &&
    !vat.lessThan(0) &&
    net.plus(vat).equals(gross);
  return { invoice, net, vat, gross, taxVerified };
}

export async function attestInvoiceTaxSplit(
  input: {
    receivableId: string;
    netAmount: string;
    vatAmount: string;
    evidenceReference: string;
  } & Actor,
) {
  authorize(input.actor, true);
  if (input.evidenceReference.trim().length < 5)
    throw new Error("Referința la documentul verificat este obligatorie.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolio_financial_receivables WHERE id = ${input.receivableId} FOR UPDATE`;
    const invoice = await tx.financialReceivable.findUniqueOrThrow({
      where: { id: input.receivableId },
    });
    const net = money(input.netAmount),
      vat = money(input.vatAmount);
    const originalGross = money(invoice.invoicedAmount);
    if (
      (originalGross.greaterThanOrEqualTo(0)
        ? net.lessThan(0) || vat.lessThan(0)
        : net.greaterThan(0) || vat.greaterThan(0)) ||
      !net.plus(vat).equals(originalGross)
    )
      throw new Error(
        "Defalcarea trebuie să reconcilieze valoarea originală a documentului.",
      );
    if (
      await tx.financialInvoiceAllocation.count({
        where: { receivableId: invoice.id, status: "active" },
      })
    )
      throw new Error(
        "Documentul are alocări active; inversează controlat alocările înainte de schimbarea defalcării.",
      );
    await tx.financialReceivable.update({
      where: { id: invoice.id },
      data: {
        netAmount: net, vatAmount: vat,
        needsReview: hasUnresolvedSourceFiscalReview(invoice.rawRowJson) ? false : invoice.needsReview,
        rawRowJson: {
          ...(invoice.rawRowJson && typeof invoice.rawRowJson === "object" && !Array.isArray(invoice.rawRowJson) ? invoice.rawRowJson as Prisma.InputJsonObject : {}),
          sourceFiscalReview: null,
          fiscalTaxSplitAttestation: {
            verifiedByUserId: input.actor.id, verifiedAt: new Date().toISOString(), evidenceReference: input.evidenceReference.trim(),
            netAmount: net.toFixed(2), vatAmount: vat.toFixed(2), grossAmount: originalGross.toFixed(2)
          }
        }
      },
    });
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: "financial.invoice_tax_split_attested",
      entityType: "financial_receivable",
      entityId: invoice.id,
      metadata: {
        netAmount: net.toFixed(2),
        vatAmount: vat.toFixed(2),
        evidenceReference: input.evidenceReference.trim(),
        previousNet: invoice.netAmount?.toFixed(2),
        previousVat: invoice.vatAmount?.toFixed(2),
      },
    });
    return {
      id: invoice.id,
      netAmount: net.toFixed(2),
      vatAmount: vat.toFixed(2),
    };
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function allocateInvoiceToCampaign(
  input: {
    receivableId: string;
    campaignId: string;
    reservationId?: string | null;
    locationId?: string | null;
    billingItemId?: string | null;
    requestKey: string;
    notes?: string | null;
  } & Amounts &
    Actor,
) {
  authorize(input.actor);
  validateRequestKey(input.requestKey);
  const values = amounts(input);
  const fingerprint = financialRequestFingerprint({
    receivableId: input.receivableId,
    campaignId: input.campaignId,
    reservationId: input.reservationId || null,
    locationId: input.locationId || null,
    billingItemId: input.billingItemId || null,
    actorId: input.actor.id,
    notes: input.notes || null,
    ...Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, String(value)]),
    ),
  });
  return prisma.$transaction(async (tx) => {
    const replay = await tx.financialInvoiceAllocation.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (replay) {
      assertSameFinancialIntent(replay.requestFingerprint, fingerprint);
      return { id: replay.id, duplicate: true };
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM portfolio_financial_receivables WHERE id = ${input.receivableId} FOR UPDATE`,
    );
    const capacity = await invoiceCapacity(tx, input.receivableId);
    const { invoice } = capacity;
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    if (!campaign.clientId || invoice.clientId !== campaign.clientId)
      throw new Error(
        "Factura și campania trebuie să aparțină aceluiași client.",
      );
    if (
      !invoice.companyCode ||
      invoice.companyCode !== companyCodeForEntity(campaign.companyEntity)
    )
      throw new Error(
        "Factura și campania aparțin unor firme diferite sau nu au firma validată.",
      );
    if (
      invoice.currency !== input.currency ||
      (campaign.currency && campaign.currency !== input.currency)
    )
      throw new Error("Moneda facturii/campaniei nu corespunde alocării.");
    if (!capacity.taxVerified)
      throw new Error(
        "Defalcarea net/TVA a facturii și a stornărilor trebuie verificată înainte de alocare; nu deducem TVA dintr-un preț contractual.",
      );
    if (input.reservationId) {
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: input.reservationId },
      });
      if (
        reservation.campaignId !== campaign.id ||
        (input.locationId && reservation.locationId !== input.locationId)
      )
        throw new Error("Rezervarea/locația nu aparține campaniei selectate.");
    } else if (
      input.locationId &&
      !(await tx.reservation.count({
        where: { campaignId: campaign.id, locationId: input.locationId },
      }))
    )
      throw new Error("Locația nu aparține campaniei.");
    if (input.billingItemId) {
      const item = await tx.billingItem.findUniqueOrThrow({
        where: { id: input.billingItemId },
        include: { reservation: { select: { campaignId: true } } },
      });
      if (
        item.clientId !== invoice.clientId ||
        item.reservation?.campaignId !== campaign.id ||
        item.currency !== input.currency ||
        item.status === "superseded"
      )
        throw new Error(
          "Obligația de facturare nu corespunde documentului/campaniei.",
        );
      const prior = await tx.financialInvoiceAllocation.aggregate({
        where: { billingItemId: item.id, status: "active" },
        _sum: { netAmount: true },
      });
      if (
        money(prior._sum.netAmount)
          .plus(values.netAmount)
          .greaterThan(item.amount)
      )
        throw new Error(
          "Alocarea netă depășește valoarea contractuală planificată; reconciliază termenii înainte de asociere.",
        );
    }
    const allocated = await tx.financialInvoiceAllocation.aggregate({
      where: { receivableId: invoice.id, status: "active" },
      _sum: { netAmount: true, vatAmount: true, grossAmount: true },
    });
    if (
      money(allocated._sum.netAmount)
        .plus(values.netAmount)
        .greaterThan(capacity.net) ||
      money(allocated._sum.vatAmount)
        .plus(values.vatAmount)
        .greaterThan(capacity.vat) ||
      money(allocated._sum.grossAmount)
        .plus(values.grossAmount)
        .greaterThan(capacity.gross)
    )
      throw new Error(
        "Alocările depășesc valoarea net/TVA/brut disponibilă după storno.",
      );
    const row = await tx.financialInvoiceAllocation.create({
      data: {
        receivableId: invoice.id,
        campaignId: campaign.id,
        reservationId: input.reservationId || null,
        locationId: input.locationId || null,
        billingItemId: input.billingItemId || null,
        requestKey: input.requestKey,
        requestFingerprint: fingerprint,
        ...values,
        notes: input.notes || null,
        createdByUserId: input.actor.id,
      },
    });
    if (input.billingItemId)
      await refreshBillingAllocationState(tx, input.billingItemId);
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: "financial.invoice_allocated",
      entityType: "financial_invoice_allocation",
      entityId: row.id,
      metadata: {
        receivableId: invoice.id,
        campaignId: campaign.id,
        ...Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, String(value)]),
        ),
        requestKey: input.requestKey,
        requestFingerprint: fingerprint,
      },
    });
    return { id: row.id, duplicate: false };
  }, transactionOptions);
}

export async function reverseInvoiceAllocation(
  input: { allocationId: string; reason: string } & Actor,
) {
  authorize(input.actor, true);
  if (input.reason.trim().length < 5)
    throw new Error("Motivul inversării este obligatoriu.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.financialInvoiceAllocation.findUniqueOrThrow({
      where: { id: input.allocationId },
    });
    if (row.status === "reversed") return { duplicate: true };
    await tx.financialInvoiceAllocation.update({
      where: { id: row.id },
      data: {
        status: "reversed",
        reversedAt: new Date(),
        reversedByUserId: input.actor.id,
        reversalReason: input.reason.trim(),
      },
    });
    if (row.billingItemId)
      await refreshBillingAllocationState(tx, row.billingItemId);
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: "financial.invoice_allocation_reversed",
      entityType: "financial_invoice_allocation",
      entityId: row.id,
      metadata: { reason: input.reason.trim() },
    });
    return { duplicate: false };
  }, transactionOptions);
}

async function refreshBillingAllocationState(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const item = await tx.billingItem.findUniqueOrThrow({ where: { id } });
  const totals = await tx.financialInvoiceAllocation.aggregate({
    where: { billingItemId: id, status: "active" },
    _sum: { netAmount: true },
  });
  const linked = money(totals._sum.netAmount);
  const status = linked.equals(0)
    ? "draft"
    : linked.lessThan(item.amount)
      ? "partially_issued"
      : linked.equals(item.amount)
        ? "issued"
        : "needs_review";
  await tx.billingItem.update({ where: { id }, data: { status } });
}

export async function createCampaignCost(
  input: {
    campaignId: string;
    reservationId?: string | null;
    locationId?: string | null;
    legalEntityId: string;
    sourceDocumentId?: string | null;
    sourceReference: string;
    costType: string;
    description: string;
    requestKey: string;
  } & Amounts &
    Actor,
) {
  authorize(input.actor);
  validateRequestKey(input.requestKey);
  const values = amounts(input);
  if (
    !input.sourceReference.trim() ||
    input.description.trim().length < 5 ||
    !["media", "print", "installation", "transport", "other"].includes(
      input.costType,
    )
  )
    throw new Error(
      "Costul necesită tip, descriere și referință verificabilă.",
    );
  const fingerprint = financialRequestFingerprint({
    ...input,
    actor: input.actor.id,
  });
  return prisma.$transaction(async (tx) => {
    const existing = await tx.financialCampaignCost.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (existing) {
      assertSameFinancialIntent(existing.requestFingerprint, fingerprint);
      return { id: existing.id, duplicate: true };
    }
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    const entity = await tx.financialLegalEntity.findUniqueOrThrow({
      where: { id: input.legalEntityId },
    });
    if (entity.code !== companyCodeForEntity(campaign.companyEntity))
      throw new Error(
        "Costul și campania trebuie să aparțină aceleiași firme.",
      );
    if (campaign.currency && campaign.currency !== input.currency)
      throw new Error(
        "Moneda costului diferă de campanie; nu se face conversie automată.",
      );
    if (input.reservationId) {
      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: input.reservationId },
      });
      if (
        reservation.campaignId !== campaign.id ||
        (input.locationId && reservation.locationId !== input.locationId)
      )
        throw new Error("Rezervarea/locația costului nu aparține campaniei.");
    } else if (
      input.locationId &&
      !(await tx.reservation.count({
        where: { campaignId: campaign.id, locationId: input.locationId },
      }))
    )
      throw new Error("Locația costului nu aparține campaniei.");
    if (input.sourceDocumentId) {
      const document = await tx.clientDocument.findUniqueOrThrow({
        where: { id: input.sourceDocumentId },
      });
      if (
        document.clientId !== campaign.clientId ||
        (document.campaignId && document.campaignId !== campaign.id)
      )
        throw new Error("Documentul costului nu aparține dosarului comercial.");
    }
    const row = await tx.financialCampaignCost.create({
      data: {
        campaignId: campaign.id,
        reservationId: input.reservationId || null,
        locationId: input.locationId || null,
        legalEntityId: entity.id,
        sourceDocumentId: input.sourceDocumentId || null,
        sourceReference: input.sourceReference.trim(),
        costType: input.costType,
        description: input.description.trim(),
        requestKey: input.requestKey,
        requestFingerprint: fingerprint,
        ...values,
        createdByUserId: input.actor.id,
      },
    });
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: "financial.campaign_cost_created",
      entityType: "financial_campaign_cost",
      entityId: row.id,
      metadata: {
        campaignId: campaign.id,
        requestKey: input.requestKey,
        requestFingerprint: fingerprint,
        status: "draft",
      },
    });
    return { id: row.id, duplicate: false };
  }, transactionOptions);
}

export async function approveCampaignCost(
  input: {
    costId: string;
    expectedVersion: number;
    approve: boolean;
    reason: string;
  } & Actor,
) {
  authorize(input.actor, true);
  if (input.reason.trim().length < 5)
    throw new Error("Motivul verificării costului este obligatoriu.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.financialCampaignCost.findUniqueOrThrow({
      where: { id: input.costId },
    });
    if (row.status === "reversed")
      throw new Error(
        "Un cost inversat nu poate fi reactivat; creează o înregistrare nouă.",
      );
    const result = await tx.financialCampaignCost.updateMany({
      where: { id: row.id, version: input.expectedVersion },
      data: {
        status: input.approve ? "approved" : "reversed",
        version: { increment: 1 },
        approvedByUserId: input.actor.id,
        approvedAt: new Date(),
      },
    });
    if (result.count !== 1)
      throw new Error(
        "Costul a fost schimbat între timp. Reîncarcă înainte de aprobare.",
      );
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: input.approve
        ? "financial.campaign_cost_approved"
        : "financial.campaign_cost_reversed",
      entityType: "financial_campaign_cost",
      entityId: row.id,
      metadata: {
        previousStatus: row.status,
        expectedVersion: input.expectedVersion,
        reason: input.reason.trim(),
      },
    });
    return { id: row.id };
  }, transactionOptions);
}

export async function getCampaignFinance(
  campaignId: string,
  currency: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (client === prisma) return prisma.$transaction(tx => readCampaignFinance(campaignId, currency, tx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  return readCampaignFinance(campaignId, currency, client);
}

async function readCampaignFinance(
  campaignId: string,
  currency: string,
  client: Prisma.TransactionClient | typeof prisma,
) {
  if (!["RON", "EUR"].includes(currency))
    throw new Error("Moneda este obligatorie.");
  const [campaign, allocations, costs, review, invoices] = await Promise.all([
    client.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: {
        id: true,
        campaignName: true,
        clientId: true,
        startDate: true,
        endDate: true,
        companyEntity: true,
      },
    }),
    client.financialInvoiceAllocation.findMany({
      where: { campaignId, currency, status: "active" },
      include: {
        receivable: {
          select: {
            id: true,
            invoiceNumber: true,
            includedInReport: true,
            needsReview: true,
            invoicedAmount: true,
            rawRowJson: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.financialCampaignCost.findMany({
      where: { campaignId, currency, status: { not: "reversed" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.financialCampaignFinanceReview.findUnique({
      where: { campaignId_currency: { campaignId, currency } },
    }),
    client.financialReceivable.findMany({
      where: {
        currency,
        includedInReport: true,
        OR: [
          { campaignId },
          { campaignAllocations: { some: { campaignId, status: "active" } } },
        ],
      },
      include: {
        campaignAllocations: {
          where: { status: "active" },
          select: { netAmount: true, vatAmount: true, grossAmount: true },
        },
      },
      orderBy: { id: "asc" },
    }),
  ]);
  const revenue = allocations.reduce(
    (sum, row) => sum.plus(row.netAmount),
    money(0),
  );
  const cost = costs
    .filter((row) => row.status === "approved")
    .reduce((sum, row) => sum.plus(row.netAmount), money(0));
  const reasons = new Set<string>();
  if (!allocations.length) reasons.add("NO_REVENUE_ALLOCATIONS");
  if (!campaign.startDate || !campaign.endDate)
    reasons.add("CAMPAIGN_PERIOD_MISSING");
  if (costs.some((row) => row.status !== "approved"))
    reasons.add("COSTS_PENDING_APPROVAL");
  if (
    allocations.some(
      (row) => !row.receivable.includedInReport || row.receivable.needsReview,
    )
  )
    reasons.add("ALLOCATED_INVOICE_INVALID");
  for (const invoice of invoices) {
    const totalAllocated = invoice.campaignAllocations.reduce(
      (sum, row) => sum.plus(row.grossAmount),
      money(0),
    );
    const totalNet = invoice.campaignAllocations.reduce(
      (sum, row) => sum.plus(row.netAmount),
      money(0),
    );
    const totalVat = invoice.campaignAllocations.reduce(
      (sum, row) => sum.plus(row.vatAmount),
      money(0),
    );
    try {
      const capacity = await invoiceCapacity(client, invoice.id);
      if (!capacity.taxVerified) reasons.add("FISCAL_DATA_UNVERIFIED");
      if (
        totalAllocated.greaterThan(capacity.gross) ||
        totalNet.greaterThan(capacity.net) ||
        totalVat.greaterThan(capacity.vat)
      )
        reasons.add("INVOICE_OVERALLOCATED_AFTER_ADJUSTMENT");
    } catch {
      reasons.add("FISCAL_DATA_UNVERIFIED");
    }
    if (
      invoice.campaignId === campaignId &&
      !totalAllocated.equals(
        receivableNetAmount(invoice.invoicedAmount, invoice.rawRowJson),
      )
    )
      reasons.add("UNALLOCATED_INVOICE_REVENUE");
    if (
      invoice.needsReview ||
      invoice.netAmount == null ||
      invoice.vatAmount == null
    )
      reasons.add("FISCAL_DATA_UNVERIFIED");
  }
  const sourceFingerprint = financialRequestFingerprint({
    campaign,
    currency,
    allocations: allocations.map((row) => ({
      id: row.id,
      invoice: row.receivableId,
      net: row.netAmount.toFixed(2),
      vat: row.vatAmount.toFixed(2),
      gross: row.grossAmount.toFixed(2),
      valid: row.receivable.includedInReport,
      review: row.receivable.needsReview,
      invoiceGross: receivableNetAmount(
        row.receivable.invoicedAmount,
        row.receivable.rawRowJson,
      ).toFixed(2),
    })),
    costs: costs.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      net: row.netAmount.toFixed(2),
      vat: row.vatAmount.toFixed(2),
    })),
    invoices: invoices.map((row) => ({
      id: row.id,
      gross: receivableNetAmount(row.invoicedAmount, row.rawRowJson).toFixed(2),
      net: String(row.netAmount),
      vat: String(row.vatAmount),
      needsReview: row.needsReview,
    })),
  });
  const coverageApproved = Boolean(
    review?.costsComplete &&
      review.sourceFingerprint === sourceFingerprint &&
      campaign.startDate &&
      campaign.endDate &&
      review.coverageFrom <= campaign.startDate &&
      review.coverageTo >= campaign.endDate,
  );
  if (!coverageApproved) reasons.add("COST_COVERAGE_NOT_CONFIRMED");
  return {
    campaign,
    currency,
    calculatedAt: new Date().toISOString(),
    source: "explicit-fiscal-allocations-and-approved-sourced-costs",
    revenueNet: revenue.toFixed(2),
    approvedCostsNet: cost.toFixed(2),
    marginNet: reasons.size ? null : revenue.minus(cost).toFixed(2),
    marginPercent:
      reasons.size || !revenue.greaterThan(0)
        ? null
        : revenue
            .minus(cost)
            .div(revenue)
            .mul(100)
            .toDecimalPlaces(2)
            .toNumber(),
    dataQualityReasons: [...reasons],
    sourceFingerprint,
    coverageApproved,
    allocations: allocations.map((row) => ({
      id: row.id,
      receivableId: row.receivableId,
      invoiceNumber: row.receivable.invoiceNumber,
      netAmount: row.netAmount.toFixed(2),
      vatAmount: row.vatAmount.toFixed(2),
      grossAmount: row.grossAmount.toFixed(2),
      billingItemId: row.billingItemId,
      reservationId: row.reservationId,
      locationId: row.locationId,
    })),
    costs: costs.map((row) => ({
      ...row,
      netAmount: row.netAmount.toFixed(2),
      vatAmount: row.vatAmount.toFixed(2),
      grossAmount: row.grossAmount.toFixed(2),
    })),
  };
}

export async function approveCampaignFinanceCoverage(
  input: {
    campaignId: string;
    currency: string;
    expectedFingerprint: string;
    coverageFrom: Date;
    coverageTo: Date;
    notes: string;
  } & Actor,
) {
  authorize(input.actor, true);
  if (input.notes.trim().length < 10 || input.coverageFrom > input.coverageTo)
    throw new Error("Confirmarea necesită perioadă validă și justificare.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM portfolio_campaigns WHERE id = ${input.campaignId} FOR UPDATE`,
    );
    const data = await getCampaignFinance(input.campaignId, input.currency, tx);
    if (data.sourceFingerprint !== input.expectedFingerprint)
      throw new Error(
        "Datele financiare s-au schimbat; recitește raportul înainte de confirmare.",
      );
    if (
      !data.campaign.startDate ||
      !data.campaign.endDate ||
      input.coverageFrom > data.campaign.startDate ||
      input.coverageTo < data.campaign.endDate
    )
      throw new Error(
        "Acoperirea trebuie să includă întreaga perioadă a campaniei.",
      );
    const values = {
      coverageFrom: input.coverageFrom,
      coverageTo: input.coverageTo,
      costsComplete: true,
      sourceFingerprint: data.sourceFingerprint,
      notes: input.notes.trim(),
      approvedByUserId: input.actor.id,
      approvedAt: new Date(),
    };
    await tx.financialCampaignFinanceReview.upsert({
      where: {
        campaignId_currency: {
          campaignId: input.campaignId,
          currency: input.currency,
        },
      },
      create: {
        campaignId: input.campaignId,
        currency: input.currency,
        ...values,
      },
      update: values,
    });
    await recordTransactionalAudit(tx, {
      actor: input.actor,
      action: "financial.campaign_coverage_approved",
      entityType: "campaign",
      entityId: input.campaignId,
      metadata: {
        currency: input.currency,
        sourceFingerprint: data.sourceFingerprint,
        coverageFrom: input.coverageFrom,
        coverageTo: input.coverageTo,
        notes: input.notes.trim(),
      },
    });
    return { approved: true };
  }, transactionOptions);
}
