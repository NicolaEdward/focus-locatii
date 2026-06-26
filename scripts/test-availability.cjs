const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(process.cwd(), "src", "lib", "availability.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  }
}).outputText;

const sandbox = {
  exports: {},
  require,
  console,
  Intl,
  Date,
  Number,
  String,
  Boolean,
  Array,
  JSON,
  RegExp,
  Math
};
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(transpiled, sandbox, { filename: sourcePath });

const { calculateAvailability } = sandbox.module.exports;

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
    expectedLabelIncludes: "pana la data de 01.07.2026"
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
    expectedLabelIncludes: "din data de 30.06.2026"
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
    expectedLabelIncludes: "din data de 10.06.2026 pana la data de 01.07.2026"
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

console.log(JSON.stringify({ ok: true, checked: cases.map((testCase) => testCase.name) }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
