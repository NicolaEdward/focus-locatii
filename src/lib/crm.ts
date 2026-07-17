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
export type CrmOpportunityPriority = "urgent" | "high" | "normal";

export const CRM_SOURCE_OPTIONS = [
  "Prospectare directa",
  "Recomandare",
  "Client existent",
  "Agentie",
  "Cerere website",
  "Eveniment",
  "Campanie reactivata",
  "Alta sursa"
] as const;

export const CRM_LOST_REASON_OPTIONS = [
  { value: "price", label: "Pret / buget" },
  { value: "availability", label: "Locatii indisponibile" },
  { value: "timing", label: "Termen sau perioada nepotrivita" },
  { value: "competitor", label: "A ales concurenta" },
  { value: "cancelled", label: "Campanie anulata" },
  { value: "no_response", label: "Nu mai raspunde" },
  { value: "not_qualified", label: "Nevoie necalificata" },
  { value: "other", label: "Alt motiv" }
] as const;

export const CRM_QUALIFICATION_ITEMS = [
  { key: "needConfirmed", label: "Nevoie OOH confirmata" },
  { key: "periodKnown", label: "Perioada cunoscuta" },
  { key: "geographyKnown", label: "Orase / zone cunoscute" },
  { key: "formatsKnown", label: "Formate de interes cunoscute" },
  { key: "budgetKnown", label: "Buget orientativ cunoscut" },
  { key: "decisionMakerKnown", label: "Decident identificat" }
] as const;

export type CrmQualificationKey = (typeof CRM_QUALIFICATION_ITEMS)[number]["key"];
export type CrmQualificationData = Record<CrmQualificationKey, boolean>;

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

const crmStageSlaDays: Record<CrmStatus, number | null> = {
  cold: 7,
  contacted: 5,
  qualified: 10,
  brief_received: 7,
  in_offer: 5,
  offer_sent: 7,
  in_negotiation: 10,
  on_hold: 30,
  won: null,
  lost: null,
  inactive: null
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

export function normalizeCrmQualificationData(value: unknown): CrmQualificationData {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return CRM_QUALIFICATION_ITEMS.reduce<CrmQualificationData>((result, item) => {
    result[item.key] = source[item.key] === true;
    return result;
  }, {} as CrmQualificationData);
}

export function crmQualificationScore(value: unknown) {
  const data = normalizeCrmQualificationData(value);
  const completed = CRM_QUALIFICATION_ITEMS.filter((item) => data[item.key]).length;
  return {
    completed,
    total: CRM_QUALIFICATION_ITEMS.length,
    percent: Math.round((completed / CRM_QUALIFICATION_ITEMS.length) * 100),
    missing: CRM_QUALIFICATION_ITEMS.filter((item) => !data[item.key]).map((item) => item.label)
  };
}

export function crmStatusAtLeast(value: string, target: "contacted" | "qualified") {
  const activeOrder: CrmStatus[] = [
    "cold",
    "contacted",
    "qualified",
    "brief_received",
    "in_offer",
    "offer_sent",
    "in_negotiation",
    "on_hold",
    "won"
  ];
  const statusIndex = activeOrder.indexOf(normalizeCrmStatus(value));
  const targetIndex = activeOrder.indexOf(target);
  return statusIndex >= targetIndex;
}

export function crmStageAgeDays(stageChangedAt: Date | string | null | undefined, now = new Date()) {
  if (!stageChangedAt) return 0;
  return Math.max(0, Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(new Date(stageChangedAt)).getTime()) / 86400000));
}

export function crmStageIsStalled(input: {
  status: string;
  stageChangedAt?: Date | string | null;
}, now = new Date()) {
  const status = normalizeCrmStatus(input.status);
  const slaDays = crmStageSlaDays[status];
  return slaDays != null && crmStageAgeDays(input.stageChangedAt, now) > slaDays;
}

