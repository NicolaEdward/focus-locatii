import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import type { AuthSession } from "@/lib/auth";
import { decideAvailability } from "@/lib/availability";
import { deriveCampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import { companyCodeForEntity, normalizeCompanyEntity } from "@/lib/company-entities";
import {
  EXECUTIVE_ALERTS_REVALIDATE_SECONDS,
  type ExecutiveAlert,
  type ExecutiveAlertCacheContext,
  type ExecutiveAlertDomain,
  type ExecutiveAlertEvidenceItem,
  type ExecutiveAlertFilters,
  type ExecutiveAlertRuleType,
  type ExecutiveAlertSeverity,
  type ExecutiveAlertsResponse
} from "@/lib/dashboard/executive/alerts-contracts";
import {
  cursorOffset,
  executiveAlertRequest,
  executiveAlertsCacheKey,
  nextCursor
} from "@/lib/dashboard/executive/alerts-scope";
import type {
  ExecutiveAttentionItem,
  ExecutiveDataQuality,
  ExecutiveEntityCode,
  ExecutiveScope
} from "@/lib/dashboard/executive/contracts";
import { operationalRequirementForBooked, proofContractForOperation } from "@/lib/dashboard/executive/operational-contract";
import { entityLabelForCode, entityValueForCode } from "@/lib/dashboard/executive/scope";
import {
  addDateKeyDays,
  bucharestDayBounds,
  daysBetween
} from "@/lib/dashboard/executive/time";
import { isProductionSketchImage } from "@/lib/location-images";
import { operationalBusinessOwner } from "@/lib/operational-responsibility";
import { parseOperationalProofNotes } from "@/lib/operational-proof";
import { prisma } from "@/lib/prisma";
import { receivableResponsibleUser } from "@/lib/receivables-ownership";
import {
  effectiveHoldExpiresAt,
  isEffectiveHold,
  isHoldStatus
} from "@/lib/reservation-lifecycle-domain";

const ACTIVE_CAMPAIGN_STATUSES = new Set(["ACTIVE", "SCHEDULED"]);
const ACTIVE_OPPORTUNITY_STAGES = ["opportunity", "quoted", "negotiation", "contracting"];
const ACTIVE_TASK_STATUSES = new Set(["NEW", "IN_PROGRESS"]);
const ALERT_CACHE_TAGS = [
  "executive-alerts",
  "reservation-hold-location",
  "campaign-document",
  "operation-task-proof",
  "receivable-payment",
  "crm-next-action"
];

export const EXECUTIVE_DISABLED_ALERT_RULES = [
  {
    ruleType: "CONTRACT_UNSIGNED",
    reason: "Schema nu conține un status canonic de semnare. Existența unui PDF nu dovedește semnarea."
  },
  {
    ruleType: "PRICE_MISSING_OR_INVALID",
    reason: "Sursa contractuală finală a prețului nu este aprobată pentru alertare executivă."
  },
  {
    ruleType: "BOOKED_COVERAGE_GAP",
    reason: "Nu există o listă canonică completă a suporturilor așteptate."
  },
  {
    ruleType: "PROOF_REQUIRED_MISSING",
    reason: "Rămâne agregat în dry-run până la cutover-ul OperationTask; nu se emite individual."
  },
  {
    ruleType: "SKETCH_MISSING",
    reason: "Schița nu este încă document obligatoriu în contractul de business."
  },
  {
    ruleType: "SAGA_SYNC_STATUS",
    reason: "Nu există o sursă canonică pentru starea sincronizării SAGA."
  },
  {
    ruleType: "DECORATION_NOT_COMPLETED",
    reason: "Assignment-ul și acoperirea OperationTask nu au încă nivelul de încredere necesar."
  }
] as const;

const cachedAlerts = unstable_cache(
  async (context: ExecutiveAlertCacheContext) => queryExecutiveAlerts(context),
  ["executive-alerts-v3"],
  { revalidate: EXECUTIVE_ALERTS_REVALIDATE_SECONDS, tags: ALERT_CACHE_TAGS }
);

export async function getExecutiveAlerts(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {},
  now = new Date()
) {
  const request = executiveAlertRequest(session, input, now);
  executiveAlertsCacheKey(request.cacheContext);
  const result = await cachedAlerts(request.cacheContext);
  return {
    ...result,
    role: request.scope.role,
    scope: request.scope,
    filters: request.filters
  } satisfies ExecutiveAlertsResponse;
}

export async function queryExecutiveAlerts(
  context: ExecutiveAlertCacheContext,
  queryNow = new Date()
): Promise<Omit<ExecutiveAlertsResponse, "role" | "scope" | "filters">> {
  const snapshotBounds = bucharestDayBounds(context.snapshotDate);
  const snapshotDate = snapshotBounds.start;
  const selectedEntityValues = context.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const [receivables, campaigns, locations, operationTasks, crmActions, users] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        companyCode: { in: context.selectedEntityCodes },
        includedInReport: true,
        needsReview: false,
        remainingAmount: { gt: new Prisma.Decimal("0.01") }
      },
      select: {
        id: true,
        clientId: true,
        invoiceNumber: true,
        clientName: true,
        companyCode: true,
        currency: true,
        dueDate: true,
        remainingAmount: true,
        accountOwnerUserId: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            companyName: true,
            accountOwnerUserId: true,
            accountOwner: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }]
    }),
    prisma.campaign.findMany({
      where: {
        companyEntity: { in: selectedEntityValues },
        archivedAt: null,
        status: { notIn: ["archived", "cancelled", "completed", "draft"] }
      },
      select: {
        id: true,
        campaignName: true,
        status: true,
        startDate: true,
        endDate: true,
        companyEntity: true,
        accountOwnerUserId: true,
        sellerUserId: true,
        createdAt: true,
        accountOwner: { select: { id: true, name: true } },
        sellerUser: { select: { id: true, name: true } },
        client: {
          select: {
            id: true,
            companyName: true,
            accountOwnerUserId: true,
            accountOwner: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }]
    }),
    prisma.location.findMany({
      select: {
        id: true,
        code: true,
        type: true,
        lifecycleStatus: true,
        status: true,
        availabilityText: true,
        availableFrom: true,
        availableUntil: true,
        bookedFrom: true,
        bookedUntil: true,
        blockedReason: true,
        blockedFrom: true,
        blockedUntil: true,
        mainPhotoUrl: true,
        showInPublic: true,
        createdAt: true,
        updatedAt: true,
        images: { select: { id: true, alt: true, url: true, isMain: true } },
        availabilityOverrides: {
          where: { clearedAt: null },
          select: { id: true, type: true, reason: true, periodStart: true, periodEnd: true, clearedAt: true, createdAt: true }
        },
        reservations: {
          where: { status: { in: ["BOOKED", "HOLD", "RESERVED"] } },
          select: {
            id: true,
            status: true,
            campaignId: true,
            locationId: true,
            periodStart: true,
            periodEnd: true,
            holdExpiresAt: true,
            contractCompany: true,
            createdAt: true,
            updatedAt: true,
            campaign: { select: { companyEntity: true } }
          }
        }
      },
      orderBy: { id: "asc" }
    }),
    prisma.operationTask.findMany({
      select: {
        id: true,
        reservationId: true,
        campaignId: true,
        locationId: true,
        kind: true,
        status: true,
        source: true,
        dedupeKey: true,
        legacyTaskId: true,
        scheduledFor: true,
        completedAt: true,
        assignedToUserId: true,
        createdAt: true,
        updatedAt: true,
        assignedTo: { select: { id: true, name: true } },
        campaign: {
          select: {
            id: true,
            campaignName: true,
            companyEntity: true,
            status: true,
            startDate: true,
            endDate: true,
            archivedAt: true,
            client: {
              select: {
                accountOwnerUserId: true,
                accountOwner: { select: { id: true, name: true } }
              }
            }
          }
        },
        location: { select: { id: true, code: true, type: true } },
        reservation: {
          select: {
            id: true,
            status: true,
            campaignId: true,
            contractCompany: true,
            periodStart: true,
            periodEnd: true,
            location: { select: { id: true, code: true, type: true } },
            client: {
              select: {
                accountOwnerUserId: true,
                accountOwner: { select: { id: true, name: true } }
              }
            },
            campaign: {
              select: {
                id: true,
                campaignName: true,
                companyEntity: true,
                status: true,
                startDate: true,
                endDate: true,
                archivedAt: true,
                client: {
                  select: {
                    accountOwnerUserId: true,
                    accountOwner: { select: { id: true, name: true } }
                  }
                }
              }
            },
            documents: {
              where: { documentType: "operational_proof_photo", status: "active" },
              select: { id: true, documentType: true, status: true, expiryDate: true, notes: true }
            }
          }
        }
      },
      orderBy: { id: "asc" }
    }),
    prisma.crmNextAction.findMany({
      where: {
        status: "open",
        dueAt: { lt: snapshotBounds.start },
        opportunity: { is: { stage: { in: ACTIVE_OPPORTUNITY_STAGES } } }
      },
      select: {
        id: true,
        dueAt: true,
        description: true,
        ownerId: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        opportunity: { select: { id: true, name: true, stage: true } }
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }]
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { id: "asc" }
    })
  ]);
  const userLabels = new Map(users.map((user) => [user.id, user.name]));

  const allAlerts = dedupeExecutiveAlerts([
    ...financialAlerts(receivables, userLabels, context, snapshotDate, queryNow),
    ...campaignAlerts(campaigns, locations, context, snapshotDate, queryNow),
    ...holdAlerts(locations, context, snapshotDate, queryNow),
    ...operationalAlerts(operationTasks, locations, context, snapshotDate, queryNow),
    ...(context.selectedEntityCodes.length === 3
      ? crmAlerts(crmActions, context, snapshotDate, queryNow)
      : []),
    ...(context.selectedEntityCodes.length === 3
      ? inventoryAlerts(locations, campaigns, context, snapshotDate, queryNow)
      : [])
  ]).sort(alertSort);
  const filtered = filterAlerts(allAlerts, context);
  const offset = cursorOffset(context.cursor);
  const items = filtered.slice(offset, offset + context.limit);
  const nextOffset = offset + items.length;
  const asOf = queryNow.toISOString();
  const owners = [...new Map(allAlerts
    .filter((alert) => alert.responsibleUserId)
    .map((alert) => [alert.responsibleUserId as string, alert.responsibleLabel]))
    .entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "ro"));

  return {
    kind: "executive-alerts",
    summary: summarizeAlerts(filtered),
    filterOptions: { owners },
    items,
    pagination: {
      limit: context.limit,
      returned: items.length,
      previousCursor: offset > 0 ? nextCursor(Math.max(0, offset - context.limit)) : null,
      nextCursor: nextOffset < filtered.length ? nextCursor(nextOffset) : null
    },
    meta: {
      asOf,
      staleAt: new Date(queryNow.getTime() + EXECUTIVE_ALERTS_REVALIDATE_SECONDS * 1000).toISOString(),
      stale: false,
      contractVersion: context.contractVersion,
      queryBudget: 6,
      source: "CANONICAL_LIVE"
    },
    disabledRules: EXECUTIVE_DISABLED_ALERT_RULES.map((rule) => ({ ...rule }))
  };
}

