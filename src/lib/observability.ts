import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  evaluatePerformanceBudget,
  type ObservabilityBudgetKey,
  type PerformanceMeasurement
} from "@/lib/observability-budgets";

type LogLevel = "info" | "warn" | "error";

export type ObservabilityContext = {
  correlationId: string;
  route: string;
  operation: string;
  method: string;
  role?: string;
  queryCount: number;
  slowQueryCount: number;
};

export type ObservabilityMetrics = Partial<Record<
  | "compressedBytes"
  | "rowCount"
  | "cellCount"
  | "sheetCount"
  | "scannedCount"
  | "createdCount"
  | "updatedCount"
  | "deletedCount"
  | "failedCount"
  | "sentCount"
  | "conflictCount"
  | "fileCount"
  | "fileBytes"
  | "itemCount"
  | "clientCount"
  | "supplierCount"
  | "receivableCount"
  | "payableCount"
  | "adjustmentCount"
  | "attemptCount"
  | "retryAfterSeconds"
  | "timeoutMs"
  | "thresholdMs",
  number
>>;

export type StructuredLogInput = {
  route?: string;
  operation?: string;
  method?: string;
  durationMs?: number;
  status?: number | string;
  role?: string;
  correlationId?: string;
  entityType?: string;
  entityId?: string | null;
  errorCode?: string;
  payloadBytes?: number;
  queryCount?: number;
  slowQueryCount?: number;
  budgetKey?: ObservabilityBudgetKey;
  budgetMetric?: keyof PerformanceMeasurement;
  budgetLimit?: number;
  metrics?: ObservabilityMetrics;
};

export type StructuredLogRecord = {
  timestamp: string;
  environment: string;
  level: LogLevel;
  event: string;
  route?: string;
  operation?: string;
  method?: string;
  durationMs?: number;
  status?: number | string;
  role?: string;
  correlationId?: string;
  entityType?: string;
  entityId?: string;
  errorCode?: string;
  payloadBytes?: number;
  queryCount?: number;
  slowQueryCount?: number;
  budgetKey?: ObservabilityBudgetKey;
  budgetMetric?: keyof PerformanceMeasurement;
  budgetLimit?: number;
  metrics?: ObservabilityMetrics;
};

const requestContext = new AsyncLocalStorage<ObservabilityContext>();
const safeTokenPattern = /^[A-Za-z0-9_.:/-]+$/;
const safeMetricNames = new Set([
  "compressedBytes", "rowCount", "cellCount", "sheetCount", "scannedCount", "createdCount",
  "updatedCount", "deletedCount", "failedCount", "sentCount", "conflictCount", "fileCount",
  "fileBytes", "itemCount", "clientCount", "supplierCount", "receivableCount", "payableCount",
  "adjustmentCount", "attemptCount", "retryAfterSeconds", "timeoutMs", "thresholdMs"
]);

