export const OPERATIONAL_NEUTRALIZATION_SLA = {
  planningBusinessDaysBeforeEnd: numberSetting("OPERATIONAL_NEUTRALIZATION_PLANNING_BUSINESS_DAYS", 3),
  executionHoursAfterEnd: numberSetting("OPERATIONAL_NEUTRALIZATION_EXECUTION_HOURS", 24)
} as const;

export type OperationalRequirementDecision = {
  medium: "STATIC" | "DIGITAL" | "UNKNOWN";
  requiredKinds: Array<"DECORATION" | "NEUTRALIZATION">;
  proofRequirement: "PHOTO" | "EXISTING_DIGITAL_EVIDENCE" | "DATA_INSUFFICIENT";
  reasonCodes: string[];
};

export function operationalRequirementForBooked(input: {
  reservationStatus: string;
  locationType?: string | null;
}): OperationalRequirementDecision {
  if (input.reservationStatus !== "BOOKED") {
    return { medium: "UNKNOWN", requiredKinds: [], proofRequirement: "DATA_INSUFFICIENT", reasonCodes: ["NON_BOOKED_NO_OBLIGATION"] };
  }
  const type = String(input.locationType || "").trim().toLowerCase();
  if (!type) {
    return { medium: "UNKNOWN", requiredKinds: [], proofRequirement: "DATA_INSUFFICIENT", reasonCodes: ["LOCATION_MEDIUM_UNKNOWN"] };
  }
  if (/(digital|led|ecran|screen|lcd)/i.test(type)) {
    return {
      medium: "DIGITAL",
      requiredKinds: [],
      proofRequirement: "DATA_INSUFFICIENT",
      reasonCodes: ["DIGITAL_OPERATION_KIND_NOT_CANONICAL_IN_CURRENT_ENUM"]
    };
  }
  return {
    medium: "STATIC",
    requiredKinds: ["DECORATION", "NEUTRALIZATION"],
    proofRequirement: "PHOTO",
    reasonCodes: ["STATIC_OOH_REQUIRES_INSTALL_AND_NEUTRALIZATION"]
  };
}

export function proofContractForOperation(input: {
  operationKind: string;
  documentType?: string | null;
  linkedToTaskOrReservation: boolean;
}) {
  const physical = ["DECORATION", "NEUTRALIZATION", "MAINTENANCE"].includes(input.operationKind);
  if (!physical) return { satisfied: false, state: "DATA_INSUFFICIENT" as const };
  return {
    satisfied: input.documentType === "operational_proof_photo" && input.linkedToTaskOrReservation,
    state: input.documentType === "operational_proof_photo" && input.linkedToTaskOrReservation
      ? "SATISFIED" as const
      : "MISSING" as const
  };
}

function numberSetting(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