type ReceivableRow = Awaited<ReturnType<typeof prisma.financialReceivable.findMany<{
  select: {
    id: true; clientId: true; invoiceNumber: true; clientName: true; companyCode: true; currency: true; dueDate: true;
    remainingAmount: true; accountOwnerUserId: true; createdAt: true;
    client: { select: {
      id: true; companyName: true; accountOwnerUserId: true;
      accountOwner: { select: { id: true; name: true } };
    } };
  };
}>>>[number];

type CampaignRow = Awaited<ReturnType<typeof prisma.campaign.findMany<{
  select: {
    id: true; campaignName: true; status: true; startDate: true; endDate: true; companyEntity: true;
    accountOwnerUserId: true; sellerUserId: true; createdAt: true;
    accountOwner: { select: { id: true; name: true } };
    sellerUser: { select: { id: true; name: true } };
    client: { select: { id: true; companyName: true; accountOwnerUserId: true; accountOwner: { select: { id: true; name: true } } } };
  };
}>>>[number];

type LocationRow = Awaited<ReturnType<typeof prisma.location.findMany<{
  select: {
    id: true; code: true; type: true; lifecycleStatus: true; status: true; availabilityText: true;
    availableFrom: true; availableUntil: true; bookedFrom: true; bookedUntil: true; blockedReason: true;
    blockedFrom: true; blockedUntil: true; mainPhotoUrl: true; showInPublic: true; createdAt: true; updatedAt: true;
    images: { select: { id: true; alt: true; url: true; isMain: true } };
    availabilityOverrides: { select: { id: true; type: true; reason: true; periodStart: true; periodEnd: true; clearedAt: true; createdAt: true } };
    reservations: { select: {
      id: true; status: true; campaignId: true; locationId: true; periodStart: true; periodEnd: true;
      holdExpiresAt: true; contractCompany: true; createdAt: true; updatedAt: true;
      campaign: { select: { companyEntity: true } };
    } };
  };
}>>>[number];

type OperationTaskRow = Awaited<ReturnType<typeof prisma.operationTask.findMany<{
  select: {
    id: true; reservationId: true; campaignId: true; locationId: true; kind: true; status: true; source: true;
    dedupeKey: true; legacyTaskId: true; scheduledFor: true; completedAt: true; assignedToUserId: true;
    createdAt: true; updatedAt: true;
    assignedTo: { select: { id: true; name: true } };
    campaign: { select: {
      id: true; campaignName: true; companyEntity: true; status: true; startDate: true; endDate: true; archivedAt: true;
      client: { select: {
        accountOwnerUserId: true;
        accountOwner: { select: { id: true; name: true } };
      } };
    } };
    location: { select: { id: true; code: true; type: true } };
    reservation: { select: {
      id: true; status: true; campaignId: true; contractCompany: true; periodStart: true; periodEnd: true;
      location: { select: { id: true; code: true; type: true } };
      client: { select: {
        accountOwnerUserId: true;
        accountOwner: { select: { id: true; name: true } };
      } };
      campaign: { select: {
        id: true; campaignName: true; companyEntity: true; status: true; startDate: true; endDate: true; archivedAt: true;
        client: { select: {
          accountOwnerUserId: true;
          accountOwner: { select: { id: true; name: true } };
        } };
      } };
      documents: { select: { id: true; documentType: true; status: true; expiryDate: true; notes: true } };
    } };
  };
}>>>[number];

type CrmActionRow = Awaited<ReturnType<typeof prisma.crmNextAction.findMany<{
  select: {
    id: true; dueAt: true; description: true; ownerId: true; createdAt: true;
    owner: { select: { id: true; name: true } };
    company: { select: { id: true; name: true } };
    opportunity: { select: { id: true; name: true; stage: true } };
  };
}>>>[number];

