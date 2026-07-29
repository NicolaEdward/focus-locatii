import crypto from "node:crypto";
import { loadEnvFile, databaseIdentity } from "./release/env-utils";

loadEnvFile(process.env.ENV_FILE || ".env");

const apply = process.argv.includes("--apply");
const confirmCount = numberArgument("--confirm-count");
const reason =
  stringArgument("--reason") ||
  "Task de decorare retroactiv, nealocat si fara dovada, iesit din relevanta operationala.";

async function main() {
  const [{ prisma }, cleanup] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/operation-task-cleanup")
  ]);
  const now = new Date();

  try {
    const candidates = await prisma.operationTask.findMany({
      where: {
        kind: { in: ["DECORATION", "REDECORATION"] },
        status: "NEW",
        source: "SYSTEM_DERIVED",
        scheduledFor: {
          not: null,
          lte: new Date(
            now.getTime() - cleanup.STALE_DECORATION_MIN_AGE_DAYS * 24 * 60 * 60 * 1000
          )
        },
        completedAt: null,
        assignedToUserId: null
      },
      select: {
        id: true,
        reservationId: true,
        campaignId: true,
        locationId: true,
        kind: true,
        status: true,
        source: true,
        scheduledFor: true,
        completedAt: true,
        assignedToUserId: true,
        createdAt: true,
        reservation: {
          select: {
            documents: {
              where: {
                documentType: "operational_proof_photo",
                status: "active"
              },
              select: { id: true },
              take: 1
            }
          }
        }
      },
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }]
    });

    const evaluated = candidates.map((task) => {
      const decision = cleanup.staleDecorationTaskDecision(
        {
          ...task,
          activeProofCount: task.reservation?.documents.length || 0
        },
        now
      );
      return { task, decision };
    });
    const eligible = evaluated.filter((item) => item.decision.eligible);
    const ids = eligible.map((item) => item.task.id).sort();
    const batchId = `stale-decoration-${crypto
      .createHash("sha256")
      .update(JSON.stringify({ ids, reason }))
      .digest("hex")
      .slice(0, 16)}`;

    const report = {
      mode: apply ? "apply" : "dry-run",
      database: databaseIdentity(),
      evaluatedAt: now.toISOString(),
      policy: {
        minimumAgeDays: cleanup.STALE_DECORATION_MIN_AGE_DAYS,
        minimumLateMaterializationDays:
          cleanup.STALE_DECORATION_LATE_MATERIALIZATION_DAYS,
        requiredStatus: "NEW",
        requiredSource: "SYSTEM_DERIVED",
        requiresUnassigned: true,
        requiresNoActiveProof: true,
        action: "ARCHIVE_NOT_DELETE"
      },
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      excludedCount: evaluated.length - eligible.length,
      batchId,
      eligible: eligible.map(({ task, decision }) => ({
        id: task.id,
        reservationId: task.reservationId,
        campaignId: task.campaignId,
        locationId: task.locationId,
        kind: task.kind,
        scheduledFor: task.scheduledFor?.toISOString() || null,
        createdAt: task.createdAt.toISOString(),
        ageDays: decision.ageDays,
        materializedAfterDays: decision.materializedAfterDays
      })),
      excludedByReason: countBy(
        evaluated.filter((item) => !item.decision.eligible),
        (item) => item.decision.reason
      )
    };

    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (confirmCount === null) {
      throw new Error("--apply requires --confirm-count=<exact dry-run count>.");
    }
    if (confirmCount !== eligible.length) {
      throw new Error(
        `Safety stop: confirmed ${confirmCount}, but the current eligible count is ${eligible.length}.`
      );
    }
    if (!eligible.length) {
      console.log(JSON.stringify({ ...report, archivedCount: 0 }, null, 2));
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        for (const { task, decision } of eligible) {
          const archived = await tx.operationTask.updateMany({
            where: {
              id: task.id,
              status: "NEW",
              source: "SYSTEM_DERIVED",
              assignedToUserId: null,
              completedAt: null
            },
            data: { status: "ARCHIVED" }
          });
          if (archived.count !== 1) {
            throw new Error(`Safety stop: task ${task.id} changed after dry-run.`);
          }

          await tx.auditLog.create({
            data: {
              userId: null,
              action: "operation_task.stale_decoration_archived",
              entityType: "OperationTask",
              entityId: task.id,
              metadata: {
                batchId,
                reason,
                before: { status: task.status },
                after: { status: "ARCHIVED" },
                scheduledFor: task.scheduledFor?.toISOString() || null,
                createdAt: task.createdAt.toISOString(),
                ageDays: decision.ageDays,
                materializedAfterDays: decision.materializedAfterDays,
                reservationId: task.reservationId,
                campaignId: task.campaignId,
                locationId: task.locationId
              }
            }
          });
        }
      },
      { maxWait: 5_000, timeout: 30_000 }
    );

    console.log(
      JSON.stringify(
        {
          ...report,
          archivedCount: eligible.length,
          auditAction: "operation_task.stale_decoration_archived"
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

function stringArgument(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function numberArgument(name: string) {
  const raw = stringArgument(name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function countBy<T>(rows: T[], key: (row: T) => string) {
  return rows.reduce<Record<string, number>>((result, row) => {
    const value = key(row);
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
