import type {
  OperationCutoverCase,
  OperationCutoverHumanDecision,
  OperationCutoverReview
} from "@/lib/dashboard/executive/operation-task-cutover-contracts";
import {
  createStyledWorkbook,
  XLSX_STYLES,
  type StyledSheet
} from "@/lib/styled-xlsx";

const CASE_HEADERS = [
  "stableCaseId",
  "priority",
  "companyEntity",
  "campaignId",
  "campaignName",
  "client",
  "locationId",
  "locationCode",
  "reservationId",
  "relatedReservationId",
  "operationTaskId",
  "campaignStart",
  "campaignEnd",
  "taskType",
  "taskStatus",
  "scheduledFor",
  "completedAt",
  "mediaClassification",
  "anomalyCodes",
  "proposedClassification",
  "proposedAction",
  "confidence",
  "dataCompleteness",
  "evidence",
  "risk",
  "humanDecision",
  "reviewerNotes"
] as const;

const HUMAN_DECISIONS: OperationCutoverHumanDecision[] = [
  "APPROVE_PROPOSAL",
  "REJECT_PROPOSAL",
  "NEEDS_INFORMATION",
  "KEEP_AS_LEGACY",
  "EXCLUDE_FROM_CURRENT_METRICS",
  "LINK_TO_EXISTING_ENTITY",
  "CREATE_MISSING_TASK",
  "NO_OPERATION_REQUIRED"
];

export function createOperationTaskHumanReviewWorkbook(review: OperationCutoverReview) {
  const cases = review.cases;
  const sheets: StyledSheet[] = [
    summarySheet(review),
    caseSheet("Critical Current", cases.filter((row) => row.priority === "CRITICAL_CURRENT")),
    caseSheet("Deterministic", cases.filter((row) => row.reviewGroup === "DETERMINISTIC")),
    caseSheet("Human Review", cases.filter((row) => row.reviewGroup === "HUMAN_REVIEW")),
    caseSheet("Legacy Excluded", cases.filter((row) => row.reviewGroup === "LEGACY_EXCLUDED")),
    caseSheet("Missing Proof", cases.filter((row) => row.anomalyCodes.some((code) => code.includes("PROOF")))),
    caseSheet("Impossible Dates", cases.filter((row) => row.anomalyCodes.some(isImpossibleDateCode))),
    matrixSheet(review),
    batchSheet(review),
    decisionDictionarySheet()
  ];
  return createStyledWorkbook(sheets);
}

function summarySheet(review: OperationCutoverReview): StyledSheet {
  const rows: StyledSheet["rows"] = [
    [{ value: "OperationTask Human Review Pack", style: XLSX_STYLES.title }],
    ["Contract", review.contractVersion],
    ["Cazuri de decizie", review.summary.decisionCases],
    ["Constatări suprapuse", review.summary.findingOccurrences],
    ["Taskuri distincte", review.summary.distinctTasks],
    ["Rezervări distincte", review.summary.distinctReservations],
    ["Campanii distincte", review.summary.distinctCampaigns],
    ["Locații distincte", review.summary.distinctLocations],
    [],
    [{ value: "Categorie", style: XLSX_STYLES.header }, { value: "Count", style: XLSX_STYLES.header }]
  ];
  for (const [label, count] of Object.entries(review.summary.byReviewGroup)) rows.push([label, count]);
  rows.push([], [{ value: "Prioritate", style: XLSX_STYLES.header }, { value: "Count", style: XLSX_STYLES.header }]);
  for (const [label, count] of Object.entries(review.summary.byPriority)) rows.push([label, count]);
  rows.push(
    [],
    ["Notă", "Acest fișier este un dry-run read-only. Coloanele humanDecision și reviewerNotes nu sunt importate în aplicație în Etapa 3B."]
  );
  return { name: "Summary", rows, columns: [{ width: 32 }, { width: 92 }], freezeRows: 1 };
}

function caseSheet(name: string, rows: OperationCutoverCase[]): StyledSheet {
  return {
    name,
    rows: [
      CASE_HEADERS.map((value) => ({ value, style: XLSX_STYLES.header })),
      ...rows.map(caseRow)
    ],
    columns: CASE_HEADERS.map((header) => ({ width: caseColumnWidth(header) })),
    freezeRows: 1,
    autoFilter: rows.length
      ? { startRow: 1, startCol: 1, endRow: rows.length + 1, endCol: CASE_HEADERS.length }
      : undefined
  };
}

