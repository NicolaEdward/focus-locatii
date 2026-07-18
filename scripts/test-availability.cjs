const path = require("path");
const { loadTsModule } = require("./load-ts-module.cjs");
const { calculateAvailability, decideAvailability } = loadTsModule(path.join(process.cwd(), "src", "lib", "availability.ts"));

const cases = [
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
    name: "status legacy necunoscut nu suprascrie disponibilitatea derivata",
    input: { status: "UNKNOWN", reservations: [] },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "AVAILABLE",
    expectedLabelIncludes: "Disponibila"
  },
  {
    name: "lifecycle inactiv suspenda disponibilitatea",
    input: { status: "AVAILABLE", lifecycleStatus: "INACTIVE", reservations: [] },
    from: "2026-06-01",
    to: "2026-07-31",
    expectedStatus: "SUSPENDED",
    expectedLabelIncludes: "Locatie inactiva"
  },
  {
    name: "blocaj comercial legacy blocheaza perioada",
    input: {
      status: "AVAILABLE",
      blockedReason: "Reparatie fatada",
      blockedFrom: "2026-06-01",
      blockedUntil: "2026-06-30",
      reservations: []
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "UNAVAILABLE",
    expectedLabelIncludes: "Ocupata"
  },
  {
    name: "override manual blocheaza perioada",
    input: {
      status: "AVAILABLE",
      availabilityOverrides: [{
        type: "MAINTENANCE",
        reason: "Interventie",
        periodStart: "2026-06-15",
        periodEnd: "2026-06-20"
      }],
      reservations: []
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "PARTIAL",
    expectedLabelIncludes: "Disponibila"
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
  },
  {
    name: "booked fara client/campanie blocheaza",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "BOOKED", periodStart: "2026-06-01", periodEnd: "2026-06-30" }]
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "UNAVAILABLE",
    expectedLabelIncludes: "Ocupata"
  },
  {
    name: "cancelled si archived nu blocheaza",
    input: {
      status: "AVAILABLE",
      reservations: [
        { status: "CANCELLED", periodStart: "2026-06-01", periodEnd: "2026-06-30" },
        { status: "ARCHIVED", periodStart: "2026-06-01", periodEnd: "2026-06-30" }
      ]
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "AVAILABLE",
    expectedLabelIncludes: "Disponibila"
  },
  {
    name: "perioada fara suprapunere ramane disponibila",
    input: {
      status: "AVAILABLE",
      reservations: [{ status: "BOOKED", periodStart: "2026-08-01", periodEnd: "2026-08-31" }]
    },
    from: "2026-06-01",
    to: "2026-06-30",
    expectedStatus: "AVAILABLE",
    expectedLabelIncludes: "Disponibila"
  }
];

for (const testCase of cases) {
  const result = calculateAvailability(testCase.input, testCase.from, testCase.to);
  assert(result.status === testCase.expectedStatus, `${testCase.name}: expected ${testCase.expectedStatus}, got ${result.status}`);
  assert(
    result.label.includes(testCase.expectedLabelIncludes),
    `${testCase.name}: expected label to include "${testCase.expectedLabelIncludes}", got "${result.label}"`
  );
}

const now = new Date("2026-07-18T12:00:00.000Z");
const canonicalCases = [
  {
    name: "BOOKED overlap respins",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-01", periodEnd: "2026-08-10", now, reservations: [{ id: "booked", status: "BOOKED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now }] },
    expected: "CONFLICT"
  },
  {
    name: "HOLD activ respins",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-01", periodEnd: "2026-08-10", now, reservations: [{ id: "hold", status: "RESERVED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now, holdExpiresAt: "2026-07-20T12:00:00.000Z" }] },
    expected: "CONFLICT"
  },
  {
    name: "HOLD expirat permis",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-01", periodEnd: "2026-08-10", now, reservations: [{ id: "expired-hold", status: "RESERVED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now, holdExpiresAt: "2026-07-18T11:59:59.000Z" }] },
    expected: "AVAILABLE"
  },
  {
    name: "override activ blocheaza",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-01", periodEnd: "2026-08-10", now, availabilityOverrides: [{ id: "override", type: "COMMERCIAL_BLOCK", reason: "Blocaj", periodStart: "2026-08-01", periodEnd: "2026-08-10" }] },
    expected: "BLOCKED"
  },
  {
    name: "editarea exclude recordul curent",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-01", periodEnd: "2026-08-10", now, ignoreReservationId: "same", reservations: [{ id: "same", status: "BOOKED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now }] },
    expected: "AVAILABLE"
  },
  {
    name: "aceeasi zi este suprapunere inclusiva",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-10", periodEnd: "2026-08-12", now, reservations: [{ id: "inclusive", status: "BOOKED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now }] },
    expected: "PARTIAL"
  },
  {
    name: "ziua urmatoare nu se suprapune",
    input: { lifecycleStatus: "ACTIVE", periodStart: "2026-08-11", periodEnd: "2026-08-12", now, reservations: [{ id: "adjacent", status: "BOOKED", periodStart: "2026-08-01", periodEnd: "2026-08-10", createdAt: now }] },
    expected: "AVAILABLE"
  }
];

for (const testCase of canonicalCases) {
  const result = decideAvailability(testCase.input);
  assert(result.status === testCase.expected, `${testCase.name}: expected ${testCase.expected}, got ${result.status}`);
  assert(result.dateSemantics === "INCLUSIVE", `${testCase.name}: date semantics must remain inclusive`);
  assert(result.isBookable === (testCase.expected === "AVAILABLE"), `${testCase.name}: isBookable mismatch`);
}

console.log(JSON.stringify({ ok: true, checked: [...cases, ...canonicalCases].map((testCase) => testCase.name) }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
