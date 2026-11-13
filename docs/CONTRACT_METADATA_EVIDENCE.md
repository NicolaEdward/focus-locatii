# Missing contractual reference correction

`src/lib/contract-metadata-evidence.ts` is an internal helper for the reviewed
27 October 2026 contractual summary. It only fills a null or blank reservation
`contractNumber`. It has no endpoint, scheduler or automatic activation. It never
changes price, period, location, status, client, campaign, grouping or ownership.
Prisma updates the row's `updatedAt`; no other reservation field is written.

The caller must approve the database target and exact private manifest hash.
Use `hashContractMetadataOperation` during manifest preparation, and retain that
approved hash for execution. `verifyContractMetadataSource` verifies the exact
original DOCX bytes by SHA-256 and ZIP header, yielding an opaque token. The
external reviewed manifest proves the extracted cell/number and associations;
the helper does not claim that any linked contract was signed or independently
reparse Word tables. No private source data belongs in git.

```ts
const source = verifyContractMetadataSource({ bytes: originalDocx, expectedHash });
const result = await client.$transaction(
  tx => applyContractMetadataOperation(tx, reviewedOperation, {
    mode: "check", manifestHash, approvedOperationHash, runId, source
  }),
  contractMetadataTransactionOptions
);
```

The strict operation schema accepts only the reviewed missing-reference command,
expected row version/identity/period and explicit source provenance. It uses the
private manifest's field names. The source snapshot date is fixed to 2026-10-27;
this is not a generic historical-data migration tool.

After locking the reservation, the helper checks exact `updatedAt`, location,
client, campaign, contract group, legal entity, BOOKED status and period. The
reservation and campaign must both agree with the source legal entity; the
current location code must agree with the explicit source code. Existing
contract numbers, archived/merged clients, rows created/updated after the
snapshot, and later price-segment/change-log evidence all prevent correction.

`check` performs those reads/locks and returns `wouldUpdate:1` without any DML,
audit or history entry. Apply repeats the checks. It commits the missing field,
a truthful `RentalChangeLog` and durable transactional audit together, with
`userId:null`, SYSTEM attribution, source DOCX hash, cell anchor, source snapshot,
manifest/operation hashes and run ID. A source+reservation receipt prevents
duplicate effects; a different payload for the same intention is rejected.

Run `ENV_FILE=.env.implementation.local tsx scripts/test-contract-metadata-evidence.ts`
only against the dedicated local synthetic MySQL database
`focus_preview_bank_evidence`. Tests cover zero-write checks, source/approval
guards, rollback, concurrent replay, unchanged commercial fields, newer evidence,
legal-entity inconsistency and refusal to overwrite an existing reference.
