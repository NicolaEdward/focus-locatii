export const CRM_TIME_ZONE = "Europe/Bucharest";

export const CRM_PROSPECT_STATUS_OPTIONS = [
  { value: "prospecting", label: "Prospectare (Cold)" },
  { value: "qualified", label: "Calificat" },
  { value: "return_later", label: "Revenire ulterioara" },
  { value: "disqualified", label: "Necalificat" },
  { value: "on_hold", label: "In asteptare" },
  { value: "inactive", label: "Inactiv" }
] as const;

export const CRM_OPPORTUNITY_STAGE_OPTIONS = [
  { value: "opportunity", label: "Oportunitate" },
  { value: "quoted", label: "Ofertat" },
  { value: "negotiation", label: "In negociere" },
  { value: "contracting", label: "In contractare" },
  { value: "won", label: "Contractat (Castigat)" },
  { value: "lost", label: "Pierdut" },
  { value: "on_hold", label: "In asteptare" },
  { value: "inactive", label: "Inactiv" }
] as const;

export type CrmProspectStatus = typeof CRM_PROSPECT_STATUS_OPTIONS[number]["value"];
export type CrmOpportunityStage = typeof CRM_OPPORTUNITY_STAGE_OPTIONS[number]["value"];
export type CrmForecastLevel = "pipeline" | "possible" | "commit" | "won" | "excluded";

export const CRM_FORECAST_POLICY = {
  mode: "stage_deterministic",
  valueAggregation: "full_opportunity_value",
  manualProbability: false,
  stageLevels: {
    opportunity: "pipeline",
    quoted: "pipeline",
    negotiation: "possible",
    contracting: "commit",
    won: "won",
    lost: "excluded",
    on_hold: "excluded",
    inactive: "excluded"
  }
} as const satisfies {
  mode: "stage_deterministic";
  valueAggregation: "full_opportunity_value";
  manualProbability: false;
  stageLevels: Record<CrmOpportunityStage, CrmForecastLevel>;
};

export function crmAssertInitialProspectRequirements(status: string, normalizedTaxId?: string | null, contactName?: string | null) {
  if (!CRM_PROSPECT_STATUS_OPTIONS.some((option) => option.value === status)) {
    throw new Error("Stadiul initial al prospectului nu este valid.");
  }
  if (status === "qualified" && !normalizedTaxId) {
    throw new Error("CUI-ul este obligatoriu pentru un prospect calificat.");
  }
  if (status === "qualified" && !contactName?.trim()) {
    throw new Error("Persoana de contact este obligatorie pentru un prospect calificat.");
  }
}

export const CRM_ACTIVE_PROSPECT_STATUSES: readonly CrmProspectStatus[] = ["prospecting", "qualified"];
export const CRM_ACTIVE_OPPORTUNITY_STAGES: readonly CrmOpportunityStage[] = [
  "opportunity",
  "quoted",
  "negotiation",
  "contracting"
];

export const CRM_PROSPECT_TRANSITIONS: Record<CrmProspectStatus, readonly CrmProspectStatus[]> = {
  prospecting: ["qualified", "return_later", "disqualified", "on_hold", "inactive"],
  qualified: ["return_later", "disqualified", "on_hold", "inactive"],
  return_later: ["prospecting", "qualified", "disqualified", "inactive"],
  disqualified: [],
  on_hold: ["prospecting", "qualified", "inactive"],
  inactive: []
};

export const CRM_OPPORTUNITY_TRANSITIONS: Record<CrmOpportunityStage, readonly CrmOpportunityStage[]> = {
  opportunity: ["quoted", "lost", "on_hold", "inactive"],
  quoted: ["negotiation", "lost", "on_hold", "inactive"],
  negotiation: ["quoted", "contracting", "lost", "on_hold", "inactive"],
  contracting: ["negotiation", "won", "lost", "on_hold", "inactive"],
  won: [],
  lost: [],
  on_hold: ["opportunity", "quoted", "negotiation", "contracting", "lost", "inactive"],
  inactive: []
};

export const CRM_NEXT_ACTION_CATALOG: Record<string, readonly string[]> = {
  prospecting: [
    "identify_contact",
    "initial_call",
    "initial_email",
    "linkedin_message",
    "whatsapp_message",
    "send_presentation",
    "schedule_meeting",
    "qualify_need",
    "return_later",
    "disqualify",
    "other"
  ],
  qualified: [
    "confirm_brief",
    "confirm_budget",
    "confirm_period",
    "confirm_geography",
    "confirm_formats",
    "confirm_decision_maker",
    "create_opportunity",
    "other"
  ],
  opportunity: [
    "request_full_brief",
    "select_locations",
    "check_availability",
    "request_internal_price",
    "prepare_quote",
    "schedule_presentation",
    "other"
  ],
  quoted: [
    "confirm_quote_received",
    "request_feedback",
    "schedule_decision",
    "revise_quote",
    "start_negotiation",
    "other"
  ],
  negotiation: [
    "clarify_objection",
    "revise_value",
    "send_final_version",
    "obtain_approval",
    "schedule_final_decision",
    "start_contracting",
    "mark_lost",
    "other"
  ],
  contracting: [
    "follow_final_approval",
    "confirm_commercial_acceptance",
    "clarify_final_blocker",
    "mark_won",
    "mark_lost",
    "other"
  ]
};

