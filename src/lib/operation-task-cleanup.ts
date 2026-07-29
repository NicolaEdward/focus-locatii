const DAY_MS = 24 * 60 * 60 * 1000;

export const STALE_DECORATION_MIN_AGE_DAYS = 180;
export const STALE_DECORATION_LATE_MATERIALIZATION_DAYS = 90;

export type StaleDecorationTaskInput = {
  kind: string;
  status: string;
  source: string;
  scheduledFor: Date | null;
  completedAt: Date | null;
  assignedToUserId: string | null;
  createdAt: Date;
  activeProofCount: number;
};

export type StaleDecorationTaskDecision = {
  eligible: boolean;
  reason:
    | "ELIGIBLE_RETROACTIVE_STALE_DECORATION"
    | "NOT_DECORATION"
    | "NOT_NEW"
    | "NOT_SYSTEM_DERIVED"
    | "MISSING_SCHEDULE"
    | "NOT_OLD_ENOUGH"
    | "NOT_RETROACTIVE"
    | "ALREADY_COMPLETED"
    | "ASSIGNED"
    | "HAS_ACTIVE_PROOF";
  ageDays: number | null;
  materializedAfterDays: number | null;
};

export function staleDecorationTaskDecision(
  task: StaleDecorationTaskInput,
  now = new Date()
): StaleDecorationTaskDecision {
  const base = {
    ageDays: task.scheduledFor ? wholeDaysBetween(task.scheduledFor, now) : null,
    materializedAfterDays: task.scheduledFor
      ? wholeDaysBetween(task.scheduledFor, task.createdAt)
      : null
  };

  if (!["DECORATION", "REDECORATION"].includes(task.kind)) {
    return { eligible: false, reason: "NOT_DECORATION", ...base };
  }
  if (task.status !== "NEW") return { eligible: false, reason: "NOT_NEW", ...base };
  if (task.source !== "SYSTEM_DERIVED") {
    return { eligible: false, reason: "NOT_SYSTEM_DERIVED", ...base };
  }
  if (!task.scheduledFor) return { eligible: false, reason: "MISSING_SCHEDULE", ...base };
  if ((base.ageDays ?? 0) < STALE_DECORATION_MIN_AGE_DAYS) {
    return { eligible: false, reason: "NOT_OLD_ENOUGH", ...base };
  }
  if ((base.materializedAfterDays ?? 0) < STALE_DECORATION_LATE_MATERIALIZATION_DAYS) {
    return { eligible: false, reason: "NOT_RETROACTIVE", ...base };
  }
  if (task.completedAt) return { eligible: false, reason: "ALREADY_COMPLETED", ...base };
  if (task.assignedToUserId) return { eligible: false, reason: "ASSIGNED", ...base };
  if (task.activeProofCount > 0) return { eligible: false, reason: "HAS_ACTIVE_PROOF", ...base };

  return {
    eligible: true,
    reason: "ELIGIBLE_RETROACTIVE_STALE_DECORATION",
    ...base
  };
}

function wholeDaysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}
