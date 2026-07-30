import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isSellerCapableRole, SELLER_CAPABLE_ROLES } from "@/lib/sales-roles";

export const OWNERSHIP_EVIDENCE_PRECEDENCE = [
  "DIRECT_OWNER",
  "CAMPAIGN_SELLER",
  "CAMPAIGN_OWNER",
  "CLIENT_OWNER",
  "CREATED_BY",
  "AUDIT_CREATOR",
  "LEGACY_SELLER_EXACT",
  "RELATED_RECORD_OWNER",
  "EXACT_CAMPAIGN_NAME"
] as const;

export type OwnershipClassification = "SAFE_AUTOFILL" | "NEEDS_REVIEW" | "UNRESOLVED";
export type OwnershipEntityType = "reservation" | "client" | "campaign";
export type OwnershipTargetType = "USER" | "CAMPAIGN" | "CLIENT";

export type OwnershipEvidence = {
  source: typeof OWNERSHIP_EVIDENCE_PRECEDENCE[number];
  candidateId: string;
  candidateType: OwnershipTargetType;
  label: string;
};

export type OwnershipPatch = Record<string, string | null>;

export type OwnershipIntegrityItem = {
  id: string;
  entityType: OwnershipEntityType;
  entityId: string;
  label: string;
  status: string;
  reasonCode:
    | "MISSING_RESERVATION_SELLER"
    | "INACTIVE_RESERVATION_SELLER"
    | "MISSING_RESERVATION_CAMPAIGN"
    | "MISSING_BOOKED_CLIENT"
    | "MISSING_CLIENT_OWNER"
    | "INACTIVE_CLIENT_OWNER"
    | "MISSING_CAMPAIGN_SELLER"
    | "INACTIVE_CAMPAIGN_SELLER"
    | "MISSING_CAMPAIGN_OWNER"
    | "INACTIVE_CAMPAIGN_OWNER";
  classification: OwnershipClassification;
  evidence: OwnershipEvidence[];
  before: OwnershipPatch;
  suggestedPatch: OwnershipPatch | null;
};

export type OwnershipIntegrityReport = {
  generatedAt: string;
  policyVersion: 1;
  precedence: readonly string[];
  counts: {
    reservationsTotal: number;
    reservationsWithoutSeller: number;
    reservationsWithoutCampaign: number;
    bookedWithoutClientOrCampaign: number;
    clientsWithoutOwner: number;
    clientsWithoutOwnerAllStatuses: number;
    inactiveUsers: number;
  };
  breakdown: {
    reservationsWithoutSellerByStatus: Record<string, number>;
    reservationsWithoutCampaignByStatus: Record<string, number>;
    clientsWithoutOwnerByStatus: Record<string, number>;
    reservationsWithoutSellerWithDirectOwner: number;
    reservationsWithoutSellerWithoutEvidence: number;
    reservationsWithoutSellerWithLegacySource: number;
    safeAutofillByReason: Record<string, number>;
  };
  classifications: Record<OwnershipClassification, number>;
  causes: Record<string, number>;
  financeLegacy: {
    unresolvedImportIssues: number;
    receivablesNeedingReview: number;
    receivablesWithoutOwner: number;
    ledgerMismatchCount: number;
    collectedWithoutLedgerCount: number;
  };
  operationalAssignment: {
    total: number;
    active: number;
    activeUnassigned: number;
    activeAssignedToInactiveUser: number;
  };
  items: OwnershipIntegrityItem[];
};

export type OwnershipRemediationDryRun = {
  batchId: string;
  generatedAt: string;
  selectedCount: number;
  applicableCount: number;
  blockedCount: number;
  items: OwnershipIntegrityItem[];
};

export type UserDependencySummary = {
  clients: number;
  campaigns: number;
  reservations: number;
  receivables: number;
  crmProspects: number;
  crmOpportunities: number;
  crmActions: number;
  operationalTasks: number;
};

type Seller = { id: string; name: string; email: string; active: boolean; role: string };

export function classifyOwnershipEvidence(
  evidence: OwnershipEvidence[],
  options: { forceReview?: boolean } = {}
): { classification: OwnershipClassification; candidateId: string | null } {
  const candidates = [...new Set(evidence.map((item) => `${item.candidateType}:${item.candidateId}`))];
  if (!candidates.length) return { classification: "UNRESOLVED", candidateId: null };
  const candidateId = candidates[0].slice(candidates[0].indexOf(":") + 1);
  if (options.forceReview || candidates.length > 1) return { classification: "NEEDS_REVIEW", candidateId: null };
  return { classification: "SAFE_AUTOFILL", candidateId };
}