function financialAlerts(
  rows: ReceivableRow[],
  userLabels: Map<string, string>,
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  const alerts: ExecutiveAlert[] = [];
  const ownerless = new Map<string, ReceivableRow[]>();
  for (const row of rows) {
    const entityCode = knownEntityCode(row.companyCode);
    if (!entityCode || !context.selectedEntityCodes.includes(entityCode)) continue;
    const responsible = receivableResponsibleUser(row);
    if (!responsible) addToGroup(ownerless, entityCode, row);
    if (!row.dueDate || row.dueDate >= snapshotDate || new Prisma.Decimal(row.remainingAmount || 0).lte("0.01")) continue;
    const dueKey = dateKey(row.dueDate);
    const overdueDays = Math.max(1, daysBetween(dueKey, context.snapshotDate));
    const severity = receivableAgingSeverity(overdueDays);
    const invoiceLabel = row.invoiceNumber || row.id;
    const clientLabel = row.client?.companyName || row.clientName || "Client nealocat";
    alerts.push(makeAlert({
      ruleType: "OVERDUE_RECEIVABLE",
      reasonCode: "OVERDUE_RECEIVABLE",
      domain: "FINANCE",
      entityType: "financial_receivable",
      entityId: row.id,
      entityLabel: `${invoiceLabel} · ${clientLabel}`,
      companyEntity: entityCode,
      title: `Factură restantă de ${overdueDays} zile`,
      summary: `${invoiceLabel} are sold deschis după scadență.`,
      severity,
      impact: {
        kind: "MONEY",
        label: "Sold restant",
        amount: new Prisma.Decimal(row.remainingAmount || 0).toFixed(2),
        currency: row.currency || "NECUNOSCUT"
      },
      confidence: 100,
      dataQualityState: "HIGH",
      responsibleUserId: responsible?.id || null,
      responsibleLabel: responsible?.name || (responsible?.id ? userLabels.get(responsible.id) : null) || "Nealocat",
      detectedAt: bucharestDayBounds(addDateKeyDays(dueKey, 1)).start,
      dueAt: row.dueDate,
      recommendedAction: "Verifică factura și stabilește următorul pas de încasare.",
      evidence: [
        evidence("Factură", invoiceLabel),
        evidence("Client", clientLabel),
        evidence("Account Manager", responsible?.name || (responsible?.id ? userLabels.get(responsible.id) : null) || "Nealocat"),
        evidence("Scadență", dueKey),
        evidence("Aging", `${overdueDays} zile`),
        evidence("Sold", `${new Prisma.Decimal(row.remainingAmount || 0).toFixed(2)} ${row.currency || "NECUNOSCUT"}`)
      ],
      sourceRefs: [{ id: row.id, label: invoiceLabel, href: receivableHref(row, overdueDays) }],
      deepLink: receivableHref(row, overdueDays),
      relevantWindow: `due:${dueKey}`,
      groupKey: `OVERDUE_RECEIVABLE:${entityCode}:${row.currency || "UNKNOWN"}`,
      occurrenceCount: 1,
      asOf,
      ageReference: snapshotDate
    }));
  }

  for (const [entityCode, group] of ownerless) {
    const createdAt = earliestDate(group.map((row) => row.createdAt)) || snapshotDate;
    alerts.push(makeAlert({
      ruleType: "RECEIVABLE_OWNER_MISSING",
      reasonCode: "RECEIVABLE_OWNER_MISSING",
      domain: "FINANCE",
      entityType: "financial_receivable_group",
      entityId: entityCode,
      entityLabel: entityLabelForCode(entityCode as ExecutiveEntityCode),
      companyEntity: entityCode as ExecutiveEntityCode,
      title: "Creanțe fără responsabil canonic",
      summary: group.length === 1
        ? "O creanță activă nu are responsabil canonic."
        : `${group.length} creanțe active nu au responsabil canonic.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "Creanțe nealocate", count: group.length },
      confidence: 100,
      dataQualityState: "LOW",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: createdAt,
      dueAt: null,
      recommendedAction: "Revizuiește ownership-ul în raportul de integritate.",
      evidence: [
        evidence("Entitate", entityLabelForCode(entityCode as ExecutiveEntityCode)),
        evidence("Creanțe fără owner", group.length)
      ],
      sourceRefs: group.slice(0, 10).map((row) => ({
        id: row.id,
        label: row.invoiceNumber || row.id,
        href: receivableHref(row)
      })),
      deepLink: `/admin/financiar/incasari?companyCode=${encodeURIComponent(entityCode)}`,
      relevantWindow: "active-open-ledger",
      groupKey: `RECEIVABLE_OWNER_MISSING:${entityCode}`,
      occurrenceCount: group.length,
      asOf,
      ageReference: snapshotDate
    }));
  }
  return alerts;
}

function campaignAlerts(
  campaigns: CampaignRow[],
  locations: LocationRow[],
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  const alerts: ExecutiveAlert[] = [];
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const reservationsByCampaign = new Map<string, LocationRow["reservations"]>();
  for (const location of locations) {
    for (const reservation of location.reservations) {
      if (reservation.campaignId) addToGroup(reservationsByCampaign, reservation.campaignId, reservation);
    }
  }

  for (const campaign of campaigns) {
    const entityCode = companyCodeForEntity(campaign.companyEntity) as ExecutiveEntityCode | null;
    if (!entityCode || !context.selectedEntityCodes.includes(entityCode)) continue;
    const campaignReservations = reservationsByCampaign.get(campaign.id) || [];
    const decision = deriveCampaignEffectiveStatus({
      ...campaign,
      bookedPeriods: campaignReservations
    }, snapshotDate);
    if (!ACTIVE_CAMPAIGN_STATUSES.has(decision.effectiveStatus)) continue;
    const validBooked = campaignReservations.filter((reservation) =>
      reservation.status === "BOOKED" &&
      reservation.periodStart <= reservation.periodEnd &&
      (!campaign.startDate || reservation.periodEnd >= campaign.startDate) &&
      (!campaign.endDate || reservation.periodStart <= campaign.endDate)
    );
    const owner = campaign.accountOwner || campaign.sellerUser || campaign.client.accountOwner || null;
    const reasonCodes: string[] = [];
    if (!owner) reasonCodes.push("CAMPAIGN_OWNER_MISSING");
    if (!validBooked.length) reasonCodes.push("REQUIRED_BOOKED_MISSING");

    const conflicts: Array<{
      reservation: LocationRow["reservations"][number];
      reasonCodes: string[];
      intervalStarts: Date[];
    }> = validBooked.flatMap((reservation) => {
      const location = locationMap.get(reservation.locationId);
      if (!location) return [{ reservation, reasonCodes: ["LOCATION_MISSING"], intervalStarts: [reservation.periodStart] }];
      const availability = decideAvailability({
        ...location,
        periodStart: reservation.periodStart,
        periodEnd: reservation.periodEnd,
        ignoreReservationId: reservation.id,
        now: snapshotDate
      });
      return availability.isBookable
        ? []
        : [{
            reservation,
            reasonCodes: availability.reasons.map((reason) => reason.code),
            intervalStarts: availability.conflictingIntervals.map((interval) => interval.from)
          }];
    });
    if (conflicts.length) reasonCodes.push("AVAILABILITY_CONFLICT");
    if (!reasonCodes.length) continue;

    const startKey = campaign.startDate ? dateKey(campaign.startDate) : context.snapshotDate;
    const daysUntilStart = daysBetween(context.snapshotDate, startKey);
    const deliveryThreat = reasonCodes.includes("REQUIRED_BOOKED_MISSING") || reasonCodes.includes("AVAILABILITY_CONFLICT");
    if (decision.effectiveStatus === "SCHEDULED" && !deliveryThreat && daysUntilStart > 7) continue;
    const severity = deliveryThreat
      ? campaignRiskSeverity(decision.effectiveStatus, daysUntilStart)
      : "DATA_QUALITY";
    const conflictStart = earliestDate(conflicts.flatMap((conflict) =>
      conflict.intervalStarts.length ? conflict.intervalStarts : [conflict.reservation.periodStart]
    ));
    const detectedAt = conflictStart ||
      (reasonCodes.includes("REQUIRED_BOOKED_MISSING") ? campaign.createdAt : thresholdEntry(campaign.startDate, severity));
    const campaignHref = `/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`;

    alerts.push(makeAlert({
      ruleType: "CAMPAIGN_START_RISK",
      reasonCode: reasonCodes[0],
      reasonCodes,
      domain: "CAMPAIGNS",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.campaignName,
      companyEntity: entityCode,
      title: severity === "DATA_QUALITY" ? "Campanie cu ownership incomplet" : "Campanie cu risc de livrare",
      summary: campaignRiskSummary(reasonCodes),
      severity,
      impact: {
        kind: severity === "DATA_QUALITY" ? "DATA_QUALITY" : "DELIVERY",
        label: `${decision.effectiveStatus} · start ${startKey}`,
        count: conflicts.length || undefined
      },
      confidence: conflicts.some((conflict) => conflict.reasonCodes.includes("LOCATION_MISSING")) ? 70 : 100,
      dataQualityState: severity === "DATA_QUALITY" ? "LOW" : "HIGH",
      responsibleUserId: owner?.id || null,
      responsibleLabel: owner?.name || "Nealocat",
      detectedAt,
      dueAt: campaign.startDate,
      recommendedAction: "Deschide campania și verifică rezervările, disponibilitatea și responsabilul.",
      evidence: [
        evidence("Client", campaign.client.companyName),
        evidence("Campanie", campaign.campaignName),
        evidence("Account Manager", owner?.name || "Nealocat"),
        evidence("Status efectiv", decision.effectiveStatus),
        evidence("Start", startKey),
        evidence("BOOKED valid", validBooked.length),
        evidence("Conflicte confirmate", conflicts.length),
        evidence("Reason codes", reasonCodes.join(", "))
      ],
      sourceRefs: [{ id: campaign.id, label: campaign.campaignName, href: campaignHref }],
      deepLink: campaignHref,
      relevantWindow: `start:${startKey}`,
      groupKey: `CAMPAIGN_START_RISK:${entityCode}:${severity}`,
      occurrenceCount: 1,
      asOf,
      ageReference: snapshotDate
    }));
  }
  return alerts;
}

function holdAlerts(
  locations: LocationRow[],
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  const alerts: ExecutiveAlert[] = [];
  const inconsistencies: Array<{ reservation: LocationRow["reservations"][number]; location: LocationRow; reasons: string[]; entityCode: ExecutiveEntityCode | null }> = [];
  for (const location of locations) {
    for (const reservation of location.reservations.filter((row) => isHoldStatus(row.status))) {
      const entityCode = reservationEntityCode(reservation);
      if (entityCode && !context.selectedEntityCodes.includes(entityCode)) continue;
      if (!entityCode && context.selectedEntityCodes.length !== 3) continue;
      const expiresAt = effectiveHoldExpiresAt(reservation);
      const effective = isEffectiveHold(reservation, snapshotDate);
      const reasons: string[] = [];
      if (!reservation.holdExpiresAt) reasons.push("HOLD_EXPIRES_AT_MISSING");
      if (!effective) reasons.push("STORED_HOLD_EFFECTIVELY_EXPIRED");
      if (reservation.periodStart > reservation.periodEnd) reasons.push("HOLD_PERIOD_INVALID");
      const availabilityWithoutCurrent = decideAvailability({
        ...location,
        periodStart: reservation.periodStart,
        periodEnd: reservation.periodEnd,
        ignoreReservationId: reservation.id,
        now: snapshotDate
      });
      if (!availabilityWithoutCurrent.isBookable) reasons.push("HOLD_ON_UNAVAILABLE_LOCATION");
      if (reasons.length) inconsistencies.push({ reservation, location, reasons, entityCode });
      if (!effective) continue;
      const hoursUntilExpiry = (expiresAt.getTime() - snapshotDate.getTime()) / 3_600_000;
      if (hoursUntilExpiry <= 0 || hoursUntilExpiry > 72) continue;
      const severity = holdExpirySeverity(hoursUntilExpiry);
      if (!severity) continue;
      const reservationHref = `/admin/locatii?panel=reservations&reservationId=${encodeURIComponent(reservation.id)}`;
      alerts.push(makeAlert({
        ruleType: "HOLD_EXPIRING",
        reasonCode: "HOLD_EXPIRING",
        domain: "HOLD",
        entityType: "reservation",
        entityId: reservation.id,
        entityLabel: `HOLD · ${location.code}`,
        companyEntity: entityCode || "UNKNOWN",
        title: severity === "P1" ? "HOLD expiră în maximum 24h" : "HOLD expiră în maximum 3 zile",
        summary: `HOLD-ul pentru ${location.code} este încă efectiv și se apropie de expirare.`,
        severity,
        impact: { kind: "DELIVERY", label: "Capacitate comercială blocată", count: 1 },
        confidence: reservation.holdExpiresAt ? 100 : 80,
        dataQualityState: reservation.holdExpiresAt ? "HIGH" : "MEDIUM",
        responsibleUserId: null,
        responsibleLabel: "Nealocat",
        detectedAt: new Date(expiresAt.getTime() - (severity === "P1" ? 24 : 72) * 3_600_000),
        dueAt: expiresAt,
        recommendedAction: "Verifică decizia comercială înainte de expirare.",
        evidence: [
          evidence("Locație", location.code),
          evidence("Expiră la", expiresAt.toISOString()),
          evidence("Status stocat", reservation.status),
          evidence("Expirare explicită", reservation.holdExpiresAt ? "Da" : "Nu, derivată canonic")
        ],
        sourceRefs: [{ id: reservation.id, label: location.code, href: reservationHref }],
        deepLink: reservationHref,
        relevantWindow: `expiry:${dateKey(expiresAt)}`,
        groupKey: `HOLD_EXPIRING:${entityCode || "UNKNOWN"}:${severity}`,
        occurrenceCount: 1,
        asOf,
        ageReference: snapshotDate
      }));
    }
  }

  if (inconsistencies.length) {
    const reasonCounts = countBy(inconsistencies.flatMap((row) => row.reasons), (reason) => reason);
    const inconsistencyEntities = [...new Set(inconsistencies
      .map((row) => row.entityCode)
      .filter((code): code is ExecutiveEntityCode => Boolean(code)))];
    const companyEntity = inconsistencyEntities.length === 1 ? inconsistencyEntities[0] : "UNKNOWN";
    alerts.push(makeAlert({
      ruleType: "HOLD_DATA_INCONSISTENCY",
      reasonCode: "HOLD_DATA_INCONSISTENCY",
      reasonCodes: Object.keys(reasonCounts),
      domain: "HOLD",
      entityType: "reservation_group",
      entityId: "hold-data-inconsistency",
      entityLabel: "HOLD-uri cu date inconsistente",
      companyEntity,
      title: "Calitate date HOLD",
      summary: inconsistencies.length === 1
        ? "Un HOLD necesită verificare; disponibilitatea folosește expirarea efectivă."
        : `${inconsistencies.length} HOLD-uri necesită verificare; disponibilitatea folosește expirarea efectivă.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "HOLD-uri afectate", count: inconsistencies.length },
      confidence: 100,
      dataQualityState: "LOW",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: earliestDate(inconsistencies.map((row) => row.reservation.updatedAt)) || snapshotDate,
      dueAt: null,
      recommendedAction: "Deschide lista HOLD și verifică expirările sau perioadele nevalide.",
      evidence: Object.entries(reasonCounts).map(([reason, count]) => evidence(reason, count)),
      sourceRefs: inconsistencies.slice(0, 10).map(({ reservation, location }) => ({
        id: reservation.id,
        label: location.code,
        href: `/admin/locatii?panel=reservations&reservationId=${encodeURIComponent(reservation.id)}`
      })),
      deepLink: "/admin/locatii?panel=reservations&status=HOLD",
      relevantWindow: `snapshot:${context.snapshotDate}`,
      groupKey: "HOLD_DATA_INCONSISTENCY",
      occurrenceCount: inconsistencies.length,
      asOf,
      ageReference: snapshotDate
    }));
  }
  return alerts;
}

