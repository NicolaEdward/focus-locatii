import { readFileSync } from "node:fs";
import {
  evaluatePerformanceBudget,
  OBSERVABILITY_BUDGETS,
  type ObservabilityBudgetKey
} from "../../src/lib/observability-budgets";

type Measurement = {
  budgetKey: ObservabilityBudgetKey;
  route: string;
  run: number;
  status: number;
  durationMs: number;
  payloadBytes: number;
  requestId: boolean;
};

const baseUrl = process.env.OBSERVABILITY_BASE_URL || process.env.PREVIEW_BASE_URL || "http://127.0.0.1:3000";
const email = process.env.OBSERVABILITY_TEST_EMAIL || "coo.preview@focusmedia.test";
const password = process.env.PREVIEW_TEST_PASSWORD || "";

async function main() {
  const cookie = password ? await login() : "";
  const measurements: Measurement[] = [];
  const targets: Array<{ key: ObservabilityBudgetKey; route: string; auth: boolean }> = [
    { key: "admin_locations_html", route: "/admin/locatii", auth: true },
    { key: "admin_clients_html", route: "/admin/clienti", auth: true },
    { key: "admin_receivables_html", route: "/admin/financiar/incasari", auth: true },
    { key: "public_locations_api", route: "/api/locations", auth: false }
  ];

  for (const target of targets) {
    if (target.auth && !cookie) continue;
    for (let run = 1; run <= 3; run += 1) {
      measurements.push(await measure(target.key, target.route, run, target.auth ? cookie : ""));
    }
  }

  if (cookie) {
    const list = await fetch(`${baseUrl}/api/admin/location-selection`, { headers: { cookie } });
    if (!list.ok) throw new Error(`Selector list failed with ${list.status}.`);
    const payload = await list.json() as { locations?: Array<{ id?: string }> };
    const locationIds = (payload.locations || []).slice(0, 500).map((row) => row.id).filter((id): id is string => Boolean(id));
    for (let run = 1; run <= 3; run += 1) {
      measurements.push(await measure(
        "selector_availability_api",
        "/api/admin/location-selection/availability",
        run,
        cookie,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locationIds, periodStart: "2026-08-01", periodEnd: "2026-08-31" })
        }
      ));
    }
  }

  const report = summarize(measurements);
  console.log(JSON.stringify({ baseUrl, budgets: OBSERVABILITY_BUDGETS, report }, null, 2));
  const severe = report.flatMap((row) => row.violations.filter((violation) => violation.severity === "severe"));
  if (severe.length) {
    throw new Error(`${severe.length} severe performance budget regression(s) detected.`);
  }
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`Observability login failed with ${response.status}.`);
  return (response.headers.get("set-cookie") || "").split(";", 1)[0];
}

async function measure(
  budgetKey: ObservabilityBudgetKey,
  route: string,
  run: number,
  cookie: string,
  init: RequestInit = {}
): Promise<Measurement> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
    redirect: "manual"
  });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    budgetKey,
    route,
    run,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    payloadBytes: body.length,
    requestId: route.startsWith("/api/") ? Boolean(response.headers.get("x-request-id")) : true
  };
}

function summarize(measurements: Measurement[]) {
  const groups = new Map<ObservabilityBudgetKey, Measurement[]>();
  for (const measurement of measurements) {
    const rows = groups.get(measurement.budgetKey) || [];
    rows.push(measurement);
    groups.set(measurement.budgetKey, rows);
  }
  return [...groups.entries()].map(([budgetKey, rows]) => {
    const medianDurationMs = median(rows.map((row) => row.durationMs));
    const maxPayloadBytes = Math.max(...rows.map((row) => row.payloadBytes));
    const violations = evaluatePerformanceBudget(budgetKey, { durationMs: medianDurationMs, payloadBytes: maxPayloadBytes });
    if (rows.some((row) => row.status < 200 || row.status >= 400)) {
      violations.push({ metric: "durationMs", severity: "severe", actual: 1, limit: 0 });
    }
    if (rows.some((row) => !row.requestId)) {
      violations.push({ metric: "payloadBytes", severity: "severe", actual: 1, limit: 0 });
    }
    return { budgetKey, route: rows[0]?.route, medianDurationMs, maxPayloadBytes, runs: rows, violations };
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
