import { prisma } from "../src/lib/prisma";
import { deriveCampaignEffectiveStatus } from "../src/lib/campaigns/campaign-effective-status";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    select: { id: true, status: true, archivedAt: true, startDate: true, endDate: true },
    orderBy: { id: "asc" },
    take: 10000
  });
  const rows = campaigns.map((campaign) => {
    const decision = deriveCampaignEffectiveStatus(campaign);
    return { id: campaign.id, storedStatus: campaign.status, effectiveStatus: decision.effectiveStatus, reason: decision.reason };
  });
  const mismatches = rows.filter((row) => row.storedStatus.toUpperCase() !== row.effectiveStatus);
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    result[row.effectiveStatus] = (result[row.effectiveStatus] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({ readOnly: true, total: rows.length, mismatchCount: mismatches.length, counts, examples: mismatches.slice(0, 25) }, null, 2));
}

main().finally(() => prisma.$disconnect());
