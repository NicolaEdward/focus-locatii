const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("src/lib/receivables-workspace-service.ts");
const component = read("src/components/admin/ReceivablesWorkspace.tsx");
const page = read("src/app/admin/financiar/incasari/page.tsx");
const registryRoute = read("src/app/api/admin/receivables-workspace/registry/route.ts");
const reconciliationRoute = read("src/app/api/admin/receivables-workspace/reconciliation/route.ts");

assert.match(service, /remainingAmount:\s*\{ gt: SETTLED_TOLERANCE \}/, "default registry must contain only open balances");
assert.match(service, /remainingAmount:\s*\{ lte: SETTLED_TOLERANCE \}/, "settled invoices must remain available in history");
assert.match(service, /groupBy\(\{ by: \["currency"\]/, "summary must aggregate by currency in the database");
assert.match(service, /skip: \(page - 1\) \* take/);
assert.match(service, /take\s*$/m);
assert.doesNotMatch(service, /take:\s*5_?000/, "workspace must not hydrate thousands of options");
assert.match(service, /archived_legacy_snapshot/);
assert.match(service, /import_anomaly/);
assert.match(service, /manual_correction/);
assert.match(service, /readOnly:\s*true/);
assert.doesNotMatch(service, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/, "reconciliation service must be read-only");

assert.match(component, /De încasat/);
assert.match(component, /Istoric facturi/);
assert.match(component, /Facturile achitate rămân disponibile în istoric/);
assert.match(component, /separată de activitatea curentă și de KPI-urile operaționale/);
assert.doesNotMatch(component, /InvoiceMetric label="Încasat"/, "collected totals must not dominate operational statistics");
assert.doesNotMatch(component, /window\.(prompt|confirm)/);
assert.match(component, /api\(`\/api\/admin\/receivables-workspace\/\$\{endpoint\}/, "secondary tabs must load lazily");
assert.match(component, /options\?type=/, "large allocation options must load contextually");
assert.match(component, /Plățile manuale existente rămân sursa prioritară/);

assert.match(page, /listReceivableRegistry/);
assert.match(page, /take:\s*40/);
assert.match(registryRoute, /requireAnyPermission/);
assert.match(reconciliationRoute, /\["finance\.manage"\]/, "legacy reconciliation is restricted to global finance managers");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "open invoices excluded from settled history",
    "settled invoices excluded from operational KPIs",
    "currency-separated DB aggregates",
    "server pagination and contextual options",
    "explicit dialogs without browser prompts",
    "read-only classified reconciliation",
    "finance manager reconciliation RBAC"
  ]
}, null, 2));
