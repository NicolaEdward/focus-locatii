import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  deriveCampaignCommercialSummary,
  syncCampaignCommercialSummary
} from "../src/lib/campaigns/campaign-commercial-summary";

const apply = process.argv.includes("--apply");
const backupOut = argumentValue("--backup-out");
const restoreFrom = argumentValue("--restore");

async function main() {
  if (restoreFrom) {
    await restoreCampaignSnapshots(restoreFrom);
    return;
  }
  if (apply && !backupOut) {
    throw new Error("--apply necesita --backup-out=<fisier.json> pentru rollback.");
  }

  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      startDate: true,
      endDate: true,
      currency: true,
      totalContractValue: true,
      reservations: {
        where: { status: "BOOKED" },
        select: {
          status: true,
          periodStart: true,
          periodEnd: true,
          amount: true,
          monthlyRentShare: true,
          monthlyRentTotal: true,
          contractGroupId: true,
          currency: true
        }
      }
    },
    orderBy: { id: "asc" }
  });

  const changes = campaigns.flatMap((campaign) => {
    const summary = deriveCampaignCommercialSummary(campaign.reservations);
    const before = {
      startDate: dateKey(campaign.startDate),
      endDate: dateKey(campaign.endDate),
      currency: campaign.currency,
      totalContractValue: campaign.totalContractValue?.toNumber() ?? null
    };
    const after = {
      startDate: dateKey(summary.periodStart),
      endDate: dateKey(summary.periodEnd),
      currency: summary.currency,
      totalContractValue: summary.totalContractValue
    };
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [{
          campaignId: campaign.id,
          before,
          after,
          bookedReservationCount: summary.bookedReservationCount,
          dataQualityReasons: summary.dataQualityReasons
        }];
  });

  if (apply && backupOut) {
    const backupPath = path.resolve(backupOut);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, `${JSON.stringify({
      version: 1,
      capturedAt: new Date().toISOString(),
      campaigns: changes.map((change) => ({
        campaignId: change.campaignId,
        ...change.before
      }))
    }, null, 2)}\n`, "utf8");
  }

  if (apply) {
    for (const change of changes) {
      await prisma.$transaction((tx) => syncCampaignCommercialSummary(tx, change.campaignId));
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    campaigns: campaigns.length,
    unchanged: campaigns.length - changes.length,
    changed: changes.length,
    applied: apply ? changes.length : 0,
    backupOut: apply ? path.resolve(backupOut!) : null,
    samples: changes.slice(0, 25)
  }, null, 2));
}

async function restoreCampaignSnapshots(fileName: string) {
  if (apply) throw new Error("--restore si --apply nu pot fi folosite impreuna.");
  const filePath = path.resolve(fileName);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    version?: number;
    campaigns?: Array<{
      campaignId?: string;
      startDate?: string | null;
      endDate?: string | null;
      currency?: string | null;
      totalContractValue?: number | null;
    }>;
  };
  if (parsed.version !== 1 || !Array.isArray(parsed.campaigns) || !parsed.campaigns.length) {
    throw new Error("Backup-ul campaniilor este invalid sau gol.");
  }
  await prisma.$transaction(async (tx) => {
    for (const snapshot of parsed.campaigns!) {
      if (!snapshot.campaignId) throw new Error("Backup-ul contine un campaignId invalid.");
      await tx.campaign.update({
        where: { id: snapshot.campaignId },
        data: {
          startDate: snapshot.startDate ? new Date(`${snapshot.startDate}T00:00:00.000Z`) : null,
          endDate: snapshot.endDate ? new Date(`${snapshot.endDate}T00:00:00.000Z`) : null,
          currency: snapshot.currency || null,
          totalContractValue: snapshot.totalContractValue == null
            ? null
            : new Prisma.Decimal(snapshot.totalContractValue)
        }
      });
    }
  });
  console.log(JSON.stringify({
    mode: "restore",
    restored: parsed.campaigns.length,
    backup: filePath
  }, null, 2));
}

function argumentValue(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function dateKey(value: Date | null) {
  return value?.toISOString().slice(0, 10) || null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
