import { calculateAvailability } from "../src/lib/availability";

type Case = {
  name: string;
  input: Parameters<typeof calculateAvailability>[0];
  from: string;
  to: string;
  expectedStatus: ReturnType<typeof calculateAvailability>["status"];
  expectedLabelIncludes?: string;
};

const cases: Case[] = [
  {
    name: "locatie complet libera",
    input: { status: "AVAILABLE", reservations: [] },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "AVAILABLE",
    expectedLabelIncludes: "Disponibila"
  },
  {
    name: "locatie ocupata complet",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-07-31" }]
    },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "UNAVAILABLE",
    expectedLabelIncludes: "Ocupata"
  },
  {
    name: "locatie libera doar la inceput",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "BOOKED", periodStart: "2026-07-01", periodEnd: "2026-07-31" }]
    },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "PARTIAL",
    expectedLabelIncludes: "pana la data de 30.06.2026"
  },
  {
    name: "locatie libera doar la final",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-06-30" }]
    },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "PARTIAL",
    expectedLabelIncludes: "din data de 01.07.2026"
  },
  {
    name: "locatie libera intre doua inchirieri",
    input: {
      status: "AVAILABLE",
      reservations: [
        { status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-06-10" },
        { status: "BOOKED", periodStart: "2026-07-01", periodEnd: "2026-07-31" }
      ]
    },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "PARTIAL",
    expectedLabelIncludes: "din data de 11.06.2026 pana la data de 30.06.2026"
  },
  {
    name: "locatie suspendata",
    input: { status: "UNKNOWN", reservations: [] },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "SUSPENDED",
    expectedLabelIncludes: "Suspendata"
  },
  {
    name: "rezervare suprapusa cu perioada ceruta",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "RESERVED", periodStart: "2026-06-15", periodEnd: "2026-06-20" }]
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "PARTIAL",
    expectedLabelIncludes: "Disponibila"
  }
];

for (const testCase of cases) {
  const result = calculateAvailability(testCase.input, testCase.from, testCase.to);
  assert(result.status === testCase.expectedStatus, `${testCase.name}: expected ${testCase.expectedStatus}, got ${result.status}`);
  if (testCase.expectedLabelIncludes) {
    assert(
      result.label.includes(testCase.expectedLabelIncludes),
      `${testCase.name}: expected label to include "${testCase.expectedLabelIncludes}", got "${result.label}"`
    );
  }
}

console.log(JSON.stringify({ ok: true, checked: cases.map((testCase) => testCase.name) }, null, 2));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
