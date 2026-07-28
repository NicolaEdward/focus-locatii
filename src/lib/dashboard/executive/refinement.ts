import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import type { AuthSession } from "@/lib/auth";
import { deriveCampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import {
  EXECUTIVE_REVALIDATE_SECONDS,
  type ExecutiveEntityCode,
  type ExecutiveScope
} from "@/lib/dashboard/executive/contracts";
import {
  EXECUTIVE_REFINEMENT_CONTRACT_VERSION,
  type ExecutiveActivityItem,
  type ExecutiveActivityResponse,
  type ExecutiveAmount,
  type ExecutiveCustomer,
  type ExecutiveCustomersResponse,
  type ExecutivePeopleResponse,
  type ExecutivePerson,
  type ExecutiveRefinementMeta,
  type ExecutiveSearchResponse,
  type ExecutiveSearchResult
} from "@/lib/dashboard/executive/refinement-contracts";
import {
  entityValueForCode,
  executiveCacheKey,
  executiveScopeForSession
} from "@/lib/dashboard/executive/scope";
import { bucharestDayBounds } from "@/lib/dashboard/executive/time";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, type UserRole } from "@/lib/rbac";

const activeCampaignStatuses = ["ACTIVE", "SCHEDULED"] as const;
const activeOpportunityStages = ["opportunity", "quoted", "negotiation", "contracting"];
const activeTaskStatuses = ["NEW", "IN_PROGRESS"] as const;
const recentCrmThresholdDays = 14;

const cachedPeople = unstable_cache(
  async (scope: ExecutiveScope) => queryExecutivePeople(scope),
  ["executive-people-v3"],
  { revalidate: EXECUTIVE_REVALIDATE_SECONDS, tags: ["executive-people"] }
);

const cachedCustomers = unstable_cache(
  async (scope: ExecutiveScope) => queryExecutiveCustomers(scope),
  ["executive-customers-v3"],
  { revalidate: EXECUTIVE_REVALIDATE_SECONDS, tags: ["executive-customers"] }
);

const cachedActivity = unstable_cache(
  async (scope: ExecutiveScope) => queryExecutiveActivity(scope),
  ["executive-activity-v3"],
  { revalidate: EXECUTIVE_REVALIDATE_SECONDS, tags: ["executive-activity"] }
);

export async function getExecutivePeople(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  const scope = executiveScopeForSession(session, input);
  executiveCacheKey(scope);
  return cachedPeople(scope);
}

export async function getExecutiveCustomers(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  const scope = executiveScopeForSession(session, input);
  executiveCacheKey(scope);
  return cachedCustomers(scope);
}

export async function getExecutiveActivity(
  session: AuthSession,
  input: Record<string, string | string[] | undefined> = {}
) {
  const scope = executiveScopeForSession(session, input);
  executiveCacheKey(scope);
  return cachedActivity(scope);
}

