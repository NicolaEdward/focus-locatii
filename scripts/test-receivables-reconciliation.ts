import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { classifyReceivableReconciliation } from "../src/lib/receivables-workspace-service";

const base = {
  includedInReport: true,
  status: "open",
  paymentCount: 0,
  importRowCount: 0,
  lastImportedAt: null,
  sources: [] as string[]
};

assert.equal(classifyReceivableReconciliation({ ...base, difference: new Prisma.Decimal("0.01") }), "expected_by_active_ledger");
assert.equal(classifyReceivableReconciliation({ ...base, difference: new Prisma.Decimal("12.50"), sources: ["manual"] }), "manual_correction");
assert.equal(classifyReceivableReconciliation({ ...base, difference: new Prisma.Decimal("50"), includedInReport: false, status: "archived" }), "archived_legacy_snapshot");
assert.equal(classifyReceivableReconciliation({ ...base, difference: new Prisma.Decimal("50"), importRowCount: 1 }), "import_anomaly");
assert.equal(classifyReceivableReconciliation({ ...base, difference: new Prisma.Decimal("50") }), "unresolved");

console.log("Receivables reconciliation classification tests passed.");
