export type OperationKind = "decoration" | "neutralization";
export type OperationStatus = "NEW" | "IN_PROGRESS" | "DONE" | "ARCHIVED";

export type OperationMeta = {
  decorationStatus?: OperationStatus;
  decorationUpdatedAt?: string;
  decorationCost?: number | null;
  decorationCurrency?: "RON" | "EUR" | string | null;
  neutralizationStatus?: OperationStatus;
  neutralizationUpdatedAt?: string;
  tasks?: OperationExtraTask[];
};

export type OperationExtraTask = {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  taskType?: "initial" | "redecoration" | "neutralization" | string;
  taskDate: string;
  requestedDate?: string | null;
  cost?: number | null;
  currency?: "RON" | "EUR" | string | null;
  costOwner?: string | null;
  note?: string | null;
  briefUrl?: string | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
};

const META_PATTERN = /<!--focus-ops:([\s\S]*?)-->/;

export function parseOperationMeta(value?: string | null): OperationMeta {
  const match = String(value || "").match(META_PATTERN);
  if (!match) return {};

  try {
    const parsed = JSON.parse(match[1]) as OperationMeta;
    return {
      decorationStatus: normalizeStatus(parsed.decorationStatus),
      decorationUpdatedAt: parsed.decorationUpdatedAt,
      decorationCost: normalizeCost(parsed.decorationCost),
      decorationCurrency: parsed.decorationCurrency || null,
      neutralizationStatus: normalizeStatus(parsed.neutralizationStatus),
      neutralizationUpdatedAt: parsed.neutralizationUpdatedAt,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask).filter(Boolean) as OperationExtraTask[] : []
    };
  } catch {
    return {};
  }
}

export function stripOperationMeta(value?: string | null) {
  return String(value || "").replace(META_PATTERN, "").trim();
}

export function operationStatus(value: string | null | undefined, kind: OperationKind): OperationStatus {
  const meta = parseOperationMeta(value);
  const status = kind === "decoration" ? meta.decorationStatus : meta.neutralizationStatus;
  return status || "NEW";
}

export function operationUpdatedAt(value: string | null | undefined, kind: OperationKind) {
  const meta = parseOperationMeta(value);
  return kind === "decoration" ? meta.decorationUpdatedAt || null : meta.neutralizationUpdatedAt || null;
}

export function operationCost(value: string | null | undefined, kind: OperationKind) {
  if (kind !== "decoration") return { cost: null, currency: null };
  const meta = parseOperationMeta(value);
  return {
    cost: meta.decorationCost ?? null,
    currency: meta.decorationCurrency || null
  };
}

export function operationStatusLabel(status: OperationStatus) {
  const labels: Record<OperationStatus, string> = {
    NEW: "Noua",
    IN_PROGRESS: "In lucru",
    DONE: "Finalizata",
    ARCHIVED: "Arhivata"
  };
  return labels[status];
}

export function isOperationActive(status: OperationStatus) {
  return status !== "DONE" && status !== "ARCHIVED";
}

export function withOperationStatus(value: string | null | undefined, kind: OperationKind, status: OperationStatus) {
  const text = stripOperationMeta(value);
  const meta = parseOperationMeta(value);
  const now = new Date().toISOString();
  const nextMeta: OperationMeta =
    kind === "decoration"
      ? { ...meta, decorationStatus: status, decorationUpdatedAt: now }
      : { ...meta, neutralizationStatus: status, neutralizationUpdatedAt: now };
  const metaText = `<!--focus-ops:${JSON.stringify(nextMeta)}-->`;
  return text ? `${text}\n${metaText}` : metaText;
}

export function withOperationCost(
  value: string | null | undefined,
  kind: OperationKind,
  cost: number | null,
  currency?: string | null
) {
  if (kind !== "decoration") return value || null;
  const text = stripOperationMeta(value);
  const hadMeta = META_PATTERN.test(String(value || ""));
  if (cost == null && !hadMeta) return text || null;
  const meta = parseOperationMeta(value);
  const nextMeta: OperationMeta = {
    ...meta,
    decorationCost: cost,
    decorationCurrency: cost == null ? null : currency || meta.decorationCurrency || "EUR"
  };
  const metaText = `<!--focus-ops:${JSON.stringify(nextMeta)}-->`;
  return text ? `${text}\n${metaText}` : metaText;
}

export function operationExtraTasks(value: string | null | undefined, kind?: OperationKind): OperationExtraTask[] {
  const tasks = parseOperationMeta(value).tasks || [];
  return kind ? tasks.filter((task) => task.kind === kind) : tasks;
}

export function withOperationTask(value: string | null | undefined, task: OperationExtraTask) {
  const text = stripOperationMeta(value);
  const meta = parseOperationMeta(value);
  const now = new Date().toISOString();
  const nextMeta: OperationMeta = {
    ...meta,
    tasks: [...(meta.tasks || []), normalizeTask({ ...task, createdAt: task.createdAt || now }) as OperationExtraTask]
  };
  const metaText = `<!--focus-ops:${JSON.stringify(nextMeta)}-->`;
  return text ? `${text}\n${metaText}` : metaText;
}

export function withOperationTaskStatus(value: string | null | undefined, taskId: string, status: OperationStatus) {
  const text = stripOperationMeta(value);
  const meta = parseOperationMeta(value);
  const now = new Date().toISOString();
  const tasks = (meta.tasks || []).map((task) =>
    task.id === taskId
      ? { ...task, status, updatedAt: now, completedAt: status === "DONE" ? task.completedAt || now : null }
      : task
  );
  const metaText = `<!--focus-ops:${JSON.stringify({ ...meta, tasks })}-->`;
  return text ? `${text}\n${metaText}` : metaText;
}

function normalizeStatus(value: unknown): OperationStatus | undefined {
  if (value === "NEW" || value === "IN_PROGRESS" || value === "DONE" || value === "ARCHIVED") return value;
  return undefined;
}

function normalizeCost(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeTask(value: unknown): OperationExtraTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<OperationExtraTask>;
  const kind = task.kind === "decoration" || task.kind === "neutralization" ? task.kind : null;
  const status = normalizeStatus(task.status) || "NEW";
  const taskDate = task.taskDate || task.requestedDate;
  if (!task.id || !kind || !taskDate) return null;
  return {
    id: String(task.id),
    kind,
    status,
    taskType: task.taskType || (kind === "decoration" ? "redecoration" : "neutralization"),
    taskDate: String(taskDate),
    requestedDate: task.requestedDate || null,
    cost: normalizeCost(task.cost),
    currency: task.currency || null,
    costOwner: task.costOwner || null,
    note: task.note || null,
    briefUrl: task.briefUrl || null,
    createdByUserId: task.createdByUserId || null,
    createdByName: task.createdByName || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    completedAt: task.completedAt || null
  };
}