function operationalAlerts(
  tasks: OperationTaskRow[],
  locations: LocationRow[],
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  const alerts: ExecutiveAlert[] = [];
  const relevantTasks = tasks.filter((task) => taskMatchesEntity(task, context.selectedEntityCodes));
  const activeTasks = relevantTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const businessOwnerByTaskId = new Map(activeTasks.map((task) => [task.id, operationalBusinessOwner(task)]));
  const ownerless = activeTasks.filter((task) => !businessOwnerByTaskId.get(task.id));
  const withoutExecutor = activeTasks.filter((task) => !task.assignedToUserId);
  const businessAssignmentCompleteness = activeTasks.length
    ? Math.round(((activeTasks.length - ownerless.length) / activeTasks.length) * 100)
    : 0;
  const executorCoverage = activeTasks.length
    ? Math.round(((activeTasks.length - withoutExecutor.length) / activeTasks.length) * 100)
    : 0;
  const assignmentCompleteness = Math.min(businessAssignmentCompleteness, executorCoverage);
  if (activeTasks.length && (ownerless.length || withoutExecutor.length)) {
    const affected = [...new Map([...ownerless, ...withoutExecutor].map((task) => [task.id, task])).values()];
    const byKind = countBy(affected, (task) => task.kind);
    const byEntity = countBy(affected, (task) => taskEntityCode(task) || "UNKNOWN");
    alerts.push(makeAlert({
      ruleType: "OPERATION_ASSIGNMENT_COVERAGE_LOW",
      reasonCode: "OPERATION_ASSIGNMENT_COVERAGE_LOW",
      domain: "OPERATIONS",
      entityType: "operation_task_group",
      entityId: "active-unassigned",
      entityLabel: "Taskuri operaționale active",
      companyEntity: "UNKNOWN",
      title: "Responsabilitate sau execuție neplanificată",
      summary: `${ownerless.length} taskuri nu au vânzător prin client, iar ${withoutExecutor.length} nu au executor de teren.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "Taskuri afectate", count: affected.length },
      confidence: assignmentCompleteness,
      dataQualityState: assignmentCompleteness >= 80 ? "MEDIUM" : "LOW",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: earliestDate(affected.map((task) => task.createdAt)) || snapshotDate,
      dueAt: null,
      recommendedAction: "Revizuiește raportul read-only de reconciliere înainte de orice assignment în lot.",
      evidence: [
        evidence("Taskuri eligibile", activeTasks.length),
        evidence("Fără responsabil comercial", ownerless.length),
        evidence("Fără executor alpinist", withoutExecutor.length),
        evidence("Responsabilitate comercială", `${businessAssignmentCompleteness}%`),
        evidence("Planificare execuție", `${executorCoverage}%`),
        ...recordEvidence("Tip", byKind),
        ...recordEvidence("Entitate", byEntity)
      ],
      sourceRefs: affected.slice(0, 10).map(operationTaskRef),
      deepLink: "/admin/dashboard?panel=operation-task-reconciliation",
      relevantWindow: `snapshot:${context.snapshotDate}`,
      groupKey: "OPERATION_ASSIGNMENT_COVERAGE_LOW",
      occurrenceCount: affected.length,
      asOf,
      ageReference: snapshotDate
    }));
  }

  const overdueGroups = new Map<string, OperationTaskRow[]>();
  for (const task of activeTasks) {
    if (!task.scheduledFor || task.scheduledFor >= snapshotDate) continue;
    if (task.reservation?.status !== "BOOKED") continue;
    const ownerId = businessOwnerByTaskId.get(task.id)?.id || "UNASSIGNED";
    const key = `${taskEntityCode(task) || "UNKNOWN"}|${task.kind}|${ownerId}`;
    addToGroup(overdueGroups, key, task);
  }
  for (const [key, group] of overdueGroups) {
    const [entityText, kind] = key.split("|");
    const entityCode = knownEntityCode(entityText);
    const responsible = operationalBusinessOwner(group[0]);
    const earliest = earliestDate(group.map((task) => task.scheduledFor).filter(Boolean) as Date[]) || snapshotDate;
    alerts.push(makeAlert({
      ruleType: "OPERATION_TASK_OVERDUE",
      reasonCode: "OPERATION_TASK_OVERDUE",
      domain: "OPERATIONS",
      entityType: "operation_task_group",
      entityId: key,
      entityLabel: `${kind} · ${entityText}`,
      companyEntity: entityCode || "UNKNOWN",
      title: "Taskuri operaționale întârziate",
      summary: group.length === 1
        ? `Un task de ${operationKindLabel(kind)} a depășit data programată.`
        : `${group.length} taskuri de ${operationKindLabel(kind)} au depășit data programată.`,
      severity: "P2",
      impact: { kind: "COUNT", label: "Taskuri întârziate", count: group.length },
      confidence: Math.min(70, assignmentCompleteness),
      dataQualityState: assignmentCompleteness >= 80 ? "MEDIUM" : "LOW",
      responsibleUserId: responsible?.id || null,
      responsibleLabel: responsible?.name || "Nealocat",
      detectedAt: earliest,
      dueAt: earliest,
      recommendedAction: "Verifică taskurile și legăturile lor cu obligațiile BOOKED.",
      evidence: [
        evidence("Tip", kind),
        evidence("Taskuri", group.length),
        evidence("Responsabil client", responsible?.name || "Nealocat"),
        evidence("Executori planificați", group.filter((task) => task.assignedToUserId).length)
      ],
      sourceRefs: group.slice(0, 10).map(operationTaskRef),
      deepLink: `/admin/operational?status=overdue&kind=${encodeURIComponent(kind)}`,
      relevantWindow: `overdue:${context.snapshotDate}`,
      groupKey: `OPERATION_TASK_OVERDUE:${key}`,
      occurrenceCount: group.length,
      asOf,
      ageReference: snapshotDate
    }));
  }

  const allReservations = locations.flatMap((location) =>
    location.reservations.filter((reservation) => reservation.status === "BOOKED").map((reservation) => ({ reservation, location }))
  ).filter(({ reservation }) => reservationMatchesEntity(reservation, context.selectedEntityCodes));
  const taskKeys = new Set(relevantTasks.filter((task) => !["ARCHIVED", "CANCELLED"].includes(task.status))
    .map((task) => `${task.reservationId}|${task.kind}`));
  const missingTasks: Array<{ reservation: LocationRow["reservations"][number]; location: LocationRow; kind: string }> = [];
  for (const { reservation, location } of allReservations) {
    const requirement = operationalRequirementForBooked({ reservationStatus: reservation.status, locationType: location.type });
    for (const kind of requirement.requiredKinds) {
      if (!taskKeys.has(`${reservation.id}|${kind}`)) missingTasks.push({ reservation, location, kind });
    }
  }
  if (missingTasks.length) {
    alerts.push(groupedOperationDataAlert({
      ruleType: "BOOKED_WITHOUT_OPERATION_TASK",
      reasonCode: "REQUIRED_TASK_MISSING",
      title: "Obligații BOOKED fără task operațional",
      summary: missingTasks.length === 1
        ? "O obligație statică nu are taskul operațional așteptat."
        : `${missingTasks.length} obligații statice nu au taskul operațional așteptat.`,
      rows: missingTasks.map(({ reservation, location, kind }) => ({
        id: `${reservation.id}:${kind}`,
        label: `${location.code} · ${kind}`,
        href: `/admin/locatii?panel=reservations&reservationId=${encodeURIComponent(reservation.id)}`,
        createdAt: reservation.createdAt
      })),
      context,
      snapshotDate,
      asOf,
      assignmentCompleteness
    }));
  }

  const orphans = relevantTasks.filter((task) => {
    const linkedBooked = task.reservation?.status === "BOOKED";
    const linkedCampaign = task.campaign || task.reservation?.campaign;
    const campaignDecision = linkedCampaign ? deriveCampaignEffectiveStatus(linkedCampaign, snapshotDate).effectiveStatus : null;
    return !linkedBooked && !ACTIVE_CAMPAIGN_STATUSES.has(String(campaignDecision || ""));
  });
  if (orphans.length) {
    alerts.push(groupedOperationDataAlert({
      ruleType: "ORPHAN_OPERATION_TASK",
      reasonCode: "ORPHAN_OPERATION_TASK",
      title: "Taskuri fără obligație comercială validă",
      summary: orphans.length === 1
        ? "Un task nu este legat de BOOKED sau de o campanie activă/programată."
        : `${orphans.length} taskuri nu sunt legate de BOOKED sau de o campanie activă/programată.`,
      rows: orphans.map((task) => ({ ...operationTaskRef(task), createdAt: task.createdAt })),
      context,
      snapshotDate,
      asOf,
      assignmentCompleteness
    }));
  }

  const completedWithoutProof = relevantTasks.filter((task) => {
    if (task.status !== "DONE" || !["DECORATION", "NEUTRALIZATION", "MAINTENANCE"].includes(task.kind)) return false;
    if (!task.reservation) return false;
    const matched = task.reservation.documents.some((document) => {
      const notes = parseOperationalProofNotes(document.notes);
      const sameTask = task.legacyTaskId ? notes?.taskId === task.legacyTaskId : !notes?.taskId;
      return sameTask && proofContractForOperation({
        operationKind: task.kind,
        documentType: document.documentType,
        linkedToTaskOrReservation: true
      }).satisfied && (!document.expiryDate || document.expiryDate >= snapshotDate);
    });
    return !matched;
  });
  if (completedWithoutProof.length) {
    alerts.push(groupedOperationDataAlert({
      ruleType: "COMPLETED_WITHOUT_PROOF",
      reasonCode: "COMPLETED_WITHOUT_PROOF",
      title: "Taskuri finalizate fără dovadă canonică",
      summary: completedWithoutProof.length === 1
        ? "Un task finalizat nu are o fotografie activă legată corect."
        : `${completedWithoutProof.length} taskuri finalizate nu au o fotografie activă legată corect.`,
      rows: completedWithoutProof.map((task) => ({ ...operationTaskRef(task), createdAt: task.completedAt || task.updatedAt })),
      context,
      snapshotDate,
      asOf,
      assignmentCompleteness
    }));
  }
  return alerts;
}

function crmAlerts(
  rows: CrmActionRow[],
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  return rows.map((row) => {
    const overdueBusinessDays = businessDaysBetween(dateKey(row.dueAt), context.snapshotDate);
    const severity: ExecutiveAlertSeverity = overdueBusinessDays > 3 ? "P1" : "P2";
    const href = `/admin/crm?view=today&kind=opportunity&record=${encodeURIComponent(row.opportunity?.id || "")}`;
    return makeAlert({
      ruleType: "CRM_NEXT_ACTION_OVERDUE",
      reasonCode: "CRM_NEXT_ACTION_OVERDUE",
      domain: "CRM",
      entityType: "crm_next_action",
      entityId: row.id,
      entityLabel: `${row.company.name} · ${row.opportunity?.name || "Oportunitate"}`,
      companyEntity: "SHARED_CRM",
      title: "Next action CRM restantă",
      summary: row.description || "Oportunitatea are o acțiune deschisă cu termen depășit.",
      severity,
      impact: { kind: "COUNT", label: "Follow-up restant", count: 1 },
      confidence: 100,
      dataQualityState: row.ownerId ? "HIGH" : "MEDIUM",
      responsibleUserId: row.ownerId,
      responsibleLabel: row.owner?.name || "Nealocat",
      detectedAt: row.dueAt,
      dueAt: row.dueAt,
      recommendedAction: "Deschide oportunitatea și actualizează următoarea acțiune.",
      evidence: [
        evidence("Companie", row.company.name),
        evidence("Oportunitate", row.opportunity?.name || "-"),
        evidence("Etapă", row.opportunity?.stage || "-"),
        evidence("Întârziere", `${overdueBusinessDays} zile lucrătoare`)
      ],
      sourceRefs: [{ id: row.id, label: row.opportunity?.name || row.company.name, href }],
      deepLink: href,
      relevantWindow: `due:${dateKey(row.dueAt)}`,
      groupKey: `CRM_NEXT_ACTION_OVERDUE:${row.ownerId || "UNASSIGNED"}`,
      occurrenceCount: 1,
      asOf,
      ageReference: snapshotDate
    });
  });
}

function inventoryAlerts(
  locations: LocationRow[],
  campaigns: CampaignRow[],
  context: ExecutiveAlertCacheContext,
  snapshotDate: Date,
  asOf: Date
) {
  const alerts: ExecutiveAlert[] = [];
  const activeCampaignIds = new Set(campaigns.filter((campaign) => {
    const bookeds = locations.flatMap((location) => location.reservations)
      .filter((reservation) => reservation.campaignId === campaign.id);
    return ACTIVE_CAMPAIGN_STATUSES.has(deriveCampaignEffectiveStatus({ ...campaign, bookedPeriods: bookeds }, snapshotDate).effectiveStatus);
  }).map((campaign) => campaign.id));
  const missingByType = new Map<string, LocationRow[]>();
  const usedMissing: LocationRow[] = [];
  const unknown: LocationRow[] = [];

  for (const location of locations) {
    const mediaImages = location.images.filter((image) => !isProductionSketchImage(image));
    const manualDecision = decideAvailability({
      ...location,
      reservations: [],
      periodStart: snapshotDate,
      periodEnd: snapshotDate,
      now: snapshotDate
    });
    const eligible = location.lifecycleStatus === "ACTIVE" && manualDecision.isBookable;
    if (!["ACTIVE", "INACTIVE", "ARCHIVED", "MAINTENANCE"].includes(location.lifecycleStatus) ||
        (location.lifecycleStatus === "ACTIVE" && manualDecision.status === "UNKNOWN")) {
      unknown.push(location);
    }
    if (!eligible || location.mainPhotoUrl || mediaImages.length) continue;
    const used = location.reservations.some((reservation) =>
      reservation.status === "BOOKED" && reservation.campaignId && activeCampaignIds.has(reservation.campaignId)
    );
    if (used) usedMissing.push(location);
    else addToGroup(missingByType, location.type || "Format necunoscut", location);
  }

  for (const location of usedMissing) {
    const href = `/admin/locatii?locationId=${encodeURIComponent(location.id)}`;
    alerts.push(makeAlert({
      ruleType: "ACTIVE_LOCATION_PHOTO_MISSING",
      reasonCode: "ACTIVE_LOCATION_PHOTO_MISSING",
      domain: "INVENTORY",
      entityType: "location",
      entityId: location.id,
      entityLabel: location.code,
      companyEntity: "SHARED_INVENTORY",
      title: "Locație activă în campanie fără fotografie",
      summary: `${location.code} este folosită într-o campanie relevantă și nu are fotografie comercială.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "Locație fără fotografie", count: 1 },
      confidence: 100,
      dataQualityState: "LOW",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: location.createdAt,
      dueAt: null,
      recommendedAction: "Verifică inventarul și adaugă fotografia comercială potrivită.",
      evidence: [evidence("Locație", location.code), evidence("Format", location.type || "Necunoscut")],
      sourceRefs: [{ id: location.id, label: location.code, href }],
      deepLink: href,
      relevantWindow: `snapshot:${context.snapshotDate}`,
      groupKey: `ACTIVE_LOCATION_PHOTO_MISSING:${location.type || "UNKNOWN"}`,
      occurrenceCount: 1,
      asOf,
      ageReference: snapshotDate
    }));
  }
  for (const [type, group] of missingByType) {
    alerts.push(makeAlert({
      ruleType: "ACTIVE_LOCATION_PHOTO_MISSING",
      reasonCode: "ACTIVE_LOCATION_PHOTO_MISSING",
      domain: "INVENTORY",
      entityType: "location_group",
      entityId: type,
      entityLabel: type,
      companyEntity: "SHARED_INVENTORY",
      title: "Locații vandabile fără fotografie",
      summary: `${group.length} locații active din formatul ${type} nu au fotografie comercială.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "Locații fără fotografie", count: group.length },
      confidence: 100,
      dataQualityState: "LOW",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: earliestDate(group.map((location) => location.createdAt)) || snapshotDate,
      dueAt: null,
      recommendedAction: "Revizuiește locațiile din inventar.",
      evidence: [evidence("Format", type), evidence("Locații", group.length)],
      sourceRefs: group.slice(0, 10).map((location) => ({
        id: location.id,
        label: location.code,
        href: `/admin/locatii?locationId=${encodeURIComponent(location.id)}`
      })),
      deepLink: `/admin/locatii?query=${encodeURIComponent(type)}`,
      relevantWindow: "active-sellable",
      groupKey: `ACTIVE_LOCATION_PHOTO_MISSING:${type}`,
      occurrenceCount: group.length,
      asOf,
      ageReference: snapshotDate
    }));
  }
  if (unknown.length) {
    alerts.push(makeAlert({
      ruleType: "UNKNOWN_INVENTORY_STATE",
      reasonCode: "UNKNOWN_INVENTORY_STATE",
      domain: "INVENTORY",
      entityType: "location_group",
      entityId: "unknown-state",
      entityLabel: "Inventar neclasificat",
      companyEntity: "SHARED_INVENTORY",
      title: "Stări de inventar necunoscute",
      summary: `${unknown.length} locații nu pot fi clasificate sigur în partiția inventarului.`,
      severity: "DATA_QUALITY",
      impact: { kind: "DATA_QUALITY", label: "Locații neclasificate", count: unknown.length },
      confidence: 100,
      dataQualityState: "DATA_INSUFFICIENT",
      responsibleUserId: null,
      responsibleLabel: "Nealocat",
      detectedAt: earliestDate(unknown.map((location) => location.updatedAt)) || snapshotDate,
      dueAt: null,
      recommendedAction: "Verifică lifecycle-ul și blocajele locațiilor afectate.",
      evidence: [evidence("Locații", unknown.length)],
      sourceRefs: unknown.slice(0, 10).map((location) => ({
        id: location.id,
        label: location.code,
        href: `/admin/locatii?locationId=${encodeURIComponent(location.id)}`
      })),
      deepLink: "/admin/locatii?status=UNKNOWN",
      relevantWindow: `snapshot:${context.snapshotDate}`,
      groupKey: "UNKNOWN_INVENTORY_STATE",
      occurrenceCount: unknown.length,
      asOf,
      ageReference: snapshotDate
    }));
  }
  return alerts;
}

function groupedOperationDataAlert(input: {
  ruleType: Extract<ExecutiveAlertRuleType, "BOOKED_WITHOUT_OPERATION_TASK" | "ORPHAN_OPERATION_TASK" | "COMPLETED_WITHOUT_PROOF">;
  reasonCode: string;
  title: string;
  summary: string;
  rows: Array<{ id: string; label: string; href: string; createdAt: Date }>;
  context: ExecutiveAlertCacheContext;
  snapshotDate: Date;
  asOf: Date;
  assignmentCompleteness: number;
}) {
  return makeAlert({
    ruleType: input.ruleType,
    reasonCode: input.reasonCode,
    domain: "OPERATIONS",
    entityType: "operation_reconciliation_group",
    entityId: input.ruleType,
    entityLabel: input.title,
    companyEntity: "UNKNOWN",
    title: input.title,
    summary: input.summary,
    severity: "DATA_QUALITY",
    impact: { kind: "DATA_QUALITY", label: "Cazuri în dry-run", count: input.rows.length },
    confidence: Math.min(70, input.assignmentCompleteness),
    dataQualityState: "LOW",
    responsibleUserId: null,
    responsibleLabel: "Nealocat",
    detectedAt: earliestDate(input.rows.map((row) => row.createdAt)) || input.snapshotDate,
    dueAt: null,
    recommendedAction: "Consultă dry-run-ul de reconciliere; nu aplica modificări automat.",
    evidence: [
      evidence("Cazuri", input.rows.length),
      evidence("Assignment completeness", `${input.assignmentCompleteness}%`)
    ],
    sourceRefs: input.rows.slice(0, 10).map(({ id, label, href }) => ({ id, label, href })),
    deepLink: `/admin/dashboard?panel=operation-task-reconciliation&category=${encodeURIComponent(input.ruleType)}`,
    relevantWindow: `snapshot:${input.context.snapshotDate}`,
    groupKey: input.ruleType,
    occurrenceCount: input.rows.length,
    asOf: input.asOf,
    ageReference: input.snapshotDate
  });
}

type AlertInput = Omit<ExecutiveAlert, "id" | "fingerprint" | "reasonCodes" | "age" | "detectedAt" | "dueAt" | "asOf"> & {
  reasonCodes?: string[];
  detectedAt: Date;
  dueAt: Date | null;
  asOf: Date;
  ageReference: Date;
};

export function makeAlert(input: AlertInput): ExecutiveAlert {
  const { ageReference, ...alert } = input;
  const relevantWindow = input.relevantWindow;
  const fingerprint = alertFingerprint(input.ruleType, input.entityType, input.entityId, relevantWindow);
  return {
    ...alert,
    id: `exec_alert_${fingerprint.slice(0, 20)}`,
    fingerprint,
    reasonCodes: input.reasonCodes || [input.reasonCode],
    detectedAt: input.detectedAt.toISOString(),
    dueAt: input.dueAt?.toISOString() || null,
    age: alertAge(input.detectedAt, ageReference),
    asOf: input.asOf.toISOString()
  };
}

export function alertFingerprint(ruleType: string, entityType: string, entityId: string, relevantWindow: string) {
  return createHash("sha256")
    .update([ruleType, entityType, entityId, relevantWindow].join("|"))
    .digest("hex");
}

export function dedupeExecutiveAlerts(alerts: ExecutiveAlert[]) {
  const unique = new Map<string, ExecutiveAlert>();
  for (const alert of alerts) {
    const current = unique.get(alert.fingerprint);
    if (!current) {
      unique.set(alert.fingerprint, alert);
      continue;
    }
    const sourceRefs = [...new Map([...current.sourceRefs, ...alert.sourceRefs].map((row) => [row.id, row])).values()];
    unique.set(alert.fingerprint, {
      ...current,
      occurrenceCount: Math.max(current.occurrenceCount, alert.occurrenceCount),
      sourceRefs
    });
  }
  return [...unique.values()];
}

export function receivableAgingSeverity(overdueDays: number): Extract<ExecutiveAlertSeverity, "P0" | "P1" | "P2"> {
  return overdueDays > 90 ? "P0" : overdueDays > 30 ? "P1" : "P2";
}

export function holdExpirySeverity(hoursUntilExpiry: number): Extract<ExecutiveAlertSeverity, "P1" | "P2"> | null {
  if (hoursUntilExpiry <= 0 || hoursUntilExpiry > 72) return null;
  return hoursUntilExpiry <= 24 ? "P1" : "P2";
}

export function isOverdueReceivable(input: {
  includedInReport: boolean;
  needsReview: boolean;
  remainingAmount: Prisma.Decimal.Value;
  dueDate: Date | null;
  snapshotDate: Date;
}) {
  return input.includedInReport &&
    !input.needsReview &&
    new Prisma.Decimal(input.remainingAmount).gt("0.01") &&
    Boolean(input.dueDate && input.dueDate < input.snapshotDate);
}

export function filterAlerts(alerts: ExecutiveAlert[], context: Pick<ExecutiveAlertCacheContext, "severity" | "domain" | "owner" | "dataQuality" | "ruleType">) {
  return alerts.filter((alert) => {
    if (context.severity !== "ALL" && alert.severity !== context.severity) return false;
    if (context.domain !== "ALL" && alert.domain !== context.domain) return false;
    if (context.dataQuality !== "ALL" && alert.dataQualityState !== context.dataQuality) return false;
    if (context.ruleType !== "ALL" && alert.ruleType !== context.ruleType) return false;
    if (context.owner === "UNASSIGNED" && alert.responsibleUserId) return false;
    if (context.owner && context.owner !== "UNASSIGNED" && alert.responsibleUserId !== context.owner) return false;
    return true;
  });
}

export function summarizeAlerts(alerts: ExecutiveAlert[]) {
  const bySeverity = { P0: 0, P1: 0, P2: 0, DATA_QUALITY: 0 } satisfies Record<ExecutiveAlertSeverity, number>;
  const byDomain = { FINANCE: 0, CAMPAIGNS: 0, HOLD: 0, OPERATIONS: 0, CRM: 0, INVENTORY: 0 } satisfies Record<ExecutiveAlertDomain, number>;
  for (const alert of alerts) {
    bySeverity[alert.severity] += 1;
    byDomain[alert.domain] += 1;
  }
  return { total: alerts.length, bySeverity, byDomain };
}

function makeAlertPreview(alert: ExecutiveAlert, scope: ExecutiveScope) {
  const params = new URLSearchParams({
    panel: "alerts",
    entity: scope.entitySelection,
    snapshot: scope.snapshotDate,
    period: scope.periodPreset,
    periodStart: scope.periodStart,
    periodEnd: scope.periodEnd,
    ruleType: alert.ruleType
  });
  return {
    id: alert.id,
    label: alert.title,
    detail: alert.summary,
    count: alert.occurrenceCount,
    severity: alert.severity === "P0" ? "critical" as const : alert.severity === "DATA_QUALITY" ? "neutral" as const : "warning" as const,
    severityCode: alert.severity,
    confidence: alert.confidence,
    dataQuality: alert.dataQualityState,
    href: `/admin/dashboard?${params.toString()}#executive-alerts`
  };
}

export function executiveAlertPreview(response: ExecutiveAlertsResponse) {
  return response.items.slice(0, 6).map((alert) => makeAlertPreview(alert, response.scope));
}

export function executiveAttentionPreview(response: ExecutiveAlertsResponse): ExecutiveAttentionItem[] {
  const alertPreviewIds = new Set(response.items.slice(0, 3).map((alert) => alert.id));
  return response.items
    .filter((alert) => !alertPreviewIds.has(alert.id) && alert.severity !== "DATA_QUALITY")
    .slice(0, 10)
    .map((alert) => ({
    id: alert.id,
    title: alert.title,
    summary: alert.summary,
    severity: alert.severity,
    domain: alert.domain,
    impactLabel: alert.impact.amount
      ? `${alert.impact.amount} ${alert.impact.currency || ""}`.trim()
      : alert.impact.count != null
        ? `${alert.impact.count} cazuri`
        : alert.impact.label,
    responsibleLabel: alert.responsibleLabel,
    deadline: alert.dueAt,
    confidence: alert.confidence,
    occurrenceCount: alert.occurrenceCount,
    why: alert.reasonCodes.join(" · "),
    href: alert.deepLink
  }));
}

export function campaignRiskSeverity(status: string, daysUntilStart: number): ExecutiveAlertSeverity {
  if (status === "ACTIVE" || daysUntilStart <= 1) return "P0";
  if (daysUntilStart <= 3) return "P1";
  return "P2";
}

function campaignRiskSummary(reasonCodes: string[]) {
  const labels: Record<string, string> = {
    CAMPAIGN_OWNER_MISSING: "responsabil canonic lipsă",
    REQUIRED_BOOKED_MISSING: "nicio rezervare BOOKED validă",
    AVAILABILITY_CONFLICT: "conflict de disponibilitate confirmat"
  };
  return reasonCodes.map((code) => labels[code] || code).join("; ");
}

function thresholdEntry(startDate: Date | null, severity: ExecutiveAlertSeverity) {
  if (!startDate) return new Date(0);
  const days = severity === "P0" ? 1 : severity === "P1" ? 3 : severity === "P2" ? 7 : 0;
  const value = new Date(startDate);
  value.setUTCDate(value.getUTCDate() - days);
  return value;
}

function operationKindLabel(kind: string) {
  const labels: Record<string, string> = {
    DECORATION: "decorare",
    NEUTRALIZATION: "neutralizare",
    INSTALLATION: "instalare",
    MAINTENANCE: "mentenanță"
  };
  return labels[kind.toUpperCase()] || "operațiune";
}

function receivableHref(row: ReceivableRow, overdueDays?: number) {
  const params = new URLSearchParams({
    status: "overdue",
    companyCode: row.companyCode || "",
    currency: row.currency || "",
    q: row.invoiceNumber || row.id
  });
  if (overdueDays) params.set("aging", overdueDays > 90 ? "90+" : overdueDays > 30 ? "31-90" : "1-30");
  return `/admin/financiar/incasari?${params.toString()}`;
}

function operationTaskRef(task: OperationTaskRow) {
  const label = `${task.location?.code || task.reservation?.location.code || task.id} · ${task.kind}`;
  return {
    id: task.id,
    label,
    href: `/admin/operational?taskId=${encodeURIComponent(task.id)}`
  };
}

function taskEntityCode(task: OperationTaskRow) {
  return companyCodeForEntity(
    task.campaign?.companyEntity ||
    task.reservation?.campaign?.companyEntity ||
    task.reservation?.contractCompany
  ) as ExecutiveEntityCode | null;
}

function taskMatchesEntity(task: OperationTaskRow, selected: ExecutiveEntityCode[]) {
  const code = taskEntityCode(task);
  return code ? selected.includes(code) : selected.length === 3;
}

function reservationEntityCode(reservation: LocationRow["reservations"][number]) {
  return companyCodeForEntity(reservation.campaign?.companyEntity || normalizeCompanyEntity(reservation.contractCompany)) as ExecutiveEntityCode | null;
}

function reservationMatchesEntity(reservation: LocationRow["reservations"][number], selected: ExecutiveEntityCode[]) {
  const code = reservationEntityCode(reservation);
  return code ? selected.includes(code) : selected.length === 3;
}

function knownEntityCode(value?: string | null) {
  return ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"].includes(String(value || ""))
    ? value as ExecutiveEntityCode
    : null;
}

function evidence(label: string, value: string | number | null | undefined): ExecutiveAlertEvidenceItem {
  return { label, value: value == null ? "-" : String(value) };
}

function recordEvidence(label: string, values: Record<string, number>) {
  return Object.entries(values).map(([key, value]) => evidence(`${label}: ${key}`, value));
}

function alertAge(detectedAt: Date, reference: Date) {
  const milliseconds = Math.max(0, reference.getTime() - detectedAt.getTime());
  const hours = Math.floor(milliseconds / 3_600_000);
  const days = Math.floor(hours / 24);
  return {
    days,
    hours,
    label: days ? `${days} zile` : `${hours} ore`
  };
}

function alertSort(left: ExecutiveAlert, right: ExecutiveAlert) {
  const priority = { P0: 0, P1: 1, P2: 2, DATA_QUALITY: 3 };
  return priority[left.severity] - priority[right.severity] ||
    dueTime(left) - dueTime(right) ||
    right.confidence - left.confidence ||
    left.fingerprint.localeCompare(right.fingerprint);
}

function dueTime(alert: ExecutiveAlert) {
  return alert.dueAt ? new Date(alert.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function earliestDate(values: Date[]) {
  return values.length ? values.reduce((earliest, value) => value < earliest ? value : earliest) : null;
}

function addToGroup<T>(map: Map<string, T[]>, key: string, value: T) {
  const rows = map.get(key) || [];
  rows.push(value);
  map.set(key, rows);
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row);
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

export function businessDaysBetween(from: string, to: string) {
  let current = from;
  let count = 0;
  while (current < to) {
    current = addDateKeyDays(current, 1);
    const day = new Date(`${current}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}
