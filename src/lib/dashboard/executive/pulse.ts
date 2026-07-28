import type {
  ExecutivePulse,
  ExecutivePulseDimension
} from "@/lib/dashboard/executive/contracts";

export const EXECUTIVE_PULSE_WEIGHTS = {
  finance: 25,
  operations: 25,
  campaigns: 20,
  sales: 15,
  inventory: 10,
  crm: 5
} as const;

const PULSE_REASON_LABELS: Record<string, string> = {
  CURRENCY_CONSOLIDATION_NOT_APPROVED: "monedele nu pot fi consolidate fără un curs aprobat",
  FINANCE_DATA_MISSING: "nu există date financiare canonice pentru perioada selectată",
  OPERATION_ENTITY_ATTRIBUTION_INCOMPLETE: "taskurile operaționale nu sunt atribuite complet entității juridice",
  OPERATIONTASK_CUTOVER_PENDING: "registrul operațional nu a finalizat procesul de validare",
  CONTRACT_SIGNATURE_STATUS_NOT_CANONICAL: "statusul semnării contractului nu este disponibil canonic",
  PARTIAL_BOOKED_COVERAGE_SOURCE_MISSING: "nu există o sursă canonică pentru acoperirea BOOKED parțială",
  CAMPAIGN_DATA_MISSING: "nu există campanii eligibile în perioada selectată",
  SALES_TARGET_SOURCE_MISSING: "nu există o sursă canonică pentru targetul comercial",
  DISCOUNT_AND_PROFITABILITY_NOT_CANONICAL: "discountul și profitabilitatea nu au o sursă canonică",
  INVENTORY_IS_SHARED_ACROSS_LEGAL_ENTITIES: "inventarul comun nu poate fi atribuit acestei entități juridice",
  CRM_LEGAL_ENTITY_RELATIONSHIP_MISSING: "CRM nu are o relație canonică cu entitatea juridică"
};

export function executivePulseReasonLabel(reason: string) {
  return PULSE_REASON_LABELS[reason] || "sursa canonică este incompletă";
}

export function buildExecutivePulse(dimensions: ExecutivePulseDimension[], entitySplitRequired = false): ExecutivePulse {
  const totalConfidence = Math.round(
    dimensions.reduce((sum, dimension) => sum + dimension.weight * dimension.confidence, 0) / 100
  );
  const criticalConfidence = Object.fromEntries(
    dimensions.filter((dimension) => ["finance", "operations", "campaigns"].includes(dimension.id))
      .map((dimension) => [dimension.id, dimension.confidence])
  );
  const missingData = dimensions.flatMap((dimension) =>
    dimension.score == null || dimension.confidence < 80
      ? dimension.reasonCodes.map((reason) => `${dimension.label}: ${executivePulseReasonLabel(reason)}`)
      : []
  );
  const allScored = dimensions.every((dimension) => dimension.score != null);
  const canShow =
    !entitySplitRequired &&
    allScored &&
    totalConfidence >= 75 &&
    Number(criticalConfidence.finance || 0) >= 80 &&
    Number(criticalConfidence.operations || 0) >= 80 &&
    Number(criticalConfidence.campaigns || 0) >= 80;

  const weightedScore = canShow
    ? Math.round(dimensions.reduce((sum, dimension) => sum + dimension.weight * Number(dimension.score), 0) / 100)
    : null;

  return {
    overallScore: weightedScore,
    totalConfidence,
    status: entitySplitRequired ? "ENTITY_SPLIT_REQUIRED" : canShow ? "AVAILABLE" : "INSUFFICIENT_DATA",
    message: entitySplitRequired
      ? "Scorul general se afișează separat pentru fiecare entitate."
      : canShow
        ? "Scor general calculat din sursele canonice disponibile."
        : "Date insuficiente pentru un scor general",
    missingData: [...new Set(missingData)],
    dimensions,
    trend: {
      direction: "UNAVAILABLE",
      delta: null,
      confidence: 0,
      label: "Istoricul canonic nu permite încă reconstruirea aceluiași scor pentru perioada anterioară."
    },
    mainFactors: dimensions
      .flatMap((dimension) => dimension.negativeReasons.map((reason) => ({
        id: `${dimension.id}:${reason}`,
        label: `${dimension.label}: ${executivePulseReasonLabel(reason)}`,
        count: 1,
        tone: "warning" as const,
        href: dimension.href
      })))
      .slice(0, 4)
  };
}