function caseRow(row: OperationCutoverCase) {
  const values: Record<(typeof CASE_HEADERS)[number], string | number> = {
    stableCaseId: row.stableCaseId,
    priority: row.priority,
    companyEntity: row.companyEntity,
    campaignId: row.campaignId || "",
    campaignName: row.campaignName || "",
    client: row.client || "",
    locationId: row.locationId || "",
    locationCode: row.locationCode || "",
    reservationId: row.reservationId || "",
    relatedReservationId: row.relatedReservationId || "",
    operationTaskId: row.operationTaskId || "",
    campaignStart: row.campaignStart || "",
    campaignEnd: row.campaignEnd || "",
    taskType: row.taskType,
    taskStatus: row.taskStatus,
    scheduledFor: row.scheduledFor || "",
    completedAt: row.completedAt || "",
    mediaClassification: row.mediaClassification,
    anomalyCodes: row.anomalyCodes.join(" | "),
    proposedClassification: row.proposedClassification,
    proposedAction: row.proposedAction,
    confidence: row.confidence,
    dataCompleteness: row.dataCompleteness,
    evidence: row.evidence.map((item) => `${item.label}: ${item.value}`).join(" | "),
    risk: row.risk,
    humanDecision: row.humanDecision,
    reviewerNotes: row.reviewerNotes
  };
  return CASE_HEADERS.map((header) => values[header]);
}

function matrixSheet(review: OperationCutoverReview): StyledSheet {
  const headers = ["Tip locație", "Exemple coduri", "Număr locații", "Clasificare", "Operațiune start", "Operațiune final", "Tipuri existente", "Confidence", "Date lipsă"];
  return {
    name: "Static-Digital Matrix",
    rows: [
      headers.map((value) => ({ value, style: XLSX_STYLES.header })),
      ...review.mediaMatrix.map((row) => [
        row.locationType,
        row.exampleCodes.join(", "),
        row.locationCount,
        row.classification,
        row.startOperation,
        row.endOperation,
        row.existingTaskTypes.join(", "),
        row.confidence,
        row.missingData.join(" | ")
      ])
    ],
    columns: headers.map((_, index) => ({ width: index >= 4 ? 48 : 24 })),
    freezeRows: 1
  };
}

function batchSheet(review: OperationCutoverReview): StyledSheet {
  const headers = ["Lot", "Denumire", "Cazuri", "Constatări", "Criterii", "Mutație viitoare", "Validare", "Risc", "Rollback", "Efect assignment", "Efect Pulse", "Efect alerte", "Execuție aprobată"];
  return {
    name: "Proposed Batches",
    rows: [
      headers.map((value) => ({ value, style: XLSX_STYLES.header })),
      ...review.remediationBatches.map((row) => [
        row.id,
        row.label,
        row.caseCount,
        row.findingCount,
        row.criteria,
        row.futureMutation,
        row.validation,
        row.risk,
        row.rollback,
        row.expectedAssignmentEffect,
        row.expectedPulseEffect,
        row.expectedAlertsEffect,
        "NU"
      ])
    ],
    columns: headers.map((_, index) => ({ width: index < 4 ? 18 : 48 })),
    freezeRows: 1
  };
}

function decisionDictionarySheet(): StyledSheet {
  return {
    name: "Decision Dictionary",
    rows: [
      [
        { value: "humanDecision", style: XLSX_STYLES.header },
        { value: "Semnificație", style: XLSX_STYLES.header }
      ],
      ...HUMAN_DECISIONS.map((value) => [value, humanDecisionMeaning(value)])
    ],
    columns: [{ width: 38 }, { width: 88 }],
    freezeRows: 1
  };
}

function humanDecisionMeaning(value: OperationCutoverHumanDecision) {
  const meanings: Record<OperationCutoverHumanDecision, string> = {
    APPROVE_PROPOSAL: "Propunerea tehnică este acceptată pentru un viitor lot controlat.",
    REJECT_PROPOSAL: "Propunerea este respinsă; datele rămân nemodificate.",
    NEEDS_INFORMATION: "Sunt necesare dovezi sau date suplimentare.",
    KEEP_AS_LEGACY: "Cazul rămâne istoric, accesibil pentru audit.",
    EXCLUDE_FROM_CURRENT_METRICS: "Cazul nu intră în KPI-urile curente după aprobarea politicii.",
    LINK_TO_EXISTING_ENTITY: "Reviewerul indică o legătură canonică existentă.",
    CREATE_MISSING_TASK: "Reviewerul aprobă propunerea de creare într-un lot ulterior.",
    NO_OPERATION_REQUIRED: "Nu este necesară o operațiune pentru obligația verificată."
  };
  return meanings[value];
}

function isImpossibleDateCode(code: string) {
  return [
    "SCHEDULED_FOR_MISSING",
    "COMPLETED_BEFORE_CREATED",
    "COMPLETED_BEFORE_SCHEDULED",
    "DONE_WITHOUT_COMPLETED_AT",
    "NON_DONE_WITH_COMPLETED_AT",
    "DECORATION_AFTER_BOOKED_END",
    "NEUTRALIZATION_BEFORE_BOOKED_START",
    "TASK_CREATED_BEFORE_BOOKED",
    "TASK_CREATED_AFTER_BOOKED_END",
    "RESERVATION_INTERVAL_REVERSED",
    "TASK_DATE_INCONSISTENT"
  ].includes(code);
}

function caseColumnWidth(header: (typeof CASE_HEADERS)[number]) {
  if (["proposedAction", "evidence", "risk", "reviewerNotes"].includes(header)) return 58;
  if (["anomalyCodes", "campaignName", "client"].includes(header)) return 34;
  if (header.endsWith("Id")) return 30;
  return 20;
}