export function ownershipBatchId(items: OwnershipIntegrityItem[]) {
  const body = items
    .map((item) => ({ id: item.id, before: item.before, suggestedPatch: item.suggestedPatch }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `own_${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 20)}`;
}

export function buildOwnershipRemediationDryRun(
  report: OwnershipIntegrityReport,
  selectedIds?: string[]
): OwnershipRemediationDryRun {
  const selected = selectedIds?.length
    ? report.items.filter((item) => new Set(selectedIds).has(item.id))
    : report.items.filter((item) => item.classification === "SAFE_AUTOFILL");
  return {
    batchId: ownershipBatchId(selected),
    generatedAt: report.generatedAt,
    selectedCount: selected.length,
    applicableCount: selected.filter((item) => item.classification === "SAFE_AUTOFILL" && item.suggestedPatch).length,
    blockedCount: selected.filter((item) => item.classification !== "SAFE_AUTOFILL" || !item.suggestedPatch).length,
    items: selected
  };
}

export function canCompensateOwnershipChange(current: OwnershipPatch, applied: OwnershipPatch) {
  return Object.entries(applied).every(([field, value]) => current[field] === value);
}

export async function getUserActiveDependencySummary(userId: string, now = new Date()): Promise<UserDependencySummary> {
  const [clients, campaigns, reservations, receivables, crmProspects, crmOpportunities, crmActions, operationalTasks] = await Promise.all([
    prisma.clientAccount.count({ where: { accountOwnerUserId: userId, status: { notIn: ["archived", "merged"] } } }),
    prisma.campaign.count({ where: { archivedAt: null, status: { not: "archived" }, OR: [{ sellerUserId: userId }, { accountOwnerUserId: userId }] } }),
    prisma.reservation.count({
      where: {
        OR: [{ sellerUserId: userId }, { ownerId: userId }],
        status: { in: ["HOLD", "RESERVED", "BOOKED"] },
        periodEnd: { gte: now }
      }
    }),
    prisma.financialReceivable.count({ where: { accountOwnerUserId: userId, includedInReport: true, remainingAmount: { gt: 0 } } }),
    prisma.crmProspect.count({ where: { ownerId: userId, status: { in: ["prospecting", "qualified"] } } }),
    prisma.crmOpportunity.count({ where: { ownerId: userId, stage: { in: ["opportunity", "quoted", "negotiation", "contracting", "on_hold"] } } }),
    prisma.crmNextAction.count({ where: { ownerId: userId, status: "open" } }),
    prisma.operationTask.count({ where: { assignedToUserId: userId, status: { in: ["NEW", "IN_PROGRESS"] } } })
  ]);
  return { clients, campaigns, reservations, receivables, crmProspects, crmOpportunities, crmActions, operationalTasks };
}

export function dependencyTotal(summary: UserDependencySummary) {
  return Object.values(summary).reduce((sum, count) => sum + count, 0);
}

export async function assertUserCanBeDeactivated(userId: string, now = new Date()) {
  const summary = await getUserActiveDependencySummary(userId, now);
  if (dependencyTotal(summary) > 0) {
    throw new Error(
      `Utilizatorul are dependente active (${dependencyTotal(summary)}). Ruleaza mai intai dry-run-ul de realocare din Integritate date.`
    );
  }
  return summary;
}

export async function assertClientCanBeArchived(clientId: string) {
  const [campaigns, reservations, receivables] = await Promise.all([
    prisma.campaign.count({ where: { clientId, archivedAt: null, status: { not: "archived" } } }),
    prisma.reservation.count({ where: { clientId, status: { in: ["HOLD", "RESERVED", "BOOKED"] }, periodEnd: { gte: new Date() } } }),
    prisma.financialReceivable.count({ where: { clientId, includedInReport: true, remainingAmount: { gt: 0 } } })
  ]);
  if (campaigns || reservations || receivables) {
    throw new Error(
      `Clientul are dependente active (campanii ${campaigns}, rezervari ${reservations}, facturi deschise ${receivables}) si nu poate fi arhivat.`
    );
  }
}

export async function applyOwnershipRemediationBatch(input: {
  selectedIds: string[];
  expectedBatchId: string;
  actorId: string;
  reason: string;
}) {
  assertProductionRemediationEnabled();
  if (input.reason.trim().length < 10) throw new Error("Motivul batch-ului trebuie sa aiba cel putin 10 caractere.");
  const priorBatch = await prisma.auditLog.findFirst({
    where: { action: "ownership.remediation.batch_applied", entityType: "ownership_batch", entityId: input.expectedBatchId },
    select: { id: true }
  });
  if (priorBatch) return { batchId: input.expectedBatchId, updated: 0, idempotent: true };
  const report = await getOwnershipIntegrityReport();
  const dryRun = buildOwnershipRemediationDryRun(report, input.selectedIds);
  if (dryRun.batchId !== input.expectedBatchId) throw new Error("Datele s-au schimbat dupa dry-run. Genereaza din nou raportul.");
  if (!dryRun.items.length || dryRun.blockedCount) throw new Error("Batch-ul contine elemente care necesita verificare manuala.");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.auditLog.findFirst({
      where: { action: "ownership.remediation.batch_applied", entityType: "ownership_batch", entityId: dryRun.batchId },
      select: { id: true }
    });
    if (existing) return { batchId: dryRun.batchId, updated: 0, idempotent: true };

    for (const item of dryRun.items) {
      await applyIntegrityItem(tx, item);
      await tx.auditLog.create({
        data: {
          userId: input.actorId,
          action: "ownership.remediation.item_applied",
          entityType: item.entityType,
          entityId: item.entityId,
          metadata: jsonMetadata({ batchId: dryRun.batchId, reason: input.reason.trim(), before: item.before, after: item.suggestedPatch, evidence: item.evidence })
        }
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "ownership.remediation.batch_applied",
        entityType: "ownership_batch",
        entityId: dryRun.batchId,
        metadata: jsonMetadata({ reason: input.reason.trim(), itemIds: dryRun.items.map((item) => item.id), updated: dryRun.items.length })
      }
    });
    return { batchId: dryRun.batchId, updated: dryRun.items.length, idempotent: false };
  });
}

