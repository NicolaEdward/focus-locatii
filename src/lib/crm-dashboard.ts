import { crmDaysBetween, crmOpportunityTotals } from "@/lib/crm-analytics-v4";
import { CRM_OPPORTUNITY_STAGE_OPTIONS, CRM_PROSPECT_STATUS_OPTIONS } from "@/lib/crm-domain";
import { prisma } from "@/lib/prisma";

export type CrmTeamDashboardData = Awaited<ReturnType<typeof getCrmTeamDashboardData>>;

export async function getCrmTeamDashboardData(now = new Date()) {
  const lastSevenDays = addDays(now, -7);
  const lastThirtyDays = addDays(now, -30);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const activeProspectStatuses = ["prospecting", "qualified"];
  const activeOpportunityStages = ["opportunity", "quoted", "negotiation", "contracting"];
  const [sellers, prospects, opportunities, actions, activities7, activities30] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" }
    }),
    prisma.crmProspect.findMany({
      select: { id: true, ownerId: true, status: true, contactState: true, qualifiedAt: true, createdAt: true, updatedAt: true, nextActions: { where: { status: "open" }, select: { dueAt: true }, take: 1 }, opportunities: { where: { stage: { in: ["opportunity", "quoted", "negotiation", "contracting", "on_hold"] } }, select: { id: true }, take: 1 } },
      take: 30_000
    }),
    prisma.crmOpportunity.findMany({
      select: { id: true, ownerId: true, stage: true, currency: true, quotedValue: true, revisedValue: true, agreedValue: true, decisionDate: true, wonAt: true, lostAt: true, createdAt: true, updatedAt: true, nextActions: { where: { status: "open" }, select: { dueAt: true }, take: 1 } },
      take: 20_000
    }),
    prisma.crmNextAction.findMany({ where: { status: "open" }, select: { ownerId: true, dueAt: true }, take: 50_000 }),
    prisma.crmEvent.groupBy({ by: ["actorUserId"], where: { actorUserId: { not: null }, occurredAt: { gte: lastSevenDays } }, _count: { _all: true } }),
    prisma.crmEvent.groupBy({ by: ["actorUserId"], where: { actorUserId: { not: null }, occurredAt: { gte: lastThirtyDays } }, _count: { _all: true } })
  ]);

  const activeProspects = prospects.filter((row) => activeProspectStatuses.includes(row.status));
  const actionableProspects = activeProspects.filter((row) => row.status === "prospecting" || !row.opportunities.length);
  const activeOpportunities = opportunities.filter((row) => activeOpportunityStages.includes(row.stage));
  const activeRecords = [...activeProspects, ...activeOpportunities];
  const totals = crmOpportunityTotals(opportunities);
  const summary = {
    active: activeRecords.length,
    overdue: actions.filter((action) => action.dueAt < now).length,
    dueToday: actions.filter((action) => sameUtcDay(action.dueAt, now)).length,
    missingNextStep: [...actionableProspects, ...activeOpportunities].filter((row) => !row.nextActions.length).length,
    dormant: activeRecords.filter((row) => crmDaysBetween(row.updatedAt, now) >= 30).length,
    stalled: activeRecords.filter((row) => crmDaysBetween(row.updatedAt, now) >= 14).length,
    pipelineByCurrency: totals.pipeline,
    likelyByCurrency: totals.possible,
    bestCaseByCurrency: totals.possible,
    commitByCurrency: totals.commit,
    wonThisMonth: opportunities.filter((row) => row.stage === "won" && row.wonAt && row.wonAt >= monthStart).length,
    lostThisMonth: opportunities.filter((row) => row.stage === "lost" && row.lostAt && row.lostAt >= monthStart).length
  };
  const statusBreakdown = [
    ...CRM_PROSPECT_STATUS_OPTIONS.map((option) => ({ status: option.value, label: option.label, count: prospects.filter((row) => row.status === option.value).length })),
    ...CRM_OPPORTUNITY_STAGE_OPTIONS.map((option) => ({ status: option.value, label: option.label, count: opportunities.filter((row) => row.stage === option.value).length }))
  ].filter((row) => row.count > 0);

  const sellerRows = sellers.map((seller) => {
    const ownProspects = prospects.filter((row) => row.ownerId === seller.id);
    const ownOpportunities = opportunities.filter((row) => row.ownerId === seller.id);
    const ownActiveProspects = ownProspects.filter((row) => activeProspectStatuses.includes(row.status));
    const ownActionableProspects = ownActiveProspects.filter((row) => row.status === "prospecting" || !row.opportunities.length);
    const ownActiveOpportunities = ownOpportunities.filter((row) => activeOpportunityStages.includes(row.stage));
    const ownActive = [...ownActiveProspects, ...ownActiveOpportunities];
    const ownActions = actions.filter((row) => row.ownerId === seller.id);
    const ownTotals = crmOpportunityTotals(ownOpportunities);
    const won = ownOpportunities.filter((row) => row.stage === "won").length;
    const lost = ownOpportunities.filter((row) => row.stage === "lost").length;
    const qualified = ownProspects.filter((row) => Boolean(row.qualifiedAt)).length;
    const contacted = ownProspects.filter((row) => row.contactState !== "uncontacted" && row.contactState !== "contact_missing").length;
    return {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      activeLeads: ownActive.length,
      overdue: ownActions.filter((row) => row.dueAt < now).length,
      dueToday: ownActions.filter((row) => sameUtcDay(row.dueAt, now)).length,
      missingNextStep: [...ownActionableProspects, ...ownActiveOpportunities].filter((row) => !row.nextActions.length).length,
      dormant: ownActive.filter((row) => crmDaysBetween(row.updatedAt, now) >= 30).length,
      stalled: ownActive.filter((row) => crmDaysBetween(row.updatedAt, now) >= 14).length,
      noResponseAttention: ownProspects.filter((row) => row.contactState === "no_response").length,
      averageStageAgeDays: ownActive.length ? Math.round(ownActive.reduce((sum, row) => sum + crmDaysBetween(row.updatedAt, now), 0) / ownActive.length) : 0,
      pipelineByCurrency: ownTotals.pipeline,
      bestCaseByCurrency: ownTotals.possible,
      commitByCurrency: ownTotals.commit,
      activities7Days: activityCount(activities7, seller.id),
      activities30Days: activityCount(activities30, seller.id),
      qualificationRate: contacted ? Math.round((qualified / contacted) * 100) : null,
      contacted,
      qualified,
      conversionRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      won,
      lost
    };
  });

  return {
    summary,
    statusBreakdown,
    sellers: sellerRows,
    unassigned: [...prospects, ...opportunities].filter((row) => !row.ownerId).length,
    activities7Days: activities7.reduce((sum, row) => sum + row._count._all, 0),
    activities30Days: activities30.reduce((sum, row) => sum + row._count._all, 0)
  };
}

function activityCount(rows: Array<{ actorUserId: string | null; _count: { _all: number } }>, userId: string) {
  return rows.find((row) => row.actorUserId === userId)?._count._all || 0;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function sameUtcDay(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth() && left.getUTCDate() === right.getUTCDate();
}