export const CRM_NEXT_ACTION_LABELS: Record<string, string> = {
  identify_contact: "Identifica persoana de contact",
  initial_call: "Apel initial",
  initial_email: "Email initial",
  linkedin_message: "Mesaj LinkedIn",
  whatsapp_message: "Mesaj WhatsApp",
  send_presentation: "Trimite prezentarea",
  schedule_meeting: "Programeaza intalnire",
  qualify_need: "Califica nevoia",
  return_later: "Revenire ulterioara",
  disqualify: "Necalifica",
  confirm_brief: "Confirma brief-ul",
  confirm_budget: "Confirma bugetul",
  confirm_period: "Confirma perioada",
  confirm_geography: "Confirma geografia",
  confirm_formats: "Confirma formatele",
  confirm_decision_maker: "Confirma decidentul",
  create_opportunity: "Creeaza oportunitatea",
  request_full_brief: "Solicita brief complet",
  select_locations: "Selecteaza locatiile potrivite",
  check_availability: "Verifica disponibilitatea",
  request_internal_price: "Solicita pret intern",
  prepare_quote: "Pregateste oferta",
  schedule_presentation: "Programeaza prezentarea",
  confirm_quote_received: "Confirma primirea ofertei",
  request_feedback: "Solicita feedback",
  schedule_decision: "Programeaza decizia",
  revise_quote: "Revizuieste oferta",
  start_negotiation: "Treci in negociere",
  clarify_objection: "Clarifica obiectia",
  revise_value: "Revizuieste valoarea",
  send_final_version: "Trimite varianta finala",
  obtain_approval: "Obtine aprobarea",
  schedule_final_decision: "Programeaza decizia finala",
  start_contracting: "Treci in contractare",
  mark_lost: "Marcheaza pierdut",
  follow_final_approval: "Urmareste aprobarea finala",
  confirm_commercial_acceptance: "Confirma acceptul comercial",
  clarify_final_blocker: "Clarifica ultimul blocaj",
  mark_won: "Marcheaza castigat",
  other: "Alta actiune"
};

export function crmProspectStatusLabel(status: string) {
  return CRM_PROSPECT_STATUS_OPTIONS.find((option) => option.value === status)?.label || status;
}

export function crmOpportunityStageLabel(stage: string) {
  return CRM_OPPORTUNITY_STAGE_OPTIONS.find((option) => option.value === stage)?.label || stage;
}

export function crmForecastForStage(stage: string): CrmForecastLevel {
  return CRM_FORECAST_POLICY.stageLevels[stage as CrmOpportunityStage] || "pipeline";
}

export function crmForecastLabel(level: CrmForecastLevel) {
  return ({
    pipeline: "Pipeline",
    possible: "Posibil",
    commit: "Angajament",
    won: "Castigat",
    excluded: "Exclus"
  } as const)[level];
}

export function crmCurrentOpportunityValue(input: {
  quotedValue?: unknown;
  revisedValue?: unknown;
  agreedValue?: unknown;
}) {
  return decimalNumber(input.agreedValue) ?? decimalNumber(input.revisedValue) ?? decimalNumber(input.quotedValue);
}

export function crmAssertProspectTransition(from: string, to: string, exceptional = false) {
  if (exceptional) return;
  const allowed = CRM_PROSPECT_TRANSITIONS[from as CrmProspectStatus] || [];
  if (!allowed.includes(to as CrmProspectStatus)) {
    throw new Error(`Tranzitia ${crmProspectStatusLabel(from)} -> ${crmProspectStatusLabel(to)} nu este permisa.`);
  }
}

export function crmAssertOpportunityTransition(from: string, to: string, exceptional = false) {
  if (exceptional) return;
  const allowed = CRM_OPPORTUNITY_TRANSITIONS[from as CrmOpportunityStage] || [];
  if (!allowed.includes(to as CrmOpportunityStage)) {
    throw new Error(`Tranzitia ${crmOpportunityStageLabel(from)} -> ${crmOpportunityStageLabel(to)} nu este permisa.`);
  }
}

export function crmDefaultNextAction(hasContact: boolean) {
  return hasContact ? "initial_call" : "identify_contact";
}

export function crmNextActionLabel(type: string, description?: string | null) {
  if (type === "other" && description?.trim()) return description.trim();
  return CRM_NEXT_ACTION_LABELS[type] || description || type;
}

export function crmValidateActionForStage(stage: string, type: string, description?: string | null) {
  const allowed = CRM_NEXT_ACTION_CATALOG[stage] || ["other"];
  if (!allowed.includes(type)) throw new Error("Actiunea nu este disponibila in etapa curenta.");
  if (type === "other" && !description?.trim()) throw new Error("Descrierea este obligatorie pentru alta actiune.");
}

export function crmAddBusinessDays(start: Date, days: number, holidays: readonly string[] = []) {
  if (!Number.isInteger(days) || days < 0) throw new Error("Numarul de zile lucratoare nu este valid.");
  const holidaySet = new Set(holidays);
  const startParts = datePartsInTimeZone(start, CRM_TIME_ZONE);
  const cursor = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 12));
  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    const key = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidaySet.has(key)) remaining -= 1;
  }
  return localDateAtHour(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), 9, CRM_TIME_ZONE);
}

export function crmStartOfLocalDay(value: Date) {
  const parts = datePartsInTimeZone(value, CRM_TIME_ZONE);
  return localDateAtHour(parts.year, parts.month, parts.day, 0, CRM_TIME_ZONE);
}

export function crmNormalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

export function crmNormalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, "") || "";
  if (!digits) return null;
  return digits.startsWith("40") ? digits : digits.startsWith("0") ? `40${digits.slice(1)}` : digits;
}

export function crmNormalizeWebsiteDomain(value?: string | null) {
  if (!value?.trim()) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.trim().toLowerCase().replace(/^www\./, "").split("/")[0] || null;
  }
}

export function crmNormalizeCompanyName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?|s\.?a\.?|srl|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function decimalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function datePartsInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: number("year"), month: number("month"), day: number("day") };
}

function localDateAtHour(year: number, month: number, day: number, hour: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(guess));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  const represented = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return new Date(guess - (represented - guess));
}