export async function rollbackOwnershipRemediationBatch(input: {
  batchId: string;
  actorId: string;
  reason: string;
}) {
  assertProductionRemediationEnabled();
  if (input.reason.trim().length < 10) throw new Error("Motivul compensarii trebuie sa aiba cel putin 10 caractere.");
  const rows = await prisma.auditLog.findMany({
    where: { action: "ownership.remediation.item_applied", metadata: { path: "$.batchId", equals: input.batchId } },
    select: { id: true, entityType: true, entityId: true, metadata: true },
    orderBy: { createdAt: "desc" }
  });
  if (!rows.length) throw new Error("Batch-ul nu exista sau nu are modificari compensabile.");

  return prisma.$transaction(async (tx) => {
    const alreadyRolledBack = await tx.auditLog.findFirst({
      where: { action: "ownership.remediation.batch_compensated", entityType: "ownership_batch", entityId: input.batchId },
      select: { id: true }
    });
    if (alreadyRolledBack) return { batchId: input.batchId, restored: 0, idempotent: true };
    let restored = 0;
    for (const row of rows) {
      if (!row.entityId) continue;
      const metadata = asMetadata(row.metadata);
      const before = asPatch(metadata.before);
      const after = asPatch(metadata.after);
      const current = await currentOwnershipPatch(tx, row.entityType as OwnershipEntityType, row.entityId, Object.keys(after));
      if (!canCompensateOwnershipChange(current, after)) {
        throw new Error(`Compensarea a fost oprita: ${row.entityType}:${row.entityId} a fost modificat dupa batch.`);
      }
      await updateOwnershipPatch(tx, row.entityType as OwnershipEntityType, row.entityId, before);
      restored += 1;
    }
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "ownership.remediation.batch_compensated",
        entityType: "ownership_batch",
        entityId: input.batchId,
        metadata: jsonMetadata({ reason: input.reason.trim(), restored })
      }
    });
    return { batchId: input.batchId, restored, idempotent: false };
  });
}

export async function getSellerReassignmentDryRun(sourceUserId: string, targetUserId: string) {
  if (sourceUserId === targetUserId) throw new Error("Alege doi utilizatori diferiti.");
  const [source, target, dependencies] = await Promise.all([
    prisma.user.findUnique({ where: { id: sourceUserId }, select: { id: true, name: true, active: true, role: true } }),
    prisma.user.findFirst({ where: { id: targetUserId, active: true, role: { in: [...SELLER_CAPABLE_ROLES] } }, select: { id: true, name: true, role: true } }),
    getUserActiveDependencySummary(sourceUserId)
  ]);
  if (!source) throw new Error("Utilizatorul sursa nu exista.");
  if (!target) throw new Error("Destinatarul trebuie sa fie un utilizator comercial activ.");
  const batchId = `reassign_${createHash("sha256").update(JSON.stringify({ sourceUserId, targetUserId, dependencies })).digest("hex").slice(0, 20)}`;
  return { batchId, source, target, dependencies, total: dependencyTotal(dependencies) };
}

