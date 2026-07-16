import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";

export const CRM_STATUS_OPTIONS = [
  { value: "cold", label: "Cold", tone: "gray", defaultProbability: 10, description: "Prospect nou, fara contact comercial confirmat." },
  { value: "contacted", label: "Contactat", tone: "blue", defaultProbability: 20, description: "Primul contact a avut loc; nevoia trebuie clarificata." },
  { value: "qualified", label: "Calificat", tone: "blue", defaultProbability: 35, description: "Exista nevoie OOH si oportunitatea merita urmarita." },
  { value: "brief_received", label: "Brief primit", tone: "blue", defaultProbability: 50, description: "Perioada, obiectivul si cerintele sunt cunoscute." },
  { value: "in_offer", label: "Oferta in pregatire", tone: "yellow", defaultProbability: 60, description: "Propunerea comerciala este in lucru." },
  { value: "offer_sent", label: "Oferta trimisa", tone: "yellow", defaultProbability: 70, description: "Clientul a primit oferta si asteptam raspuns." },
  { value: "in_negotiation", label: "Negociere", tone: "yellow", defaultProbability: 80, description: "Oferta este discutata activ cu clientul." },
  { value: "on_hold", label: "Revenire ulterioara", tone: "gray", defaultProbability: 20, description: "Oportunitate deschisa, cu revenire programata." },
  { value: "won", label: "Castigat", tone: "green", defaultProbability: 100, description: "Lead convertit in client." },
  { value: "lost", label: "Pierdut", tone: "red", defaultProbability: 0, description: "Oportunitatea a fost inchisa fara vanzare." },
  { value: "inactive", label: "Inactiv", tone: "gray", defaultProbability: 0, description: "Nu mai necesita activitate comerciala." }
] as const;

export type CrmStatus = (typeof CRM_STATUS_OPTIONS)[number]["value"];
export type CrmDueFilter = "all" | "attention" | "overdue" | "today" | "upcoming" | "missing";
export type CrmClassificationAttention = "cold" | "contacted" | null;

const crmStatusAliases: Record<string, CrmStatus> = {
  new: "cold",
  in_analysis: "qualified",
  negotiation: "in_negotiation",
  in_contracting: "in_negotiation",
  no_response: "on_hold",
  hold_created: "on_hold",
  account_management: "won"
};

const dbStatusesByCanonical: Record<CrmStatus, string[]> = {
  cold: ["cold", "new"],
  contacted: ["contacted"],
  qualified: ["qualified", "in_analysis"],
  brief_received: ["brief_received"],
  in_offer: ["in_offer"],
  offer_sent: ["offer_sent"],
  in_negotiation: ["in_negotiation", "negotiation", "in_contracting"],
  on_hold: ["on_hold", "no_response", "hold_created"],
  won: ["won", "account_management"],
  lost: ["lost"],
  inactive: ["inactive"]
};

export const CRM_ACTIVE_STATUSES: CrmStatus[] = [
  "cold",
  "contacted",
  "qualified",
  "brief_received",
  "in_offer",
  "offer_sent",
  "in_negotiation",
  "on_hold"
];

export const CRM_ACTIVE_DB_STATUSES = CRM_ACTIVE_STATUSES.flatMap((status) => dbStatusesByCanonical[status]);
export const CRM_TERMINAL_DB_STATUSES = [...dbStatusesByCanonical.won, ...dbStatusesByCanonical.lost, ...dbStatusesByCanonical.inactive];
export const CRM_ALLOWED_ROLES = ["SALES_AGENT", "SALES_DIRECTOR", "COO", "SUPER_ADMIN"] as const;

export function normalizeCrmStatus(value?: string | null): CrmStatus {
  const normalized = String(value || "new").trim().toLowerCase();
  if (crmStatusAliases[normalized]) return crmStatusAliases[normalized];
  return CRM_STATUS_OPTIONS.some((option) => option.value === normalized)
    ? normalized as CrmStatus
    : "cold";
}

export function isKnownCrmStatus(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(crmStatusAliases[normalized])
    || CRM_STATUS_OPTIONS.some((option) => option.value === normalized);
}

