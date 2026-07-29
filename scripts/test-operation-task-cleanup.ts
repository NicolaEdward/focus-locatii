import assert from "node:assert/strict";
import { staleDecorationTaskDecision } from "../src/lib/operation-task-cleanup";

const now = new Date("2026-07-29T12:00:00.000Z");
const eligible = {
  kind: "DECORATION",
  status: "NEW",
  source: "SYSTEM_DERIVED",
  scheduledFor: new Date("2026-01-01T00:00:00.000Z"),
  completedAt: null,
  assignedToUserId: null,
  createdAt: new Date("2026-06-26T00:00:00.000Z"),
  activeProofCount: 0
};

assert.equal(staleDecorationTaskDecision(eligible, now).eligible, true);
assert.equal(
  staleDecorationTaskDecision({ ...eligible, status: "IN_PROGRESS" }, now).reason,
  "NOT_NEW"
);
assert.equal(
  staleDecorationTaskDecision({ ...eligible, source: "MANUAL" }, now).reason,
  "NOT_SYSTEM_DERIVED"
);
assert.equal(
  staleDecorationTaskDecision({ ...eligible, assignedToUserId: "field-1" }, now).reason,
  "ASSIGNED"
);
assert.equal(
  staleDecorationTaskDecision({ ...eligible, activeProofCount: 1 }, now).reason,
  "HAS_ACTIVE_PROOF"
);
assert.equal(
  staleDecorationTaskDecision(
    { ...eligible, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    now
  ).reason,
  "NOT_RETROACTIVE"
);
assert.equal(
  staleDecorationTaskDecision(
    { ...eligible, scheduledFor: new Date("2026-07-01T00:00:00.000Z") },
    now
  ).reason,
  "NOT_OLD_ENOUGH"
);

console.log(
  JSON.stringify(
    {
      passed: 7,
      policy: "Only old, retroactively materialized, unassigned, proof-free NEW system decorations are eligible."
    },
    null,
    2
  )
);