export async function applySellerReassignment(input: {
  sourceUserId: string;
  targetUserId: string;
  expectedBatchId: string;
  actorId: string;
  reason: string;
}) {
  assertProductionRemediationEnabled();
  if (input.reason.trim().length < 10) throw new Error("Motivul realocarii trebuie sa aiba cel putin 10 caractere.");
  const priorBatch = await prisma.auditLog.findFirst({
    where: { action: "ownership.reassign.batch_applied", entityType: "ownership_batch", entityId: input.expectedBatchId },
    select: { id: true }
  });
  if (priorBatch) return { batchId: input.expectedBatchId, idempotent: true, updated: {} };
  const dryRun = await getSellerReassignmentDryRun(input.sourceUserId, input.targetUserId);
  if (dryRun.batchId !== input.expectedBatchId) throw new Error("Dependentele s-au schimbat dupa dry-run. Reia verificarea.");
  if (dryRun.dependencies.operationalTasks) {
    throw new Error("Utilizatorul are taskuri operationale active. Acestea necesita Assignment operational separat.");
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.auditLog.findFirst({ where: { action: "ownership.reassign.batch_applied", entityId: dryRun.batchId }, select: { id: true } });
    if (existing) return { batchId: dryRun.batchId, idempotent: true, updated: dryRun.dependencies };
    const activeCampaign = { archivedAt: null, status: { not: "archived" } } satisfies Prisma.CampaignWhereInput;
    const activeReservation = { status: { in: ["HOLD", "RESERVED", "BOOKED"] }, periodEnd: { gte: new Date() } } satisfies Prisma.ReservationWhereInput;
    const affected = {
      clients: await ids(tx.clientAccount.findMany({ where: { accountOwnerUserId: input.sourceUserId, status: { notIn: ["archived", "merged"] } }, select: { id: true } })),
      campaignSeller: await ids(tx.campaign.findMany({ where: { ...activeCampaign, sellerUserId: input.sourceUserId }, select: { id: true } })),
      campaignOwner: await ids(tx.campaign.findMany({ where: { ...activeCampaign, accountOwnerUserId: input.sourceUserId }, select: { id: true } })),
      reservationSeller: await ids(tx.reservation.findMany({ where: { ...activeReservation, sellerUserId: input.sourceUserId }, select: { id: true } })),
      reservationOwner: await ids(tx.reservation.findMany({ where: { ...activeReservation, ownerId: input.sourceUserId }, select: { id: true } })),
      receivables: await ids(tx.financialReceivable.findMany({ where: { accountOwnerUserId: input.sourceUserId, includedInReport: true, remainingAmount: { gt: 0 } }, select: { id: true } })),
      crmProspects: await ids(tx.crmProspect.findMany({ where: { ownerId: input.sourceUserId, status: { in: ["prospecting", "qualified"] } }, select: { id: true } })),
      crmOpportunities: await ids(tx.crmOpportunity.findMany({ where: { ownerId: input.sourceUserId, stage: { in: ["opportunity", "quoted", "negotiation", "contracting", "on_hold"] } }, select: { id: true } })),
      crmActions: await ids(tx.crmNextAction.findMany({ where: { ownerId: input.sourceUserId, status: "open" }, select: { id: true } }))
    };
    const clients = await tx.clientAccount.updateMany({ where: { id: { in: affected.clients }, accountOwnerUserId: input.sourceUserId }, data: { accountOwnerUserId: input.targetUserId } });
    const campaignSeller = await tx.campaign.updateMany({ where: { id: { in: affected.campaignSeller }, sellerUserId: input.sourceUserId }, data: { sellerUserId: input.targetUserId } });
    const campaignOwner = await tx.campaign.updateMany({ where: { id: { in: affected.campaignOwner }, accountOwnerUserId: input.sourceUserId }, data: { accountOwnerUserId: input.targetUserId } });
    const reservationSeller = await tx.reservation.updateMany({ where: { id: { in: affected.reservationSeller }, sellerUserId: input.sourceUserId }, data: { sellerUserId: input.targetUserId, salesperson: dryRun.target.name } });
    const reservationOwner = await tx.reservation.updateMany({ where: { id: { in: affected.reservationOwner }, ownerId: input.sourceUserId }, data: { ownerId: input.targetUserId } });
    const receivables = await tx.financialReceivable.updateMany({ where: { id: { in: affected.receivables }, accountOwnerUserId: input.sourceUserId }, data: { accountOwnerUserId: input.targetUserId } });
    const prospects = await tx.crmProspect.updateMany({ where: { id: { in: affected.crmProspects }, ownerId: input.sourceUserId }, data: { ownerId: input.targetUserId } });
    const opportunities = await tx.crmOpportunity.updateMany({ where: { id: { in: affected.crmOpportunities }, ownerId: input.sourceUserId }, data: { ownerId: input.targetUserId } });
    const actions = await tx.crmNextAction.updateMany({ where: { id: { in: affected.crmActions }, ownerId: input.sourceUserId }, data: { ownerId: input.targetUserId } });
    const updated = {
      clients: clients.count,
      campaignSeller: campaignSeller.count,
      campaignOwner: campaignOwner.count,
      reservationSeller: reservationSeller.count,
      reservationOwner: reservationOwner.count,
      receivables: receivables.count,
      crmProspects: prospects.count,
      crmOpportunities: opportunities.count,
      crmActions: actions.count
    };
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "ownership.reassign.batch_applied",
        entityType: "ownership_batch",
        entityId: dryRun.batchId,
        metadata: jsonMetadata({
          batchId: dryRun.batchId,
          reason: input.reason.trim(),
          before: { ownerUserId: input.sourceUserId, sourceUserName: dryRun.source.name, dependencies: dryRun.dependencies },
          after: { ownerUserId: input.targetUserId, targetUserName: dryRun.target.name },
          affected,
          updated
        })
      }
    });
    return { batchId: dryRun.batchId, idempotent: false, updated };
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function ids(rows: Promise<Array<{ id: string }>>) {
  return (await rows).map((row) => row.id);
}