export function crmOpportunityPriority(input: {
  status: string;
  nextFollowUpDate?: Date | string | null;
  stageChangedAt?: Date | string | null;
  expectedCloseDate?: Date | string | null;
  noResponseCount?: number | null;
}, now = new Date()): CrmOpportunityPriority {
  const today = startOfUtcDay(now);
  if (input.nextFollowUpDate && new Date(input.nextFollowUpDate) < today) return "urgent";
  if ((input.noResponseCount || 0) >= 3) return "urgent";
  if (crmStageIsStalled(input, now)) return "high";
  const status = normalizeCrmStatus(input.status);
  if (["offer_sent", "in_negotiation"].includes(status)) return "high";
  if (input.expectedCloseDate && new Date(input.expectedCloseDate) <= addDays(today, 7)) return "high";
  return "normal";
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
  lostReasonCode?: string | null;
  clientId?: string | null;
}) {
  const status = normalizeCrmStatus(input.status);
  if (isActiveCrmStatus(status) && !input.nextFollowUpDate) {
    throw new Error("Lead-urile active trebuie sa aiba urmatorul follow-up setat.");
  }
  if (status === "lost" && !input.lostReason?.trim()) {
    throw new Error("Completeaza motivul pentru care lead-ul a fost pierdut.");
  }
  if (status === "lost" && !input.lostReasonCode?.trim()) {
    throw new Error("Alege categoria pentru care oportunitatea a fost pierduta.");
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
    const stalledWhere = CRM_ACTIVE_STATUSES.flatMap((status) => {
      const slaDays = crmStageSlaDays[status];
      return slaDays == null
        ? []
        : [{
            status: { in: crmDbStatusesFor(status) },
            stageChangedAt: { lte: addDays(todayStart, -slaDays - 1) }
          }];
    });
    return {
      status: { in: CRM_ACTIVE_DB_STATUSES },
      OR: [
        { nextFollowUpDate: null },
        { nextFollowUpDate: { lt: tomorrow } },
        { lastActivityAt: { lt: addDays(todayStart, -14) } },
        {
          status: { in: crmDbStatusesFor("cold") },
          stageChangedAt: { lte: addDays(todayStart, -7) }
        },
        {
          status: { in: crmDbStatusesFor("contacted") },
          stageChangedAt: { lte: addDays(todayStart, -5) }
        },
        ...stalledWhere
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
  lastActivityAt?: Date | string | null;
}, now = new Date()) {
  const status = normalizeCrmStatus(input.status);
  if (!isActiveCrmStatus(status)) return null;
  if (!input.nextFollowUpDate) return "missing";
  const followUp = new Date(input.nextFollowUpDate);
  const todayStart = startOfUtcDay(now);
  const tomorrow = addDays(todayStart, 1);
  if (followUp < todayStart) return "overdue";
  if (followUp < tomorrow) return "today";
  if (new Date(input.lastActivityAt || input.updatedAt) < addDays(now, -14)) return "dormant";
  return null;
}

export function crmLeadClassificationAttention(input: {
  status: string;
  updatedAt: Date | string;
  stageChangedAt?: Date | string | null;
}, now = new Date()): CrmClassificationAttention {
  const status = normalizeCrmStatus(input.status);
  const stageChangedAt = new Date(input.stageChangedAt || input.updatedAt);
  if (status === "cold" && stageChangedAt <= addDays(now, -7)) return "cold";
  if (status === "contacted" && stageChangedAt <= addDays(now, -5)) return "contacted";
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
    stageChangedAt?: Date | null;
    firstContactedAt?: Date | null;
    qualifiedAt?: Date | null;
    lastActivityAt?: Date | null;
    qualificationData?: unknown;
    noResponseCount?: number | null;
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
    dormant: active.filter((row) => (row.lastActivityAt || row.updatedAt) < addDays(now, -14)).length,
    stalled: active.filter((row) => crmStageIsStalled(row, now)).length,
    needsQualification: active.filter((row) =>
      crmStatusAtLeast(row.status, "qualified") && crmQualificationScore(row.qualificationData).completed < 4
    ).length,
    noResponseAttention: active.filter((row) => (row.noResponseCount || 0) >= 3).length,
    contacted: rows.filter((row) => Boolean(row.firstContactedAt) || crmStatusAtLeast(row.status, "contacted")).length,
    qualified: rows.filter((row) => Boolean(row.qualifiedAt) || crmStatusAtLeast(row.status, "qualified")).length,
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
