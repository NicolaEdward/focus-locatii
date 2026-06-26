import { PrismaClient } from "@prisma/client";
import {
  buildOperationTaskBackfillPlan,
  writeOperationTaskBackfill,
  type OperationTaskBackfillReservation
} from "../src/lib/operation-task-backfill";

const prisma = new PrismaClient();

type CliOptions = {
  write: boolean;
  dryRun: boolean;
  json: boolean;
  batchSize: number;
  limit: number | null;
  help: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.write && options.dryRun) {
    throw new Error("Use either --write or --dry-run, not both.");
  }

  const reservations = await loadReservations(options);
  const existing = await loadExistingOperationTaskDedupeKeys();

  if (options.write && !existing.accessible) {
    throw new Error(`OperationTask table is not accessible; refusing to write. ${existing.error || ""}`.trim());
  }

  const plan = buildOperationTaskBackfillPlan(reservations, {
    existingDedupeKeys: existing.dedupeKeys,
    alreadyExistingOperationTaskCount: existing.count,
    operationTaskTableAccessible: existing.accessible,
    operationTaskTableError: existing.error,
    sampleLimit: 12
  });

  const writeResult = options.write
    ? await writeOperationTaskBackfill(plan.createableDrafts, prisma.operationTask)
    : null;

  const payload = {
    ok: true,
    mode: options.write ? "write" : "dry-run",
    dryRun: !options.write,
    writeModeRequiresExplicitFlag: true,
    batchSize: options.batchSize,
    limit: options.limit,
    report: plan.report,
    writeResult
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport(payload);
  }
}

async function loadReservations(options: CliOptions): Promise<OperationTaskBackfillReservation[]> {
  const reservations: OperationTaskBackfillReservation[] = [];
  let cursor: string | null = null;

  while (true) {
    const remaining = options.limit == null ? options.batchSize : options.limit - reservations.length;
    if (remaining <= 0) break;
    const take = Math.min(options.batchSize, remaining);
    const batch: OperationTaskBackfillReservation[] = await prisma.reservation.findMany({
      select: {
        id: true,
        clientId: true,
        campaignId: true,
        locationId: true,
        periodStart: true,
        periodEnd: true,
        installationDate: true,
        neutralizationDate: true,
        productionNotes: true
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    reservations.push(...batch);
    if (batch.length < take) break;
    cursor = batch[batch.length - 1]?.id || null;
    if (!cursor) break;
  }

  return reservations;
}

async function loadExistingOperationTaskDedupeKeys() {
  try {
    const rows = await prisma.operationTask.findMany({
      select: { dedupeKey: true }
    });
    return {
      accessible: true,
      count: rows.length,
      dedupeKeys: new Set(rows.map((row) => row.dedupeKey).filter(Boolean) as string[]),
      error: null as string | null
    };
  } catch (error) {
    return {
      accessible: false,
      count: null,
      dedupeKeys: new Set<string>(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    write: false,
    dryRun: false,
    json: false,
    batchSize: 500,
    limit: null,
    help: false
  };

  for (const arg of args) {
    if (arg === "--") continue;
    else if (arg === "--write") options.write = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--batch-size=")) options.batchSize = positiveInt(arg, "--batch-size");
    else if (arg.startsWith("--limit=")) options.limit = positiveInt(arg, "--limit");
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function positiveInt(arg: string, flag: string) {
  const value = Number(arg.slice(flag.length + 1));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

function printHumanReport(payload: {
  mode: string;
  dryRun: boolean;
  batchSize: number;
  limit: number | null;
  report: ReturnType<typeof buildOperationTaskBackfillPlan>["report"];
  writeResult: Awaited<ReturnType<typeof writeOperationTaskBackfill>> | null;
}) {
  const { report } = payload;
  console.log(`OperationTask backfill ${payload.mode}`);
  console.log(`Dry-run: ${payload.dryRun ? "yes" : "no"}`);
  console.log(`Reservations scanned: ${report.reservationsScanned}`);
  console.log(`OperationTask table accessible: ${report.operationTaskTableAccessible ? "yes" : "no"}`);
  if (report.operationTaskTableError) console.log(`OperationTask table error: ${report.operationTaskTableError}`);
  console.log(`Existing OperationTask rows: ${report.alreadyExistingOperationTaskCount ?? "unknown"}`);
  console.log(`Derived tasks: ${report.derivedTaskCount}`);
  console.log(`Would create: ${report.wouldCreateCount}`);
  console.log(`Would skip existing: ${report.wouldSkipExistingCount}`);
  if (payload.writeResult) {
    console.log(`Write attempted: ${payload.writeResult.attempted}`);
    console.log(`Created: ${payload.writeResult.created}`);
    console.log(`Skipped by dedupe: ${payload.writeResult.skipped}`);
  }
  console.log(`Tasks by kind: ${JSON.stringify(report.tasksByKind)}`);
  console.log(`Tasks by status: ${JSON.stringify(report.tasksByStatus)}`);
  console.log(`Duplicate dedupe keys: ${report.duplicateDedupeKeysFound}`);
  console.log(`Corrupted productionNotes: ${report.corruptedProductionNotesCount}`);
  console.log(`Ambiguous legacy tasks/statuses: ${report.ambiguousLegacyTaskCount}`);
  console.log(`Missing dates: ${report.missingDateCount}`);
  console.log(`Missing links: ${JSON.stringify({
    reservation: report.missingReservationLinkCount,
    client: report.missingClientLinkCount,
    campaign: report.missingCampaignLinkCount,
    location: report.missingLocationLinkCount
  })}`);
  console.log(`Comparison: ${JSON.stringify(report.comparison)}`);
  if (report.warnings.length) {
    console.log("Warnings:");
    for (const warning of report.warnings) {
      console.log(`- ${warning.code}${warning.reservationId ? ` reservation=${warning.reservationId}` : ""}: ${warning.message}`);
    }
  }
}

function printHelp() {
  console.log(`
Usage: pnpm run backfill:operation-tasks -- [options]

Defaults to dry-run. No OperationTask rows are written unless --write is passed.

Options:
  --dry-run             Report only. This is the default.
  --write               Write missing OperationTask rows using dedupeKey and skipDuplicates.
  --batch-size=<n>      Reservation batch size. Default: 500.
  --limit=<n>           Limit reservations scanned.
  --json                Print JSON report.
  --help                Show this help text.
`.trim());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