export async function getOwnershipIntegrityReport(now = new Date()): Promise<OwnershipIntegrityReport> {
  const [sellers, reservations, clients, campaigns, baseCounts, financeLegacy, ownerlessClientStatuses, operationalAssignment] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [...SELLER_CAPABLE_ROLES] } },
      select: { id: true, name: true, email: true, active: true, role: true }
    }),
    prisma.reservation.findMany({
      where: {
        OR: [
          { sellerUserId: null },
          { campaignId: null },
          { clientId: null },
          { sellerUser: { is: { active: false } } }
        ]
      },
      select: {
        id: true,
        status: true,
        clientId: true,
        campaignId: true,
        sellerUserId: true,
        ownerId: true,
        salesperson: true,
        externalSource: true,
        campaignName: true,
        periodStart: true,
        periodEnd: true,
        location: { select: { code: true } },
        sellerUser: { select: { active: true, role: true } },
        owner: { select: { id: true, active: true, role: true } },
        client: { select: { accountOwnerUserId: true, accountOwner: { select: { active: true, role: true } } } },
        campaign: {
          select: {
            id: true,
            clientId: true,
            sellerUserId: true,
            accountOwnerUserId: true,
            sellerUser: { select: { active: true, role: true } },
            accountOwner: { select: { active: true, role: true } }
          }
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    prisma.clientAccount.findMany({
      where: {
        status: { notIn: ["merged", "archived"] },
        OR: [{ accountOwnerUserId: null }, { accountOwner: { is: { active: false } } }]
      },
      select: {
        id: true,
        companyName: true,
        status: true,
        accountOwnerUserId: true,
        accountOwner: { select: { active: true, role: true } },
        createdByUserId: true,
        createdBy: { select: { active: true, role: true } },
        campaigns: {
          select: { sellerUserId: true, accountOwnerUserId: true, sellerUser: { select: { active: true, role: true } }, accountOwner: { select: { active: true, role: true } } },
          take: 100
        },
        reservations: {
          select: { sellerUserId: true, ownerId: true, sellerUser: { select: { active: true, role: true } }, owner: { select: { active: true, role: true } } },
          take: 100
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    prisma.campaign.findMany({
      where: {
        archivedAt: null,
        status: { not: "archived" },
        OR: [
          { sellerUserId: null },
          { accountOwnerUserId: null },
          { sellerUser: { is: { active: false } } },
          { accountOwner: { is: { active: false } } }
        ]
      },
      select: {
        id: true,
        campaignName: true,
        status: true,
        sellerUserId: true,
        accountOwnerUserId: true,
        createdByUserId: true,
        sellerUser: { select: { active: true, role: true } },
        accountOwner: { select: { active: true, role: true } },
        createdBy: { select: { active: true, role: true } },
        client: { select: { accountOwnerUserId: true, accountOwner: { select: { active: true, role: true } } } },
        reservations: {
          select: { sellerUserId: true, ownerId: true, sellerUser: { select: { active: true, role: true } }, owner: { select: { active: true, role: true } } },
          take: 100
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    Promise.all([
      prisma.reservation.count(),
      prisma.reservation.count({ where: { sellerUserId: null } }),
      prisma.reservation.count({ where: { campaignId: null } }),
      prisma.reservation.count({ where: { status: "BOOKED", OR: [{ clientId: null }, { campaignId: null }] } }),
      prisma.clientAccount.count({ where: { status: { notIn: ["merged", "archived"] }, accountOwnerUserId: null } }),
      prisma.clientAccount.count({ where: { accountOwnerUserId: null } }),
      prisma.user.count({ where: { active: false } })
    ]),
    Promise.all([
      prisma.financialImportIssue.count({ where: { resolvedAt: null } }),
      prisma.financialReceivable.count({ where: { needsReview: true } }),
      prisma.financialReceivable.count({ where: { accountOwnerUserId: null, includedInReport: true } }),
      prisma.financialReceivable.findMany({
        select: {
          id: true,
          collectedAmount: true,
          payments: { where: { status: "active" }, select: { amount: true } }
        }
      })
    ]),
    prisma.clientAccount.groupBy({
      by: ["status"],
      where: { accountOwnerUserId: null },
      _count: { _all: true }
    }),
    Promise.all([
      prisma.operationTask.count(),
      prisma.operationTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
      prisma.operationTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, assignedToUserId: null } }),
      prisma.operationTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, assignedTo: { is: { active: false } } } })
    ])
  ]);

  const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
  const sellerByLegacyIdentity = sellerIdentityIndex(sellers.filter((seller) => seller.active));
  const affectedIds = {
    reservation: reservations.map((row) => row.id),
    client: clients.map((row) => row.id),
    campaign: campaigns.map((row) => row.id)
  };
  const auditCreators = await loadAuditCreators(affectedIds, sellerById);
  const campaignsByClient = await loadCampaignCandidates(reservations);
  const items: OwnershipIntegrityItem[] = [];

  for (const row of reservations) {
    if (!row.sellerUserId || row.sellerUser?.active === false) {
      const evidence = compactEvidence([
        userEvidence("DIRECT_OWNER", row.ownerId, row.owner, "Owner direct rezervare"),
        userEvidence("CAMPAIGN_SELLER", row.campaign?.sellerUserId, row.campaign?.sellerUser, "Seller campanie"),
        userEvidence("CAMPAIGN_OWNER", row.campaign?.accountOwnerUserId, row.campaign?.accountOwner, "Owner campanie"),
        userEvidence("CLIENT_OWNER", row.client?.accountOwnerUserId, row.client?.accountOwner, "Owner client"),
        auditEvidence(auditCreators.get(`reservation:${row.id}`)),
        legacySellerEvidence(row.salesperson, sellerByLegacyIdentity)
      ]);
      items.push(makeItem({
        entityType: "reservation",
        entityId: row.id,
        label: row.location.code,
        status: row.status,
        reasonCode: row.sellerUserId ? "INACTIVE_RESERVATION_SELLER" : "MISSING_RESERVATION_SELLER",
        evidence,
        before: { sellerUserId: row.sellerUserId, ownerId: row.ownerId, salesperson: row.salesperson },
        patch: (candidateId) => ({
          sellerUserId: candidateId,
          ownerId: candidateId,
          salesperson: sellerById.get(candidateId)?.name || null
        }),
        forceReview: Boolean(row.sellerUserId)
      }));
    }
    if (!row.campaignId) {
      const exact = exactCampaignEvidence(row, campaignsByClient.get(row.clientId || "") || []);
      items.push(makeItem({
        entityType: "reservation",
        entityId: row.id,
        label: row.location.code,
        status: row.status,
        reasonCode: "MISSING_RESERVATION_CAMPAIGN",
        evidence: exact,
        before: { campaignId: null },
        patch: (candidateId) => ({ campaignId: candidateId })
      }));
    }
    if (row.status === "BOOKED" && !row.clientId) {
      const evidence = row.campaign?.clientId
        ? [{ source: "CAMPAIGN_OWNER", candidateId: row.campaign.clientId, candidateType: "CLIENT", label: "Clientul campaniei" } satisfies OwnershipEvidence]
        : [];
      items.push(makeItem({
        entityType: "reservation",
        entityId: row.id,
        label: row.location.code,
        status: row.status,
        reasonCode: "MISSING_BOOKED_CLIENT",
        evidence,
        before: { clientId: null },
        patch: (candidateId) => ({ clientId: candidateId })
      }));
    }
  }

  for (const row of clients) {
    const evidence = compactEvidence([
      userEvidence("CREATED_BY", row.createdByUserId, row.createdBy, "Creator client"),
      auditEvidence(auditCreators.get(`client:${row.id}`)),
      ...row.campaigns.flatMap((campaign) => [
        userEvidence("CAMPAIGN_SELLER", campaign.sellerUserId, campaign.sellerUser, "Seller campanie client"),
        userEvidence("CAMPAIGN_OWNER", campaign.accountOwnerUserId, campaign.accountOwner, "Owner campanie client")
      ]),
      ...row.reservations.flatMap((reservation) => [
        userEvidence("RELATED_RECORD_OWNER", reservation.sellerUserId, reservation.sellerUser, "Seller rezervare client"),
        userEvidence("RELATED_RECORD_OWNER", reservation.ownerId, reservation.owner, "Owner rezervare client")
      ])
    ]);
    items.push(makeItem({
      entityType: "client",
      entityId: row.id,
      label: row.companyName,
      status: row.status,
      reasonCode: row.accountOwnerUserId ? "INACTIVE_CLIENT_OWNER" : "MISSING_CLIENT_OWNER",
      evidence,
      before: { accountOwnerUserId: row.accountOwnerUserId },
      patch: (candidateId) => ({ accountOwnerUserId: candidateId }),
      forceReview: Boolean(row.accountOwnerUserId)
    }));
  }

  for (const row of campaigns) {
    const commonEvidence = compactEvidence([
      userEvidence("CREATED_BY", row.createdByUserId, row.createdBy, "Creator campanie"),
      userEvidence("CLIENT_OWNER", row.client.accountOwnerUserId, row.client.accountOwner, "Owner client"),
      auditEvidence(auditCreators.get(`campaign:${row.id}`)),
      ...row.reservations.flatMap((reservation) => [
        userEvidence("RELATED_RECORD_OWNER", reservation.sellerUserId, reservation.sellerUser, "Seller rezervare campanie"),
        userEvidence("RELATED_RECORD_OWNER", reservation.ownerId, reservation.owner, "Owner rezervare campanie")
      ])
    ]);
    if (!row.sellerUserId || row.sellerUser?.active === false) {
      const evidence = compactEvidence([
        userEvidence("CAMPAIGN_OWNER", row.accountOwnerUserId, row.accountOwner, "Owner direct campanie"),
        ...commonEvidence
      ]);
      items.push(makeItem({
        entityType: "campaign",
        entityId: row.id,
        label: row.campaignName,
        status: row.status,
        reasonCode: row.sellerUserId ? "INACTIVE_CAMPAIGN_SELLER" : "MISSING_CAMPAIGN_SELLER",
        evidence,
        before: { sellerUserId: row.sellerUserId },
        patch: (candidateId) => ({ sellerUserId: candidateId }),
        forceReview: Boolean(row.sellerUserId)
      }));
    }
    if (!row.accountOwnerUserId || row.accountOwner?.active === false) {
      const evidence = compactEvidence([
        userEvidence("CAMPAIGN_SELLER", row.sellerUserId, row.sellerUser, "Seller direct campanie"),
        ...commonEvidence
      ]);
      items.push(makeItem({
        entityType: "campaign",
        entityId: row.id,
        label: row.campaignName,
        status: row.status,
        reasonCode: row.accountOwnerUserId ? "INACTIVE_CAMPAIGN_OWNER" : "MISSING_CAMPAIGN_OWNER",
        evidence,
        before: { accountOwnerUserId: row.accountOwnerUserId },
        patch: (candidateId) => ({ accountOwnerUserId: candidateId }),
        forceReview: Boolean(row.accountOwnerUserId)
      }));
    }
  }

  const classifications = { SAFE_AUTOFILL: 0, NEEDS_REVIEW: 0, UNRESOLVED: 0 } satisfies Record<OwnershipClassification, number>;
  const causes: Record<string, number> = {};
  const safeAutofillByReason: Record<string, number> = {};
  for (const item of items) {
    classifications[item.classification] += 1;
    causes[item.reasonCode] = (causes[item.reasonCode] || 0) + 1;
    if (item.classification === "SAFE_AUTOFILL") {
      safeAutofillByReason[item.reasonCode] = (safeAutofillByReason[item.reasonCode] || 0) + 1;
    }
  }
  const ledgerDifferences = financeLegacy[3].map((row) => {
    const ledgerTotal = row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    return { collected: Number(row.collectedAmount || 0), ledgerTotal, paymentCount: row.payments.length };
  }).filter((row) => Math.abs(row.collected - row.ledgerTotal) > 0.01);

  return {
    generatedAt: now.toISOString(),
    policyVersion: 1,
    precedence: OWNERSHIP_EVIDENCE_PRECEDENCE,
    counts: {
      reservationsTotal: baseCounts[0],
      reservationsWithoutSeller: baseCounts[1],
      reservationsWithoutCampaign: baseCounts[2],
      bookedWithoutClientOrCampaign: baseCounts[3],
      clientsWithoutOwner: baseCounts[4],
      clientsWithoutOwnerAllStatuses: baseCounts[5],
      inactiveUsers: baseCounts[6]
    },
    breakdown: {
      reservationsWithoutSellerByStatus: countBy(reservations.filter((row) => !row.sellerUserId), (row) => row.status),
      reservationsWithoutCampaignByStatus: countBy(reservations.filter((row) => !row.campaignId), (row) => row.status),
      clientsWithoutOwnerByStatus: Object.fromEntries(ownerlessClientStatuses.map((row) => [row.status, row._count._all])),
      reservationsWithoutSellerWithDirectOwner: reservations.filter((row) => !row.sellerUserId && row.ownerId && isActiveSalesUser(row.owner)).length,
      reservationsWithoutSellerWithoutEvidence: items.filter((item) => item.reasonCode === "MISSING_RESERVATION_SELLER" && !item.evidence.length).length,
      reservationsWithoutSellerWithLegacySource: reservations.filter((row) => !row.sellerUserId && Boolean(row.externalSource)).length,
      safeAutofillByReason
    },
    classifications,
    causes,
    financeLegacy: {
      unresolvedImportIssues: financeLegacy[0],
      receivablesNeedingReview: financeLegacy[1],
      receivablesWithoutOwner: financeLegacy[2],
      ledgerMismatchCount: ledgerDifferences.length,
      collectedWithoutLedgerCount: ledgerDifferences.filter((row) => row.paymentCount === 0 && row.collected > 0.01).length
    },
    operationalAssignment: {
      total: operationalAssignment[0],
      active: operationalAssignment[1],
      activeUnassigned: operationalAssignment[2],
      activeAssignedToInactiveUser: operationalAssignment[3]
    },
    items
  };
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = key(row);
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function makeItem(input: {
  entityType: OwnershipEntityType;
  entityId: string;
  label: string;
  status: string;
  reasonCode: OwnershipIntegrityItem["reasonCode"];
  evidence: OwnershipEvidence[];
  before: OwnershipPatch;
  patch: (candidateId: string) => OwnershipPatch;
  forceReview?: boolean;
}): OwnershipIntegrityItem {
  const orderedEvidence = [...input.evidence].sort((left, right) => evidenceRank(left.source) - evidenceRank(right.source));
  const result = classifyOwnershipEvidence(orderedEvidence, { forceReview: input.forceReview });
  return {
    id: `${input.entityType}:${input.entityId}:${input.reasonCode}`,
    entityType: input.entityType,
    entityId: input.entityId,
    label: input.label,
    status: input.status,
    reasonCode: input.reasonCode,
    classification: result.classification,
    evidence: orderedEvidence,
    before: input.before,
    suggestedPatch: result.candidateId ? input.patch(result.candidateId) : null
  };
}

function evidenceRank(source: OwnershipEvidence["source"]) {
  return OWNERSHIP_EVIDENCE_PRECEDENCE.indexOf(source);
}

function isActiveSalesUser(user?: { active: boolean; role: string } | null) {
  return Boolean(user?.active && isSellerCapableRole(user.role));
}

function userEvidence(
  source: OwnershipEvidence["source"],
  candidateId: string | null | undefined,
  user: { active: boolean; role: string } | null | undefined,
  label: string
): OwnershipEvidence | null {
  return candidateId && isActiveSalesUser(user)
    ? { source, candidateId, candidateType: "USER", label }
    : null;
}

function auditEvidence(evidence?: OwnershipEvidence) {
  return evidence || null;
}

function legacySellerEvidence(value: string | null, index: Map<string, Seller[]>): OwnershipEvidence | null {
  const normalized = normalizeIdentity(value);
  const matches = normalized ? index.get(normalized) || [] : [];
  return matches.length === 1
    ? { source: "LEGACY_SELLER_EXACT", candidateId: matches[0].id, candidateType: "USER", label: "Nume/email legacy exact" }
    : null;
}

function compactEvidence(values: Array<OwnershipEvidence | null>) {
  const seen = new Set<string>();
  return values.filter((value): value is OwnershipEvidence => {
    if (!value) return false;
    const key = `${value.source}:${value.candidateType}:${value.candidateId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sellerIdentityIndex(sellers: Seller[]) {
  const index = new Map<string, Seller[]>();
  for (const seller of sellers) {
    for (const value of [seller.name, seller.email]) {
      const key = normalizeIdentity(value);
      if (!key) continue;
      index.set(key, [...(index.get(key) || []), seller]);
    }
  }
  return index;
}

function normalizeIdentity(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

async function loadAuditCreators(
  ids: Record<OwnershipEntityType, string[]>,
  sellerById: Map<string, Seller>
) {
  const filters: Prisma.AuditLogWhereInput[] = [];
  if (ids.reservation.length) filters.push({ entityType: "reservation", entityId: { in: ids.reservation } });
  if (ids.client.length) filters.push({ entityType: "client_account", entityId: { in: ids.client } });
  if (ids.campaign.length) filters.push({ entityType: "campaign", entityId: { in: ids.campaign } });
  if (!filters.length) return new Map<string, OwnershipEvidence>();
  const rows = await prisma.auditLog.findMany({
    where: { OR: filters, action: { in: ["reservation.create", "client.upsert", "campaign.create"] } },
    select: { entityType: true, entityId: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });
  const result = new Map<string, OwnershipEvidence>();
  for (const row of rows) {
    if (!row.entityId || !row.userId || result.has(`${auditEntity(row.entityType)}:${row.entityId}`)) continue;
    const user = sellerById.get(row.userId);
    if (!user?.active) continue;
    result.set(`${auditEntity(row.entityType)}:${row.entityId}`, {
      source: "AUDIT_CREATOR",
      candidateId: user.id,
      candidateType: "USER",
      label: "Actorul evenimentului de creare"
    });
  }
  return result;
}

function auditEntity(entityType: string): OwnershipEntityType {
  if (entityType === "client_account") return "client";
  return entityType as OwnershipEntityType;
}

async function loadCampaignCandidates(reservations: Array<{ clientId: string | null }>) {
  const clientIds = [...new Set(reservations.map((row) => row.clientId).filter((id): id is string => Boolean(id)))];
  const rows = clientIds.length
    ? await prisma.campaign.findMany({
        where: { clientId: { in: clientIds } },
        select: { id: true, clientId: true, campaignName: true, startDate: true, endDate: true }
      })
    : [];
  const result = new Map<string, typeof rows>();
  for (const row of rows) result.set(row.clientId, [...(result.get(row.clientId) || []), row]);
  return result;
}

function exactCampaignEvidence(
  reservation: { campaignName: string | null; periodStart: Date; periodEnd: Date },
  campaigns: Array<{ id: string; campaignName: string; startDate: Date | null; endDate: Date | null }>
) {
  const expected = normalizeIdentity(reservation.campaignName);
  if (!expected) return [];
  const matches = campaigns.filter((campaign) => normalizeIdentity(campaign.campaignName) === expected);
  if (matches.length !== 1) return [];
  return [{
    source: "EXACT_CAMPAIGN_NAME",
    candidateId: matches[0].id,
    candidateType: "CAMPAIGN",
    label: "Nume campanie exact in acelasi client"
  } satisfies OwnershipEvidence];
}

async function applyIntegrityItem(tx: Prisma.TransactionClient, item: OwnershipIntegrityItem) {
  if (!item.suggestedPatch || item.classification !== "SAFE_AUTOFILL") {
    throw new Error(`Elementul ${item.id} nu este eligibil pentru completare automata.`);
  }
  const changed = await updateOwnershipPatch(tx, item.entityType, item.entityId, item.suggestedPatch, item.before);
  if (changed !== 1) throw new Error(`Elementul ${item.id} s-a schimbat dupa dry-run.`);
}

async function updateOwnershipPatch(
  tx: Prisma.TransactionClient,
  entityType: OwnershipEntityType,
  entityId: string,
  patch: OwnershipPatch,
  expected?: OwnershipPatch
) {
  const data = Object.fromEntries(Object.entries(patch));
  const where = { id: entityId, ...(expected || {}) };
  if (entityType === "reservation") return (await tx.reservation.updateMany({ where, data })).count;
  if (entityType === "client") return (await tx.clientAccount.updateMany({ where, data })).count;
  return (await tx.campaign.updateMany({ where, data })).count;
}

async function currentOwnershipPatch(
  tx: Prisma.TransactionClient,
  entityType: OwnershipEntityType,
  entityId: string,
  fields: string[]
) {
  const select = Object.fromEntries(fields.map((field) => [field, true]));
  const row = entityType === "reservation"
    ? await tx.reservation.findUnique({ where: { id: entityId }, select })
    : entityType === "client"
      ? await tx.clientAccount.findUnique({ where: { id: entityId }, select })
      : await tx.campaign.findUnique({ where: { id: entityId }, select });
  if (!row) throw new Error(`Entitatea ${entityType}:${entityId} nu mai exista.`);
  return row as unknown as OwnershipPatch;
}

function assertProductionRemediationEnabled() {
  const production = process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production";
  if (production && process.env.OWNERSHIP_REMEDIATION_WRITES_ENABLED !== "true") {
    throw new Error("Remedierea ownership este blocata in productie pana la aprobarea explicita a batch-ului.");
  }
}

function jsonMetadata(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asMetadata(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asPatch(value: unknown): OwnershipPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry === null || typeof entry === "string")
  ) as OwnershipPatch;
}