export function crmDbStatusesFor(status: CrmStatus) {
  return dbStatusesByCanonical[status];
}

export function crmStatusLabel(value?: string | null) {
  const status = normalizeCrmStatus(value);
  return CRM_STATUS_OPTIONS.find((option) => option.value === status)?.label || "Cold";
}

export function crmStatusTone(value?: string | null) {
  const status = normalizeCrmStatus(value);
  return CRM_STATUS_OPTIONS.find((option) => option.value === status)?.tone || "gray";
}

export function crmStatusDescription(value?: string | null) {
  const status = normalizeCrmStatus(value);
  return CRM_STATUS_OPTIONS.find((option) => option.value === status)?.description || "";
}

export function crmDefaultProbability(value?: string | null) {
  const status = normalizeCrmStatus(value);
  return CRM_STATUS_OPTIONS.find((option) => option.value === status)?.defaultProbability ?? 0;
}

export function isActiveCrmStatus(value?: string | null) {
  return CRM_ACTIVE_STATUSES.includes(normalizeCrmStatus(value));
}

export function assertCrmRole(actor: AuthSession) {
  if (!CRM_ALLOWED_ROLES.includes(actor.role as (typeof CRM_ALLOWED_ROLES)[number])) {
    throw new Error("Rolul curent nu are acces la CRM.");
  }
}

export function crmLeadScope(actor: AuthSession): Prisma.CrmLeadWhereInput {
  assertCrmRole(actor);
  return actor.role === "SALES_AGENT" ? { assignedToUserId: actor.id } : {};
}

export function canAccessCrmLead(actor: AuthSession, lead: { assignedToUserId: string | null }) {
  if (!CRM_ALLOWED_ROLES.includes(actor.role as (typeof CRM_ALLOWED_ROLES)[number])) return false;
  return actor.role !== "SALES_AGENT" || lead.assignedToUserId === actor.id;
}

export function validateCrmState(input: {
  status: string;
  nextFollowUpDate?: Date | null;
  lostReason?: string | null;
  clientId?: string | null;
}) {
  const status = normalizeCrmStatus(input.status);
  if (isActiveCrmStatus(status) && !input.nextFollowUpDate) {
    throw new Error("Lead-urile active trebuie sa aiba urmatorul follow-up setat.");
  }
  if (status === "lost" && !input.lostReason?.trim()) {
    throw new Error("Completeaza motivul pentru care lead-ul a fost pierdut.");
  }
  if (status === "won" && !input.clientId) {
    throw new Error("Leaga sau converteste lead-ul intr-un client inainte de a-l marca castigat.");
  }
  return status;
}

export function crmDueWhere(filter: CrmDueFilter, now = new Date()): Prisma.CrmLeadWhereInput {
  if (filter === "all") return {};
  const todayStart = startOfUtcDay(now);
  const tomorrow = addDays(todayStart, 1);
  if (filter === "attention") {
    return {
      status: { in: CRM_ACTIVE_DB_STATUSES },
      OR: [
        { nextFollowUpDate: null },
        { nextFollowUpDate: { lt: tomorrow } },
        { updatedAt: { lt: addDays(now, -14) } },
        {
          status: { in: crmDbStatusesFor("cold") },
          updatedAt: { lte: addDays(now, -7) }
        },
        {
          status: { in: crmDbStatusesFor("contacted") },
          updatedAt: { lte: addDays(now, -5) }
        }
      ]
    };
  }
  if (filter === "overdue") {
    return { status: { in: CRM_ACTIVE_DB_STATUSES }, nextFollowUpDate: { lt: todayStart } };
  }
  if (filter === "today") {
    return { status: { in: CRM_ACTIVE_DB_STATUSES }, nextFollowUpDate: { gte: todayStart, lt: tomorrow } };
  }
  if (filter === "upcoming") {
    return { status: { in: CRM_ACTIVE_DB_STATUSES }, nextFollowUpDate: { gte: tomorrow } };
  }
  return { status: { in: CRM_ACTIVE_DB_STATUSES }, nextFollowUpDate: null };
}