export function createStructuredLogRecord(
  level: LogLevel,
  event: string,
  input: StructuredLogInput = {}
): StructuredLogRecord {
  const context = requestContext.getStore();
  const record: StructuredLogRecord = {
    timestamp: new Date().toISOString(),
    environment: safeToken(process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown", "unknown", 32),
    level,
    event: safeToken(event, "observability_event", 96)
  };
  assignToken(record, "route", input.route || context?.route, 180);
  assignToken(record, "operation", input.operation || context?.operation, 120);
  assignToken(record, "method", input.method || context?.method, 12);
  assignNumber(record, "durationMs", input.durationMs);
  if (input.status !== undefined) record.status = typeof input.status === "number" ? input.status : safeToken(input.status, "unknown", 40);
  assignToken(record, "role", input.role || context?.role, 48);
  assignToken(record, "correlationId", input.correlationId || context?.correlationId, 128);
  assignToken(record, "entityType", input.entityType, 80);
  assignToken(record, "entityId", input.entityId || undefined, 128);
  assignToken(record, "errorCode", input.errorCode, 96);
  assignNumber(record, "payloadBytes", input.payloadBytes);
  assignNumber(record, "queryCount", input.queryCount ?? context?.queryCount);
  assignNumber(record, "slowQueryCount", input.slowQueryCount ?? context?.slowQueryCount);
  if (input.budgetKey) record.budgetKey = input.budgetKey;
  if (input.budgetMetric) record.budgetMetric = input.budgetMetric;
  assignNumber(record, "budgetLimit", input.budgetLimit);
  const metrics = sanitizeMetrics(input.metrics);
  if (Object.keys(metrics).length) record.metrics = metrics;
  return record;
}

export function emitStructuredLog(level: LogLevel, event: string, input: StructuredLogInput = {}) {
  const record = createStructuredLogRecord(level, event, input);
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
  return record;
}

export async function observeRoute<T extends Response>(
  request: NextRequest,
  options: { route: string; operation: string; budgetKey?: ObservabilityBudgetKey },
  handler: () => Promise<T>
): Promise<T> {
  const context: ObservabilityContext = {
    correlationId: requestCorrelationId(request),
    route: options.route,
    operation: options.operation,
    method: request.method,
    queryCount: 0,
    slowQueryCount: 0
  };

  return requestContext.run(context, async () => {
    const startedAt = performance.now();
    try {
      const response = await handler();
      const durationMs = Math.round(performance.now() - startedAt);
      const payloadBytes = await responsePayloadBytes(response);
      response.headers.set("x-request-id", context.correlationId);
      const measurement = {
        durationMs,
        payloadBytes,
        queryCount: context.queryCount,
        slowQueryCount: context.slowQueryCount
      };
      emitStructuredLog(response.status >= 500 ? "error" : "info", "request_completed", {
        ...measurement,
        status: response.status,
        budgetKey: options.budgetKey
      });
      if (response.status >= 500) {
        emitStructuredLog("error", "request_5xx", { ...measurement, status: response.status, errorCode: "HTTP_5XX" });
      }
      if (response.status === 408 || response.status === 504) {
        emitStructuredLog("error", "request_timeout", { ...measurement, status: response.status, errorCode: "HTTP_TIMEOUT" });
      }
      if (options.budgetKey) logBudgetViolations(options.budgetKey, measurement);
      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const errorCode = safeErrorCode(error);
      emitStructuredLog("error", "request_failed", {
        durationMs,
        status: 500,
        errorCode,
        queryCount: context.queryCount,
        slowQueryCount: context.slowQueryCount
      });
      if (errorCode.includes("TIMEOUT")) {
        emitStructuredLog("error", "request_timeout", { durationMs, status: 500, errorCode });
      }
      throw error;
    }
  });
}

export function setObservabilityRole(role: string | null | undefined) {
  const context = requestContext.getStore();
  if (context && role) context.role = safeToken(role, "UNKNOWN", 48);
}

export function currentCorrelationId() {
  return requestContext.getStore()?.correlationId || null;
}

export function recordPrismaQuery(durationMs: number) {
  const context = requestContext.getStore();
  if (!context) return;
  context.queryCount += 1;
  if (durationMs >= prismaSlowQueryThresholdMs()) context.slowQueryCount += 1;
}

export function prismaSlowQueryThresholdMs() {
  const configured = Number(process.env.PRISMA_SLOW_QUERY_MS || 500);
  return Number.isFinite(configured) && configured >= 50 ? Math.round(configured) : 500;
}

export function safeErrorCode(error: unknown, fallback = "UNEXPECTED_ERROR") {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && safeTokenPattern.test(code) && code.length <= 96) return code;
  }
  if (error instanceof Error && safeTokenPattern.test(error.name) && error.name !== "Error") return error.name.slice(0, 96);
  return fallback;
}

export function requestCorrelationId(request: Pick<NextRequest, "headers">) {
  const candidate = request.headers.get("x-request-id") || request.headers.get("x-vercel-id");
  if (candidate && candidate.length >= 8 && candidate.length <= 128 && safeTokenPattern.test(candidate)) return candidate;
  return randomUUID();
}

function logBudgetViolations(budgetKey: ObservabilityBudgetKey, measurement: PerformanceMeasurement) {
  for (const violation of evaluatePerformanceBudget(budgetKey, measurement)) {
    emitStructuredLog(violation.severity === "severe" ? "error" : "warn", "performance_budget_exceeded", {
      budgetKey,
      budgetMetric: violation.metric,
      budgetLimit: violation.limit,
      durationMs: measurement.durationMs || undefined,
      payloadBytes: measurement.payloadBytes || undefined,
      queryCount: measurement.queryCount || undefined,
      slowQueryCount: measurement.slowQueryCount || undefined,
      errorCode: violation.severity === "severe" ? "PERFORMANCE_BUDGET_SEVERE" : "PERFORMANCE_BUDGET_WARNING"
    });
  }
}

async function responsePayloadBytes(response: Response) {
  const contentLength = response.headers.get("content-length");
  const explicit = contentLength == null ? Number.NaN : Number(contentLength);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const contentType = response.headers.get("content-type") || "";
  if (!/application\/json|text\//i.test(contentType)) return undefined;
  try {
    return (await response.clone().arrayBuffer()).byteLength;
  } catch {
    return undefined;
  }
}

function safeToken(value: string, fallback: string, maxLength: number) {
  const normalized = value.trim().slice(0, maxLength);
  return normalized && safeTokenPattern.test(normalized) ? normalized : fallback;
}

function assignToken<T extends StructuredLogRecord, K extends keyof StructuredLogRecord>(
  record: T,
  key: K,
  value: string | undefined,
  maxLength: number
) {
  if (!value) return;
  (record[key] as unknown) = safeToken(value, "redacted", maxLength);
}

function assignNumber<T extends StructuredLogRecord, K extends keyof StructuredLogRecord>(record: T, key: K, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return;
  (record[key] as unknown) = Math.max(0, Math.round(value));
}

function sanitizeMetrics(metrics: ObservabilityMetrics | undefined): ObservabilityMetrics {
  if (!metrics) return {};
  return Object.fromEntries(
    Object.entries(metrics)
      .filter(([key, value]) => safeMetricNames.has(key) && typeof value === "number" && Number.isFinite(value))
      .map(([key, value]) => [key, Math.max(0, Math.round(value as number))])
  ) as ObservabilityMetrics;
}
