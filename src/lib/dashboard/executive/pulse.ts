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
      ? dimension.reasonCodes.map((reason) => `${dimension.label}: ${reason}`)
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
    dimensions
  };
}
