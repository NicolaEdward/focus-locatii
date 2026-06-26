const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const sourcePath = path.join(process.cwd(), "src", "lib", "prorata.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  }
}).outputText;

const sandbox = { exports: {}, require, console, Date, Number, Math };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(transpiled, sandbox, { filename: sourcePath });

const { calculateProrata } = sandbox.module.exports;

const cases = [
  {
    name: "luna completa",
    args: [1000, "2026-06-01", "2026-06-30", "2026-06-01", "2026-06-30"],
    expected: 1000
  },
  {
    name: "a doua jumatate a lunii",
    args: [1000, "2026-06-15", "2026-06-30", "2026-06-01", "2026-06-30"],
    expected: 533.33
  },
  {
    name: "prima jumatate a lunii",
    args: [1000, "2026-06-01", "2026-06-15", "2026-06-01", "2026-06-30"],
    expected: 500
  },
  {
    name: "perioada peste doua luni",
    args: [1000, "2026-06-15", "2026-07-14", "2026-06-01", "2026-07-31"],
    expected: 984.94
  },
  {
    name: "februarie an bisect",
    args: [2900, "2028-02-15", "2028-02-29", "2028-02-01", "2028-02-29"],
    expected: 1500
  },
  {
    name: "fara suprapunere",
    args: [1000, "2026-07-01", "2026-07-31", "2026-06-01", "2026-06-30"],
    expected: 0
  },
  {
    name: "data calendaristica invalida",
    args: [1000, "2026-02-31", "2026-03-31", "2026-02-01", "2026-03-31"],
    expected: 0
  }
];

for (const testCase of cases) {
  const result = calculateProrata(...testCase.args);
  assert(result.amount === testCase.expected, `${testCase.name}: expected ${testCase.expected}, got ${result.amount}`);
}

console.log(JSON.stringify({ ok: true, checked: cases.map((testCase) => testCase.name) }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