export function crmLeadAttention(input: {
  status: string;
  nextFollowUpDate: Date | string | null;
  updatedAt: Date | string;
}, now = new Date()) {
  const status = normalizeCrmStatus(input.status);
  if (!isActiveCrmStatus(status)) return null;
  if (!input.nextFollowUpDate) return "missing";
  const followUp = new Date(input.nextFollowUpDate);
  const todayStart = startOfUtcDay(now);
  const tomorrow = addDays(todayStart, 1);
  if (followUp < todayStart) return "overdue";
  if (followUp < tomorrow) return "today";
  if (new Date(input.updatedAt) < addDays(now, -14)) return "dormant";
  return null;
}

export function crmLeadClassificationAttention(input: {
  status: string;
  updatedAt: Date | string;
}, now = new Date()): CrmClassificationAttention {
  const status = normalizeCrmStatus(input.status);
  const updatedAt = new Date(input.updatedAt);
  if (status === "cold" && updatedAt <= addDays(now, -7)) return "cold";
  if (status === "contacted" && updatedAt <= addDays(now, -5)) return "contacted";
  return null;
}

export function weightedCrmValue(value?: number | null, probability?: number | null) {
  return roundMoney((value || 0) * Math.max(0, Math.min(100, probability ?? 0)) / 100);
}

export function summarizeCrmLeads(
  rows: Array<{
    status: string;
    nextFollowUpDate: Date | null;
    estimatedValue: number | null;
    currency: string | null;
    probability: number | null;
    updatedAt: Date;
  }>,
  now = new Date()
) {
  const todayStart = startOfUtcDay(now);
  const tomorrow = addDays(todayStart, 1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const active = rows.filter((row) => isActiveCrmStatus(row.status));
  const pipelineByCurrency = moneyByCurrency(active, (row) => row.estimatedValue || 0);
  const weightedByCurrency = moneyByCurrency(active, (row) => weightedCrmValue(row.estimatedValue, row.probability));
  return {
    total: rows.length,
    active: active.length,
    overdue: active.filter((row) => row.nextFollowUpDate && row.nextFollowUpDate < todayStart).length,
    dueToday: active.filter((row) => row.nextFollowUpDate && row.nextFollowUpDate >= todayStart && row.nextFollowUpDate < tomorrow).length,
    missingNextStep: active.filter((row) => !row.nextFollowUpDate).length,
    dormant: active.filter((row) => row.updatedAt < addDays(now, -14)).length,
    wonThisMonth: rows.filter((row) => normalizeCrmStatus(row.status) === "won" && row.updatedAt >= monthStart).length,
    lostThisMonth: rows.filter((row) => normalizeCrmStatus(row.status) === "lost" && row.updatedAt >= monthStart).length,
    pipelineByCurrency,
    weightedByCurrency
  };
}

export function monthlyCrmOutcomes(
  events: Array<{
    leadId: string;
    statusAtTime: string | null;
    activityDate: Date | string;
  }>,
  now = new Date()
) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const latestByLead = new Map<string, { status: CrmStatus; activityDate: Date }>();
  for (const event of events) {
    const activityDate = new Date(event.activityDate);
    const status = normalizeCrmStatus(event.statusAtTime);
    if (activityDate < monthStart || activityDate > now || !["won", "lost"].includes(status)) continue;
    const current = latestByLead.get(event.leadId);
    if (!current || activityDate >= current.activityDate) {
      latestByLead.set(event.leadId, { status, activityDate });
    }
  }
  const outcomes = [...latestByLead.values()];
  return {
    wonThisMonth: outcomes.filter((outcome) => outcome.status === "won").length,
    lostThisMonth: outcomes.filter((outcome) => outcome.status === "lost").length
  };
}

function moneyByCurrency<T extends { currency: string | null }>(rows: T[], value: (row: T) => number) {
  return rows.reduce<Record<string, number>>((result, row) => {
    const currency = row.currency || "EUR";
    result[currency] = roundMoney((result[currency] || 0) + value(row));
    return result;
  }, {});
}

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
