export type ObservabilityBudgetKey =
  | "executive_overview_api"
  | "admin_locations_html"
  | "admin_clients_html"
  | "admin_receivables_html"
  | "selector_availability_api"
  | "public_locations_api";

export type PerformanceMeasurement = {
  durationMs?: number | null;
  payloadBytes?: number | null;
  queryCount?: number | null;
  slowQueryCount?: number | null;
};

type PerformanceLimit = {
  warning: number;
  severe: number;
};

export type PerformanceBudget = {
  route: string;
  durationMs: PerformanceLimit;
  payloadBytes: PerformanceLimit;
  queryCount: PerformanceLimit;
  slowQueryCount: PerformanceLimit;
};

export type BudgetViolation = {
  metric: keyof PerformanceMeasurement;
  severity: "warning" | "severe";
  actual: number;
  limit: number;
};

// Initial limits intentionally leave headroom above the July 2026 preview baseline.
// Warning logs support tuning; only the severe threshold fails the release gate.
export const OBSERVABILITY_BUDGETS: Record<ObservabilityBudgetKey, PerformanceBudget> = {
  executive_overview_api: {
    route: "/api/admin/executive/overview",
    durationMs: { warning: 1_000, severe: 2_000 },
    payloadBytes: { warning: 100_000, severe: 200_000 },
    queryCount: { warning: 15, severe: 30 },
    slowQueryCount: { warning: 1, severe: 3 }
  },
  admin_locations_html: {
    route: "/admin/locatii",
    durationMs: { warning: 1_500, severe: 3_000 },
    payloadBytes: { warning: 250_000, severe: 500_000 },
    queryCount: { warning: 30, severe: 60 },
    slowQueryCount: { warning: 2, severe: 5 }
  },
  admin_clients_html: {
    route: "/admin/clienti",
    durationMs: { warning: 1_500, severe: 3_000 },
    payloadBytes: { warning: 250_000, severe: 500_000 },
    queryCount: { warning: 25, severe: 50 },
    slowQueryCount: { warning: 2, severe: 5 }
  },
  admin_receivables_html: {
    route: "/admin/financiar/incasari",
    durationMs: { warning: 1_500, severe: 3_000 },
    payloadBytes: { warning: 250_000, severe: 500_000 },
    queryCount: { warning: 25, severe: 50 },
    slowQueryCount: { warning: 2, severe: 5 }
  },
  selector_availability_api: {
    route: "/api/admin/location-selection/availability",
    durationMs: { warning: 900, severe: 2_000 },
    payloadBytes: { warning: 1_000_000, severe: 2_000_000 },
    queryCount: { warning: 10, severe: 20 },
    slowQueryCount: { warning: 1, severe: 3 }
  },
  public_locations_api: {
    route: "/api/locations",
    durationMs: { warning: 700, severe: 1_500 },
    payloadBytes: { warning: 250_000, severe: 500_000 },
    queryCount: { warning: 6, severe: 12 },
    slowQueryCount: { warning: 1, severe: 3 }
  }
};

export function evaluatePerformanceBudget(
  key: ObservabilityBudgetKey,
  measurement: PerformanceMeasurement
): BudgetViolation[] {
  const budget = OBSERVABILITY_BUDGETS[key];
  const violations: BudgetViolation[] = [];
  for (const metric of ["durationMs", "payloadBytes", "queryCount", "slowQueryCount"] as const) {
    const actual = measurement[metric];
    if (actual == null || !Number.isFinite(actual)) continue;
    const limit = budget[metric];
    if (actual > limit.severe) {
      violations.push({ metric, severity: "severe", actual, limit: limit.severe });
    } else if (actual > limit.warning) {
      violations.push({ metric, severity: "warning", actual, limit: limit.warning });
    }
  }
  return violations;
}

export function slowQueryThresholdMs() {
  const configured = Number(process.env.PRISMA_SLOW_QUERY_MS || 500);
  return Number.isFinite(configured) && configured >= 50 ? Math.round(configured) : 500;
}
