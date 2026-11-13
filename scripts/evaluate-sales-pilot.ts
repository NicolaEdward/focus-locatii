/** Offline scored evidence; no network, database, provider calls or commercial effects. */
import fs from "node:fs";
import { z } from "zod";
import {
  commercialHash,
  summarizePilot,
} from "../src/lib/commercial-workbench-core";
const fact = z
  .object({
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .strict();
const entry = z
  .object({
    id: z.string().min(1),
    arm: z.enum(["human", "assisted"]),
    companyKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewer: z.string().min(1),
    evidenceReference: z.string().min(5),
    sourceFacts: z.array(fact),
    claims: z.array(
      z.object({ factKey: z.string(), value: fact.shape.value }).strict(),
    ),
    availabilityActuallyFree: z.boolean(),
    availabilityPromised: z.boolean(),
    expectedTotal: z.string().regex(/^\d+\.\d{2}$/),
    proposedTotal: z.string().regex(/^\d+\.\d{2}$/),
    commercialEffectAuthorized: z.boolean(),
    commercialEffectOccurred: z.boolean(),
    humanMinutes: z.number().nonnegative(),
    reworkMinutes: z.number().nonnegative(),
    modelCost: z.number().nonnegative(),
    matured: z.boolean(),
    booked: z.boolean(),
    paidAmount: z.number().nonnegative(),
    verifiedMargin: z.number().nullable(),
    complaints: z.number().int().nonnegative(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    synthetic: z.boolean(),
    costCurrency: z.enum(["RON", "EUR"]),
    cases: z.array(entry).max(100000),
  })
  .strict();
const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error(
    "Usage: pnpm exec tsx scripts/evaluate-sales-pilot.ts path/to/evidence.json",
  );
const input = schema.parse(JSON.parse(fs.readFileSync(sourcePath, "utf8")));
const assignments = new Map<string, string>();
for (const item of input.cases) {
  const arm = assignments.get(item.companyKeyHash);
  if (arm && arm !== item.arm)
    throw new Error("A company cannot be assigned to both cohorts.");
  assignments.set(item.companyKeyHash, item.arm);
}
const details = input.cases.map((item) => {
  const supported = item.claims.filter((claim) =>
    item.sourceFacts.some(
      (source) =>
        source.key === claim.factKey &&
        commercialHash(source.value) === commercialHash(claim.value),
    ),
  ).length;
  return {
    id: item.id,
    arm: item.arm,
    evidenceReference: item.evidenceReference,
    reviewed: true,
    matureAt: item.matured ? new Date(0) : null,
    metrics: {
      humanMinutes: item.humanMinutes,
      reworkMinutes: item.reworkMinutes,
      modelCost: item.modelCost,
      totalClaims: item.claims.length,
      validSources: supported,
      calculationErrors: item.expectedTotal === item.proposedTotal ? 0 : 1,
      availabilityErrors:
        item.availabilityPromised && !item.availabilityActuallyFree ? 1 : 0,
      unauthorizedEffects:
        item.commercialEffectOccurred && !item.commercialEffectAuthorized
          ? 1
          : 0,
      booked: item.booked,
      paidAmount: item.paidAmount,
      verifiedMargin: item.verifiedMargin,
      complaints: item.complaints,
    },
  };
});
const arms = summarizePilot(details),
  stopRequired = arms.some((arm) => arm.stopRequired);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      inputHash: commercialHash(input),
      synthetic: input.synthetic,
      currency: input.costCurrency,
      scoredBy: "deterministic-evidence-v1",
      source: "human-reviewed-file-not-independently-verified",
      cases: details,
      arms,
      stopRequired,
      replacementDecision: "NOT_ESTABLISHED",
      limitations: [
        input.synthetic
          ? "Synthetic evaluator self-test; no commercial performance measured."
          : "Imported evidence requires source verification and preregistered cohort and maturity checks.",
        "No provider, customer or database was contacted.",
        "No inference of seller replacement or causal revenue improvement.",
      ],
    },
    null,
    2,
  ),
);
