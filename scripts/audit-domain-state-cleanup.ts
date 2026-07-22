import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { CAMPAIGN_STATUSES } from "../src/lib/campaign-state";
import {
  FINANCIAL_UPLOAD_STATUSES,
  RECEIVABLE_IMPORT_ROW_STATUSES,
  RECEIVABLE_PAYMENT_STATUSES
} from "../src/lib/financial-state-machine";
import { databaseIdentity } from "./release/env-utils";

const RECEIVABLE_STATUSES = [
  "needs_review", "client_credit", "collected", "collected_partial", "overdue",
  "due_today", "due_soon", "in_term", "excluded", "archived", "cancelled"
] as const;

async function main() {
  const [
    campaigns,
    uploads,
    receivables,
    importRows,
    payments,
    locationStatuses,
    lifecycleStatuses,
    legacyBlocks,
    activeOverrides,
    importBatchCount,
    legacyReservationMirrorCount,
    legacyCrmCounts,
    crmV4Counts,
    operationTaskStatuses,
    operationTaskSources,
    assignedOperationTaskCount,
    totalOperationTaskCount
  ] = await Promise.all([
    prisma.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financialReportUpload.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financialReceivable.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financialReceivableImportRow.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financialReceivablePayment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.location.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.location.groupBy({ by: ["lifecycleStatus"], _count: { _all: true } }),
    prisma.location.findMany({
      where: {
        OR: [
          { blockedReason: { not: null } },
          { blockedFrom: { not: null } },
          { blockedUntil: { not: null } },
          { blockedByUserId: { not: null } },
          { blockedNotes: { not: null } }
        ]
      },
      select: { id: true, code: true, blockedReason: true, blockedFrom: true, blockedUntil: true }
    }),
    prisma.locationAvailabilityOverride.findMany({
      where: { clearedAt: null },
      select: { id: true, locationId: true, type: true, reason: true, periodStart: true, periodEnd: true }
    }),
    prisma.importBatch.count(),
    prisma.reservation.count({ where: { externalSource: "legacy-rezervari" } }),
    Promise.all([prisma.crmLead.count(), prisma.crmContact.count(), prisma.crmActivity.count()]),
    Promise.all([prisma.crmCompany.count(), prisma.crmProspect.count(), prisma.crmOpportunity.count(), prisma.crmEvent.count()]),
    prisma.operationTask.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.operationTask.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.operationTask.count({ where: { assignedToUserId: { not: null } } }),
    prisma.operationTask.count()
  ]);

  const overridesByLocation = new Map<string, typeof activeOverrides>();
  for (const override of activeOverrides) {
    const rows = overridesByLocation.get(override.locationId) || [];
    rows.push(override);
    overridesByLocation.set(override.locationId, rows);
  }
  const legacyBlockDryRun = legacyBlocks.map((location) => {
    const overrides = overridesByLocation.get(location.id) || [];
    const canonical = overrides.find((override) => override.type === "COMMERCIAL_BLOCK");
    const category = canonical
      ? "ALREADY_CANONICAL"
      : location.blockedReason && location.blockedFrom
        ? "SAFE_AUTOFILL"
        : location.blockedReason
          ? "NEEDS_REVIEW"
          : "UNRESOLVED";
    return {
      locationId: location.id,
      locationCode: location.code,
      category,
      evidence: {
        hasReason: Boolean(location.blockedReason),
        hasStart: Boolean(location.blockedFrom),
        hasEnd: Boolean(location.blockedUntil),
        activeCanonicalOverrideId: canonical?.id || null
      }
    };
  });

  const report = {
    schemaVersion: 1,
    readOnly: true,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    databaseFingerprint: databaseIdentity().fingerprint,
    states: {
      campaign: statusReport(campaigns, CAMPAIGN_STATUSES),
      financialUpload: statusReport(uploads, FINANCIAL_UPLOAD_STATUSES),
      financialReceivable: statusReport(receivables, RECEIVABLE_STATUSES),
      financialImportRow: statusReport(importRows, RECEIVABLE_IMPORT_ROW_STATUSES),
      financialPayment: statusReport(payments, RECEIVABLE_PAYMENT_STATUSES),
      locationLegacyStatus: rowsToObject(locationStatuses),
      locationLifecycleStatus: rowsToObject(lifecycleStatuses),
      operationTaskStatus: rowsToObject(operationTaskStatuses),
      operationTaskSource: rowsToObject(operationTaskSources)
    },
    compatibility: {
      legacyBlocks: {
        count: legacyBlocks.length,
        safeAutofill: legacyBlockDryRun.filter((row) => row.category === "SAFE_AUTOFILL").length,
        needsReview: legacyBlockDryRun.filter((row) => row.category === "NEEDS_REVIEW").length,
        unresolved: legacyBlockDryRun.filter((row) => row.category === "UNRESOLVED").length,
        alreadyCanonical: legacyBlockDryRun.filter((row) => row.category === "ALREADY_CANONICAL").length,
        rows: legacyBlockDryRun
      },
      importBatch: { count: importBatchCount, classification: "ACTIVE_INVENTORY_AUDIT" },
      reservationSync: { mirroredRows: legacyReservationMirrorCount, apiPolicy: "RETIRED_410" },
      crmLegacyHistory: { leads: legacyCrmCounts[0], contacts: legacyCrmCounts[1], activities: legacyCrmCounts[2], policy: "READ_ONLY" },
      crmV4: { companies: crmV4Counts[0], prospects: crmV4Counts[1], opportunities: crmV4Counts[2], events: crmV4Counts[3] },
      operationTask: {
        total: totalOperationTaskCount,
        assigned: assignedOperationTaskCount,
        unassigned: totalOperationTaskCount - assignedOperationTaskCount,
        policy: "PILOT_DUAL_READ_KEEP_COMPATIBILITY"
      }
    },
    gates: {
      unknownCampaignStates: unknownStates(campaigns, CAMPAIGN_STATUSES),
      unknownFinancialUploadStates: unknownStates(uploads, FINANCIAL_UPLOAD_STATUSES),
      unknownReceivableStates: unknownStates(receivables, RECEIVABLE_STATUSES),
      unknownImportRowStates: unknownStates(importRows, RECEIVABLE_IMPORT_ROW_STATUSES),
      unknownPaymentStates: unknownStates(payments, RECEIVABLE_PAYMENT_STATUSES),
      destructiveContractAllowed: false,
      reason: "OperationTask is still a pilot dual-read domain and legacy columns retain read compatibility."
    }
  };

  const checksum = crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), checksum, ...report }, null, 2));
}

function rowsToObject<T extends { _count: { _all: number } }>(rows: T[]) {
  return Object.fromEntries(rows.map((row) => {
    const [key] = Object.keys(row).filter((candidate) => candidate !== "_count");
    return [String((row as Record<string, unknown>)[key]), row._count._all];
  }));
}

function unknownStates<T extends { status: string; _count: { _all: number } }>(rows: T[], allowed: readonly string[]) {
  return rows.filter((row) => !allowed.includes(row.status)).map((row) => ({ status: row.status, count: row._count._all }));
}

function statusReport<T extends { status: string; _count: { _all: number } }>(rows: T[], allowed: readonly string[]) {
  return { counts: rowsToObject(rows), allowed, unknown: unknownStates(rows, allowed) };
}

main().finally(() => prisma.$disconnect());
