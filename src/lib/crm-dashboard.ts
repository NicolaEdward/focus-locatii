import {
  CRM_STATUS_OPTIONS,
  crmStageAgeDays,
  crmStageIsStalled,
  isActiveCrmStatus,
  monthlyCrmOutcomes,
  normalizeCrmStatus,
  summarizeCrmLeads
} from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export type CrmTeamDashboardData = Awaited<ReturnType<typeof getCrmTeamDashboardData>>;

export async function getCrmTeamDashboardData(now = new Date()) {
  const lastSevenDays = addDays(now, -7);
  const lastThirtyDays = addDays(now, -30);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [sellers, leads, activities7, activities30, outcomeEvents] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, role: { in: ["SALES_AGENT", "SALES_DIRECTOR"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" }
    }),
    prisma.crmLead.findMany({
      select: {
        id: true,
        companyName: true,
        status: true,
        assignedToUserId: true,
        nextFollowUpDate: true,
        estimatedValue: true,
        currency: true,
        forecastCategory: true,
        expectedCloseDate: true,
        stageChangedAt: true,
        firstContactedAt: true,
        qualifiedAt: true,
        lastActivityAt: true,
        qualificationData: true,
        noResponseCount: true,
        updatedAt: true
      }
    }),
    prisma.crmActivity.groupBy({
      by: ["userId"],
      where: { userId: { not: null }, activityDate: { gte: lastSevenDays } },
      _count: { _all: true }
    }),
    prisma.crmActivity.groupBy({
      by: ["userId"],
      where: { userId: { not: null }, activityDate: { gte: lastThirtyDays } },
      _count: { _all: true }
    }),
    prisma.crmActivity.findMany({
      where: {
        activityDate: { gte: monthStart, lte: now },
        statusAtTime: { in: ["won", "account_management", "lost"] }
      },
      select: { leadId: true, statusAtTime: true, activityDate: true },
      orderBy: { activityDate: "asc" },
      take: 5000
    })
  ]);

  const summary = {
    ...summarizeCrmLeads(leads, now),
    ...monthlyCrmOutcomes(outcomeEvents, now)
  };
  const statusBreakdown = CRM_STATUS_OPTIONS.map((option) => ({
    status: option.value,
    label: option.label,
    count: leads.filter((lead) => normalizeCrmStatus(lead.status) === option.value).length
  })).filter((row) => row.count > 0);

  const sellerRows = sellers.map((seller) => {
    const ownLeads = leads.filter((lead) => lead.assignedToUserId === seller.id);
    const ownSummary = summarizeCrmLeads(ownLeads, now);
    const won = ownLeads.filter((lead) => normalizeCrmStatus(lead.status) === "won").length;
    const lost = ownLeads.filter((lead) => normalizeCrmStatus(lead.status) === "lost").length;
    const active = ownLeads.filter((lead) => isActiveCrmStatus(lead.status));
    const contacted = ownLeads.filter((lead) => Boolean(lead.firstContactedAt)).length;
    const qualified = ownLeads.filter((lead) => Boolean(lead.qualifiedAt)).length;
    return {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      activeLeads: ownSummary.active,
      overdue: ownSummary.overdue,
      dueToday: ownSummary.dueToday,
      missingNextStep: ownSummary.missingNextStep,
      dormant: ownSummary.dormant,
      stalled: active.filter((lead) => crmStageIsStalled(lead, now)).length,
      noResponseAttention: active.filter((lead) => lead.noResponseCount >= 3).length,
      averageStageAgeDays: active.length
        ? Math.round(active.reduce((sum, lead) => sum + crmStageAgeDays(lead.stageChangedAt, now), 0) / active.length)
        : 0,
      pipelineByCurrency: ownSummary.pipelineByCurrency,
      bestCaseByCurrency: ownSummary.bestCaseByCurrency,
      commitByCurrency: ownSummary.commitByCurrency,
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
    unassigned: leads.filter((lead) => !lead.assignedToUserId).length,
    activities7Days: activities7.reduce((sum, row) => sum + row._count._all, 0),
    activities30Days: activities30.reduce((sum, row) => sum + row._count._all, 0)
  };
}

function activityCount(rows: Array<{ userId: string | null; _count: { _all: number } }>, userId: string) {
  return rows.find((row) => row.userId === userId)?._count._all || 0;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}