export async function queryExecutivePeople(
  scope: ExecutiveScope,
  now = new Date()
): Promise<ExecutivePeopleResponse> {
  const snapshot = bucharestDayBounds(scope.snapshotDate).endExclusive;
  const recentCrmThreshold = new Date(snapshot.getTime() - recentCrmThresholdDays * 86_400_000);
  const entityScoped = scope.entitySelection !== "ALL";
  const selectedEntityValues = scope.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const taskEntityWhere: Prisma.OperationTaskWhereInput = entityScoped
    ? {
        OR: [
          { campaign: { is: { companyEntity: { in: selectedEntityValues } } } },
          { reservation: { is: { campaign: { is: { companyEntity: { in: selectedEntityValues } } } } } }
        ]
      }
    : {};
  const [
    users,
    clients,
    campaigns,
    tasks,
    crmActions,
    opportunities,
    crmActivity,
    auditActivity,
    overdueReceivables
  ] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    }),
    prisma.clientAccount.findMany({
      where: {
        mergedIntoClientId: null,
        accountOwnerUserId: { not: null },
        ...(entityScoped ? {
          OR: [
            { campaigns: { some: { companyEntity: { in: selectedEntityValues } } } },
            { financialReceivables: { some: { companyCode: { in: scope.selectedEntityCodes } } } }
          ]
        } : {})
      },
      select: { id: true, accountOwnerUserId: true }
    }),
    prisma.campaign.findMany({
      where: {
        archivedAt: null,
        ...(entityScoped ? { companyEntity: { in: selectedEntityValues } } : {})
      },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        accountOwnerUserId: true,
        sellerUserId: true,
        reservations: {
          where: { status: "BOOKED" },
          select: { status: true, periodStart: true, periodEnd: true }
        }
      }
    }),
    prisma.operationTask.findMany({
      where: taskEntityWhere,
      select: {
        id: true,
        assignedToUserId: true,
        status: true,
        scheduledFor: true,
        updatedAt: true
      }
    }),
    entityScoped
      ? Promise.resolve([])
      : prisma.crmNextAction.findMany({
          where: { status: "open" },
          select: { id: true, ownerId: true, dueAt: true }
        }),
    entityScoped
      ? Promise.resolve([])
      : prisma.crmOpportunity.findMany({
          where: { stage: { in: activeOpportunityStages } },
          select: {
            id: true,
            ownerId: true,
            stage: true,
            currency: true,
            quotedValue: true,
            revisedValue: true,
            agreedValue: true
          }
        }),
    entityScoped
      ? Promise.resolve([])
      : prisma.crmEvent.groupBy({
          by: ["actorUserId"],
          where: { actorUserId: { not: null } },
          _max: { occurredAt: true }
        }),
    entityScoped
      ? Promise.resolve([])
      : prisma.auditLog.groupBy({
          by: ["userId"],
          where: {
            userId: { not: null },
            entityType: { notIn: ["auth_session", "auth_action_token"] }
          },
          _max: { createdAt: true }
        }),
    prisma.financialReceivable.findMany({
      where: {
        includedInReport: true,
        needsReview: false,
        remainingAmount: { gt: 0.01 },
        dueDate: { lt: snapshot },
        accountOwnerUserId: { not: null },
        companyCode: { in: scope.selectedEntityCodes }
      },
      select: {
        id: true,
        accountOwnerUserId: true,
        companyCode: true,
        currency: true,
        remainingAmount: true
      }
    })
  ]);

  const campaignCounts = new Map<string, number>();
  for (const campaign of campaigns) {
    const decision = deriveCampaignEffectiveStatus({
      ...campaign,
      bookedPeriods: campaign.reservations
    }, now);
    if (!activeCampaignStatuses.includes(decision.effectiveStatus as typeof activeCampaignStatuses[number])) continue;
    for (const ownerId of new Set([campaign.accountOwnerUserId, campaign.sellerUserId].filter(Boolean) as string[])) {
      campaignCounts.set(ownerId, (campaignCounts.get(ownerId) || 0) + 1);
    }
  }

  const crmActivityByUser = new Map(crmActivity.map((row) => [row.actorUserId as string, row._max.occurredAt]));
  const auditActivityByUser = new Map(auditActivity.map((row) => [row.userId as string, row._max.createdAt]));
  const clientsByUser = countBy(clients, (row) => row.accountOwnerUserId as string);
  const openTasksByUser = countBy(tasks.filter((row) => activeTaskStatuses.includes(row.status as typeof activeTaskStatuses[number]) && row.assignedToUserId), (row) => row.assignedToUserId as string);
  const completedTasksByUser = countBy(tasks.filter((row) => row.status === "DONE" && row.assignedToUserId), (row) => row.assignedToUserId as string);
  const overdueTasksByUser = countBy(tasks.filter((row) => activeTaskStatuses.includes(row.status as typeof activeTaskStatuses[number]) && row.assignedToUserId && row.scheduledFor && row.scheduledFor < snapshot), (row) => row.assignedToUserId as string);
  const openActionsByUser = countBy(crmActions.filter((row) => row.ownerId), (row) => row.ownerId as string);
  const overdueActionsByUser = countBy(crmActions.filter((row) => row.ownerId && row.dueAt < snapshot), (row) => row.ownerId as string);
  const opportunitiesByUser = countBy(opportunities.filter((row) => row.ownerId), (row) => row.ownerId as string);
  const overdueInvoicesByUser = countBy(overdueReceivables, (row) => row.accountOwnerUserId as string);

  const people: ExecutivePerson[] = users.map((user) => {
    const userTasks = tasks.filter((task) => task.assignedToUserId === user.id);
    const lastTaskActivity = latestDate(userTasks.map((task) => task.updatedAt));
    const lastCrmActivity = crmActivityByUser.get(user.id) || null;
    const lastAuditActivity = auditActivityByUser.get(user.id) || null;
    const lastBusinessActivityAt = latestDate([lastTaskActivity, lastCrmActivity, lastAuditActivity].filter(Boolean) as Date[]);
    const issues: ExecutivePerson["issues"] = [];
    addIssue(issues, "OVERDUE_TASKS", "Taskuri întârziate", overdueTasksByUser.get(user.id) || 0, `/admin/operational?assignee=${user.id}&status=delayed`);
    addIssue(issues, "OVERDUE_CRM_ACTIONS", "Follow-up-uri restante", overdueActionsByUser.get(user.id) || 0, `/admin/crm?view=today&owner=${user.id}&due=overdue`);
    addIssue(issues, "OVERDUE_RECEIVABLES", "Facturi restante în portofoliu", overdueInvoicesByUser.get(user.id) || 0, `/admin/financiar/incasari?status=overdue&owner=${user.id}`);
    if (
      !entityScoped &&
      ["SALES_AGENT", "SALES_DIRECTOR"].includes(user.role) &&
      (!lastCrmActivity || lastCrmActivity < recentCrmThreshold)
    ) {
      addIssue(issues, "CRM_ACTIVITY_MISSING", `Nicio activitate CRM în ultimele ${recentCrmThresholdDays} zile`, 1, `/admin/crm?owner=${user.id}`);
    }
    const openTasks = openTasksByUser.get(user.id) || 0;
    const campaignsManaged = campaignCounts.get(user.id) || 0;
    const workload = factualWorkload({
      openTasks,
      campaignsManaged,
      overdueTasks: overdueTasksByUser.get(user.id) || 0,
      overdueInvoices: overdueInvoicesByUser.get(user.id) || 0,
      overdueActions: overdueActionsByUser.get(user.id) || 0,
      entityScoped
    });
    return {
      id: user.id,
      name: user.name,
      role: user.role as UserRole,
      roleLabel: ROLE_LABELS[user.role as UserRole],
      department: departmentForRole(user.role as UserRole),
      departmentSource: "ROLE_DERIVED" as const,
      clientsManaged: clientsByUser.get(user.id) || 0,
      campaignsManaged,
      openTasks,
      completedTasks: completedTasksByUser.get(user.id) || 0,
      openCrmActions: openActionsByUser.get(user.id) || 0,
      openOpportunities: opportunitiesByUser.get(user.id) || 0,
      pipeline: opportunityAmounts(opportunities.filter((row) => row.ownerId === user.id)),
      lastBusinessActivityAt: lastBusinessActivityAt?.toISOString() || null,
      workload,
      issues,
      dataQuality: user.role === "FIELD_OPERATOR" && !userTasks.length ? "LOW" as const : "MEDIUM" as const
    };
  })
    .filter((person) => !entityScoped ||
      person.clientsManaged > 0 ||
      person.campaignsManaged > 0 ||
      person.openTasks > 0 ||
      person.completedTasks > 0 ||
      person.issues.length > 0
    )
    .sort((left, right) => right.issues.length - left.issues.length || left.name.localeCompare(right.name, "ro"));

  return {
    kind: "executive-people",
    scope,
    people,
    filterApplicability: entityScoped ? "APPLIED_WITH_LIMITATIONS" : "APPLIED",
    notes: entityScoped
      ? [
          "Campaniile, taskurile și facturile sunt filtrate după entitatea selectată.",
          "CRM și activitatea generală de audit nu au asociere juridică și sunt excluse din această vedere."
        ]
      : [],
    meta: refinementMeta(now)
  };
}

