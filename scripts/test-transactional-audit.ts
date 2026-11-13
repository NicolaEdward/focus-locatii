import assert from "node:assert/strict";
import { recordTransactionalAudit, safeAuditMetadata } from "../src/lib/transactional-audit";

async function main() {
  const error = new Error("synthetic audit persistence failure");
  await assert.rejects(recordTransactionalAudit({ auditLog: { create: async () => { throw error; } } } as never,
    { action: "synthetic.change", entityType: "synthetic" }), (caught) => caught === error);
  const clean = safeAuditMetadata({ password: "private", nested: { accessToken: "private", amount: 12 }, when: new Date("2026-01-01"), ok: true });
  assert.equal(JSON.stringify(clean).includes("private"), false);
  assert.equal((clean as Record<string, unknown>).ok, true);
  let saved: unknown;
  await recordTransactionalAudit({ auditLog: { create: async (input: unknown) => { saved = input; return input; } } } as never,
    { actor: { id: "synthetic-user", role: "COO" }, action: "synthetic.commit", entityType: "synthetic", entityId: "synthetic-row", correlationId: "synthetic-request" });
  assert.equal((saved as { data: { userId: string } }).data.userId, "synthetic-user");
  console.log("Transactional audit contract passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