export async function queryExecutiveCustomers(
  scope: ExecutiveScope,
  now = new Date()
): Promise<ExecutiveCustomersResponse> {
  const snapshot = bucharestDayBounds(scope.snapshotDate).start;
  const selectedEntityValues = scope.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const [clients, campaigns, receivables] = await Promise.all([
    prisma.clientAccount.findMany({
      where: { mergedIntoClientId: null },
      select: {
        id: true,
        companyName: true,
        accountOwnerUserId: true,
        accountOwner: { select: { name: true } }
      }
    }),
    prisma.campaign.findMany({
      where: {
        archivedAt: null,
        companyEntity: { in: selectedEntityValues }
      },
      select: {
        id: true,
        clientId: true,
        status: true,
        startDate: true,
        endDate: true,
        companyEntity: true,
        currency: true,
        totalContractValue: true,
        reservations: {
          where: { status: "BOOKED" },
          select: { id: true, status: true, periodStart: true, periodEnd: true }
        },
        documents: {
          where: { documentType: "contract", status: "active" },
          select: { id: true },
          take: 1
        }
      }
    }),
    prisma.financialReceivable.findMany({
      where: {
        includedInReport: true,
        needsReview: false,
        remainingAmount: { gt: 0.01 },
        clientId: { not: null },
        companyCode: { in: scope.selectedEntityCodes }
      },
      select: {
        id: true,
        clientId: true,
        companyCode: true,
        currency: true,
        remainingAmount: true,
        dueDate: true
      }
    })
  ]);

  const rows = clients.map((client): ExecutiveCustomer => {
    const clientCampaigns = campaigns.map((campaign) => ({
      campaign,
      decision: deriveCampaignEffectiveStatus({
        ...campaign,
        bookedPeriods: campaign.reservations
      }, now)
    })).filter((row) => row.campaign.clientId === client.id);
    const active = clientCampaigns.filter((row) => row.decision.effectiveStatus === "ACTIVE");
    const upcoming = clientCampaigns.filter((row) => row.decision.effectiveStatus === "SCHEDULED");
    const commercial = [...active, ...upcoming];
    const clientReceivables = receivables.filter((row) => row.clientId === client.id);
    const overdue = clientReceivables.filter((row) => row.dueDate && row.dueDate < snapshot);
    const riskIssues: string[] = [];
    if (overdue.length) riskIssues.push(countLabel(overdue.length, "factură restantă", "facturi restante"));
    if (commercial.some((row) => row.campaign.reservations.length === 0)) riskIssues.push("Campanie fără BOOKED");
    if (commercial.some((row) => row.campaign.documents.length === 0)) riskIssues.push("Document contractual lipsă");
    if (!client.accountOwnerUserId) riskIssues.push("Account manager nealocat");
    return {
      id: client.id,
      companyName: client.companyName,
      ownerLabel: client.accountOwner?.name || "Nealocat",
      activeCampaigns: active.length,
      upcomingCampaigns: upcoming.length,
      bookedReservations: commercial.reduce((sum, row) => sum + row.campaign.reservations.length, 0),
      businessValue: campaignAmounts(commercial.map((row) => row.campaign)),
      outstanding: receivableAmounts(clientReceivables),
      overdue: receivableAmounts(overdue),
      riskIssues,
      contractDocumentState: commercial.length
        ? commercial.every((row) => row.campaign.documents.length > 0) ? "AVAILABLE" : "MISSING"
        : "NOT_APPLICABLE",
      crmActivityState: "DATA_INSUFFICIENT",
      businessReasons: [
        ...(active.length ? [countLabel(active.length, "campanie activă", "campanii active")] : []),
        ...(upcoming.length ? [countLabel(upcoming.length, "campanie viitoare", "campanii viitoare")] : []),
        ...(commercial.reduce((sum, row) => sum + row.campaign.reservations.length, 0)
          ? [countLabel(commercial.reduce((sum, row) => sum + row.campaign.reservations.length, 0), "rezervare BOOKED", "rezervări BOOKED")]
          : []),
        ...(campaignAmounts(commercial.map((row) => row.campaign)).length
          ? ["Valoare contractuală disponibilă separat pe entitate și monedă"]
          : [])
      ],
      href: `/admin/clienti?clientId=${encodeURIComponent(client.id)}`
    };
  });

  const topBusiness = rows
    .filter((row) => row.activeCampaigns || row.upcomingCampaigns || row.bookedReservations || row.businessValue.length)
    .sort((left, right) =>
      right.activeCampaigns - left.activeCampaigns ||
      right.bookedReservations - left.bookedReservations ||
      right.upcomingCampaigns - left.upcomingCampaigns ||
      left.companyName.localeCompare(right.companyName, "ro")
    )
    .slice(0, 12);
  const topRisk = rows
    .filter((row) => row.riskIssues.length)
    .sort((left, right) =>
      right.overdue.reduce((sum, amount) => sum + amount.count, 0) - left.overdue.reduce((sum, amount) => sum + amount.count, 0) ||
      right.riskIssues.length - left.riskIssues.length ||
      left.companyName.localeCompare(right.companyName, "ro")
    )
    .slice(0, 12);

  return {
    kind: "executive-customers",
    scope,
    topBusiness,
    topRisk,
    notes: [
      "Top Business este ordonat după activitate comercială demonstrabilă; monedele nu sunt însumate.",
      "Activitatea CRM nu este atribuită ClientAccount fără o asociere canonică explicită."
    ],
    meta: refinementMeta(now)
  };
}

export async function queryExecutiveActivity(
  scope: ExecutiveScope,
  now = new Date()
): Promise<ExecutiveActivityResponse> {
  const selectedEntityValues = scope.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [payments, reservations, campaigns, tasks, crmEvents] = await Promise.all([
    prisma.financialReceivablePayment.findMany({
      where: {
        status: "active",
        receivedAt: { gte: since },
        receivable: { is: { companyCode: { in: scope.selectedEntityCodes } } }
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        receivedAt: true,
        receivable: {
          select: {
            id: true,
            clientName: true,
            invoiceNumber: true,
            companyCode: true
          }
        }
      },
      orderBy: { receivedAt: "desc" },
      take: 20
    }),
    prisma.reservation.findMany({
      where: {
        status: "BOOKED",
        bookedAt: { gte: since },
        campaign: { is: { companyEntity: { in: selectedEntityValues } } }
      },
      select: {
        id: true,
        bookedAt: true,
        clientName: true,
        campaignName: true,
        location: { select: { code: true } },
        campaign: { select: { companyEntity: true } }
      },
      orderBy: { bookedAt: "desc" },
      take: 20
    }),
    prisma.campaign.findMany({
      where: {
        companyEntity: { in: selectedEntityValues },
        OR: [{ startDate: { gte: since, lte: now } }, { endDate: { gte: since, lte: now } }]
      },
      select: {
        id: true,
        campaignName: true,
        companyEntity: true,
        startDate: true,
        endDate: true,
        client: { select: { companyName: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.operationTask.findMany({
      where: {
        status: "DONE",
        completedAt: { gte: since },
        campaign: { is: { companyEntity: { in: selectedEntityValues } } }
      },
      select: {
        id: true,
        kind: true,
        completedAt: true,
        location: { select: { code: true } },
        campaign: { select: { id: true, campaignName: true, companyEntity: true } }
      },
      orderBy: { completedAt: "desc" },
      take: 20
    }),
    scope.entitySelection === "ALL"
      ? prisma.crmEvent.findMany({
          where: { occurredAt: { gte: since } },
          select: {
            id: true,
            type: true,
            summary: true,
            occurredAt: true,
            company: { select: { name: true } },
            opportunityId: true
          },
          orderBy: { occurredAt: "desc" },
          take: 20
        })
      : Promise.resolve([])
  ]);

  const items: ExecutiveActivityItem[] = [
    ...payments.map((payment) => ({
      id: `payment:${payment.id}`,
      tone: "POSITIVE" as const,
      type: "PAYMENT" as const,
      title: "Încasare înregistrată",
      detail: `${payment.receivable.clientName || "Client"} · ${money(payment.amount)} ${payment.currency} · ${payment.receivable.invoiceNumber || "factură"}`,
      occurredAt: payment.receivedAt.toISOString(),
      entityCode: knownEntityCode(payment.receivable.companyCode),
      href: `/admin/financiar/incasari?q=${encodeURIComponent(payment.receivable.invoiceNumber || payment.receivable.id)}`
    })),
    ...reservations.filter((reservation) => reservation.bookedAt).map((reservation) => ({
      id: `booking:${reservation.id}`,
      tone: "POSITIVE" as const,
      type: "BOOKING" as const,
      title: "BOOKED confirmat",
      detail: `${reservation.location.code} · ${reservation.clientName} · ${reservation.campaignName || "Campanie"}`,
      occurredAt: reservation.bookedAt!.toISOString(),
      entityCode: knownEntityCodeForValue(reservation.campaign?.companyEntity),
      href: `/admin/locatii?reservationId=${encodeURIComponent(reservation.id)}`
    })),
    ...campaigns.flatMap((campaign) => {
      const events: ExecutiveActivityItem[] = [];
      if (campaign.startDate && campaign.startDate >= since && campaign.startDate <= now) {
        events.push({
          id: `campaign-start:${campaign.id}`,
          tone: "NEUTRAL",
          type: "CAMPAIGN",
          title: "Campanie începută",
          detail: `${campaign.client.companyName} · ${campaign.campaignName}`,
          occurredAt: campaign.startDate.toISOString(),
          entityCode: knownEntityCodeForValue(campaign.companyEntity),
          href: `/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`
        });
      }
      if (campaign.endDate && campaign.endDate >= since && campaign.endDate <= now) {
        events.push({
          id: `campaign-end:${campaign.id}`,
          tone: "POSITIVE",
          type: "CAMPAIGN",
          title: "Campanie ajunsă la finalul perioadei",
          detail: `${campaign.client.companyName} · ${campaign.campaignName}`,
          occurredAt: campaign.endDate.toISOString(),
          entityCode: knownEntityCodeForValue(campaign.companyEntity),
          href: `/admin/campanii?campaignId=${encodeURIComponent(campaign.id)}`
        });
      }
      return events;
    }),
    ...tasks.filter((task) => task.completedAt).map((task) => ({
      id: `operation:${task.id}`,
      tone: "POSITIVE" as const,
      type: "OPERATION" as const,
      title: "Operațiune finalizată",
      detail: `${task.kind} · ${task.location?.code || "Locație"} · ${task.campaign?.campaignName || "Fără campanie"}`,
      occurredAt: task.completedAt!.toISOString(),
      entityCode: knownEntityCodeForValue(task.campaign?.companyEntity),
      href: `/admin/operational?taskId=${encodeURIComponent(task.id)}`
    })),
    ...crmEvents.map((event) => ({
      id: `crm:${event.id}`,
      tone: "NEUTRAL" as const,
      type: "CRM" as const,
      title: "Activitate CRM",
      detail: `${event.company.name} · ${event.summary}`,
      occurredAt: event.occurredAt.toISOString(),
      entityCode: "SHARED" as const,
      href: event.opportunityId
        ? `/admin/crm?view=pipeline&opportunityId=${encodeURIComponent(event.opportunityId)}`
        : "/admin/crm?view=today"
    }))
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 50);

  return {
    kind: "executive-activity",
    scope,
    items,
    unavailableSources: [
      "Contract semnat: statusul de semnare nu este canonic.",
      "Întâlniri: aplicația nu are un registru canonic de calendar.",
      ...(scope.entitySelection === "ALL" ? [] : ["CRM: activitatea nu are entitate juridică asociată canonic."])
    ],
    meta: refinementMeta(now)
  };
}

export async function searchExecutive(
  session: AuthSession,
  rawQuery: string,
  input: Record<string, string | string[] | undefined> = {}
): Promise<ExecutiveSearchResponse> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 2) return { kind: "executive-search", query, items: [], truncated: false };
  const scope = executiveScopeForSession(session, input);
  const entityScoped = scope.entitySelection !== "ALL";
  const selectedEntityValues = scope.selectedEntityCodes
    .map(entityValueForCode)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const contains = { contains: query };
  const [
    clients,
    campaigns,
    reservations,
    locations,
    invoices,
    payments,
    crmCompanies,
    opportunities,
    users,
    tasks,
    documents
  ] = await Promise.all([
    prisma.clientAccount.findMany({
      where: {
        mergedIntoClientId: null,
        AND: [
          { OR: [{ companyName: contains }, { taxId: contains }] },
          ...(entityScoped ? [{
            OR: [
              { campaigns: { some: { companyEntity: { in: selectedEntityValues } } } },
              { financialReceivables: { some: { companyCode: { in: scope.selectedEntityCodes } } } }
            ]
          }] : [])
        ]
      },
      select: { id: true, companyName: true, taxId: true },
      take: 4
    }),
    prisma.campaign.findMany({
      where: {
        ...(entityScoped ? { companyEntity: { in: selectedEntityValues } } : {}),
        OR: [{ campaignName: contains }, { campaignCode: contains }, { client: { companyName: contains } }]
      },
      select: { id: true, campaignName: true, campaignCode: true, client: { select: { companyName: true } } },
      take: 4
    }),
    prisma.reservation.findMany({
      where: {
        ...(entityScoped ? { campaign: { is: { companyEntity: { in: selectedEntityValues } } } } : {}),
        OR: [{ id: contains }, { clientName: contains }, { campaignName: contains }, { location: { code: contains } }]
      },
      select: { id: true, status: true, clientName: true, campaignName: true, location: { select: { code: true } } },
      take: 4
    }),
    entityScoped
      ? Promise.resolve([])
      : prisma.location.findMany({
          where: { OR: [{ code: contains }, { address: contains }, { city: contains }] },
          select: { id: true, code: true, city: true, address: true },
          take: 4
        }),
    prisma.financialReceivable.findMany({
      where: {
        ...(entityScoped ? { companyCode: { in: scope.selectedEntityCodes } } : {}),
        OR: [{ invoiceNumber: contains }, { clientName: contains }, { companyName: contains }]
      },
      select: { id: true, invoiceNumber: true, clientName: true, currency: true },
      take: 4
    }),
    prisma.financialReceivablePayment.findMany({
      where: {
        ...(entityScoped ? { receivable: { is: { companyCode: { in: scope.selectedEntityCodes } } } } : {}),
        OR: [{ paymentReference: contains }, { receivable: { invoiceNumber: contains } }]
      },
      select: { id: true, paymentReference: true, receivable: { select: { id: true, invoiceNumber: true, clientName: true } } },
      take: 4
    }),
    entityScoped
      ? Promise.resolve([])
      : prisma.crmCompany.findMany({
          where: { OR: [{ name: contains }, { taxId: contains }] },
          select: { id: true, name: true, taxId: true },
          take: 4
        }),
    entityScoped
      ? Promise.resolve([])
      : prisma.crmOpportunity.findMany({
          where: { OR: [{ name: contains }, { company: { name: contains } }] },
          select: { id: true, name: true, stage: true, company: { select: { name: true } } },
          take: 4
        }),
    entityScoped
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: { active: true, OR: [{ name: contains }, { email: contains }] },
          select: { id: true, name: true, role: true },
          take: 4
        }),
    prisma.operationTask.findMany({
      where: {
        ...(entityScoped ? {
          OR: [
            { campaign: { is: { companyEntity: { in: selectedEntityValues } } } },
            { reservation: { is: { campaign: { is: { companyEntity: { in: selectedEntityValues } } } } } }
          ],
          AND: [{ OR: [{ id: contains }, { notes: contains }, { location: { code: contains } }, { campaign: { campaignName: contains } }] }]
        } : {
          OR: [{ id: contains }, { notes: contains }, { location: { code: contains } }, { campaign: { campaignName: contains } }]
        })
      },
      select: { id: true, kind: true, status: true, location: { select: { code: true } } },
      take: 4
    }),
    entityScoped
      ? Promise.resolve([])
      : prisma.clientDocument.findMany({
          where: { status: "active", OR: [{ fileName: contains }, { documentType: contains }] },
          select: {
            id: true,
            fileName: true,
            documentType: true,
            clientId: true,
            campaignId: true,
            reservationId: true
          },
          take: 4
        })
  ]);

  const items: ExecutiveSearchResult[] = [
    ...clients.map((row) => result(row.id, "CLIENT", row.companyName, row.taxId || "Client", `/admin/clienti?clientId=${row.id}`)),
    ...campaigns.map((row) => result(row.id, "CAMPAIGN", row.campaignName, `${row.client.companyName}${row.campaignCode ? ` · ${row.campaignCode}` : ""}`, `/admin/campanii?campaignId=${row.id}`)),
    ...reservations.map((row) => result(row.id, "RESERVATION", `${row.location.code} · ${row.clientName}`, `${row.status} · ${row.campaignName || "Fără campanie"}`, `/admin/locatii?reservationId=${row.id}`)),
    ...locations.map((row) => result(row.id, "LOCATION", row.code, [row.city, row.address].filter(Boolean).join(" · "), `/admin/locatii?locationId=${row.id}`)),
    ...invoices.map((row) => result(row.id, "INVOICE", row.invoiceNumber || "Factură fără număr", `${row.clientName || "Client"} · ${row.currency || ""}`, `/admin/financiar/incasari?q=${encodeURIComponent(row.invoiceNumber || row.id)}`)),
    ...payments.map((row) => result(row.id, "PAYMENT", row.paymentReference || "Încasare", `${row.receivable.clientName || "Client"} · ${row.receivable.invoiceNumber || "factură"}`, `/admin/financiar/incasari?tab=payments&q=${encodeURIComponent(row.paymentReference || row.receivable.invoiceNumber || row.id)}`)),
    ...crmCompanies.map((row) => result(row.id, "CRM", row.name, row.taxId || "Companie CRM", `/admin/crm?view=companies&q=${encodeURIComponent(row.name)}`)),
    ...opportunities.map((row) => result(row.id, "CRM", row.name, `${row.company.name} · ${row.stage}`, `/admin/crm?view=pipeline&opportunityId=${row.id}`)),
    ...users.map((row) => result(row.id, "USER", row.name, ROLE_LABELS[row.role as UserRole], `/admin/utilizatori?userId=${row.id}`)),
    ...tasks.map((row) => result(row.id, "TASK", `${row.location?.code || "Task"} · ${row.kind}`, row.status, `/admin/operational?taskId=${row.id}`)),
    ...documents.map((row) => result(row.id, row.documentType === "contract" ? "CONTRACT" : "DOCUMENT", row.fileName, row.documentType, documentHref(row)))
  ];

  return {
    kind: "executive-search",
    query,
    items,
    truncated: items.length >= 40
  };
}

function refinementMeta(now: Date): ExecutiveRefinementMeta {
  return {
    asOf: now.toISOString(),
    staleAt: new Date(now.getTime() + EXECUTIVE_REVALIDATE_SECONDS * 1000).toISOString(),
    stale: false,
    contractVersion: EXECUTIVE_REFINEMENT_CONTRACT_VERSION,
    source: "CANONICAL_LIVE"
  };
}

function opportunityAmounts(rows: Array<{
  currency: string | null;
  quotedValue: Prisma.Decimal | null;
  revisedValue: Prisma.Decimal | null;
  agreedValue: Prisma.Decimal | null;
}>) {
  return amountGroups(rows.map((row) => ({
    entityCode: "UNKNOWN" as const,
    currency: row.currency || "NECUNOSCUT",
    amount: row.agreedValue || row.revisedValue || row.quotedValue || new Prisma.Decimal(0)
  })));
}

function campaignAmounts(rows: Array<{
  companyEntity: string | null;
  currency: string | null;
  totalContractValue: Prisma.Decimal | null;
}>) {
  return amountGroups(rows
    .filter((row) => row.totalContractValue != null)
    .map((row) => ({
      entityCode: knownEntityCodeForValue(row.companyEntity),
      currency: row.currency || "NECUNOSCUT",
      amount: row.totalContractValue || new Prisma.Decimal(0)
    })));
}

function receivableAmounts(rows: Array<{
  companyCode: string | null;
  currency: string | null;
  remainingAmount: Prisma.Decimal | null;
}>) {
  return amountGroups(rows.map((row) => ({
    entityCode: knownEntityCode(row.companyCode),
    currency: row.currency || "NECUNOSCUT",
    amount: row.remainingAmount || new Prisma.Decimal(0)
  })));
}

function amountGroups(rows: Array<{
  entityCode: ExecutiveEntityCode | "UNKNOWN";
  currency: string;
  amount: Prisma.Decimal;
}>): ExecutiveAmount[] {
  const groups = new Map<string, ExecutiveAmount & { decimal: Prisma.Decimal }>();
  for (const row of rows) {
    const key = `${row.entityCode}|${row.currency}`;
    const current = groups.get(key) || {
      entityCode: row.entityCode,
      currency: row.currency,
      amount: "0.00",
      count: 0,
      decimal: new Prisma.Decimal(0)
    };
    current.decimal = current.decimal.add(row.amount);
    current.amount = current.decimal.toFixed(2);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((left, right) => left.entityCode.localeCompare(right.entityCode) || left.currency.localeCompare(right.currency))
    .map(({ decimal: _decimal, ...row }) => row);
}

function knownEntityCode(value: string | null): ExecutiveEntityCode | "UNKNOWN" {
  return ["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"].includes(value || "")
    ? value as ExecutiveEntityCode
    : "UNKNOWN";
}

function knownEntityCodeForValue(value: string | null | undefined): ExecutiveEntityCode | "UNKNOWN" {
  const match = (["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"] as ExecutiveEntityCode[])
    .find((code) => entityValueForCode(code) === value);
  return match || "UNKNOWN";
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    result.set(value, (result.get(value) || 0) + 1);
  }
  return result;
}

function latestDate(values: Date[]) {
  return values.length ? values.reduce((latest, value) => value > latest ? value : latest) : null;
}

function addIssue(issues: ExecutivePerson["issues"], code: string, label: string, count: number, href: string) {
  if (count > 0) issues.push({ code, label, count, href });
}

function factualWorkload(input: {
  openTasks: number;
  campaignsManaged: number;
  overdueTasks: number;
  overdueInvoices: number;
  overdueActions: number;
  entityScoped: boolean;
}): ExecutivePerson["workload"] {
  const explanation = [
    countLabel(input.campaignsManaged, "campanie gestionată", "campanii gestionate"),
    countLabel(input.openTasks, "task deschis", "taskuri deschise"),
    countLabel(input.overdueTasks, "task restant", "taskuri restante"),
    countLabel(input.overdueInvoices, "factură restantă", "facturi restante"),
    ...(input.entityScoped ? [] : [countLabel(input.overdueActions, "follow-up restant", "follow-up-uri restante")])
  ];
  const high = input.overdueTasks > 0 ||
    input.overdueInvoices > 2 ||
    input.overdueActions > 3 ||
    input.openTasks >= 10 ||
    input.campaignsManaged >= 10;
  const hasEvidence = input.openTasks > 0 ||
    input.campaignsManaged > 0 ||
    input.overdueTasks > 0 ||
    input.overdueInvoices > 0 ||
    (!input.entityScoped && input.overdueActions > 0);

  return {
    level: high ? "HIGH" : hasEvidence ? "NORMAL" : "UNDETERMINED",
    explanation
  };
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function departmentForRole(role: UserRole) {
  if (["SALES_AGENT", "SALES_DIRECTOR"].includes(role)) return "Comercial";
  if (role === "FINANCE_OPERATOR") return "Financiar";
  if (role === "FIELD_OPERATOR") return "Operațional";
  return "Management";
}

function money(value: Prisma.Decimal) {
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.toNumber());
}

function result(
  id: string,
  entity: ExecutiveSearchResult["entity"],
  label: string,
  context: string,
  href: string
): ExecutiveSearchResult {
  return { id, entity, label, context, href };
}

function documentHref(row: { clientId: string | null; campaignId: string | null; reservationId: string | null }) {
  if (row.campaignId) return `/admin/campanii?campaignId=${row.campaignId}&tab=documents`;
  if (row.clientId) return `/admin/clienti?clientId=${row.clientId}&tab=documents`;
  if (row.reservationId) return `/admin/locatii?reservationId=${row.reservationId}`;
  return "/admin/dashboard";
}
