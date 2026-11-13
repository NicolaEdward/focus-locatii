# Reviewed bank evidence executor

`src/lib/bank-evidence-executor.ts` is an internal transaction helper. It has no
HTTP route, production CLI, scheduler or automatic activation. It only inserts
reviewed bank rows into an existing verified account. It does not create or edit
accounts, refresh existing transactions, link invoices, create payments or alter
allocations.

The caller must independently approve the target database, validate the complete
reviewed manifest hash and source hashes, and use one transaction per operation.
An approved operation hash is an execution precondition, not a substitute for
that authorization boundary. Never fabricate a human session or MFA claim.

```ts
const source = verifyBankEvidenceSource({
  bytes: originalFileBytes,
  fileName: originalFileName,
  expectedHash: operation.sourceHash,
  companyCode: operation.companyCode
});
const result = await client.$transaction(
  tx => applyBankEvidenceOperation(tx, operation, {
    mode: "check", // change to "apply" only for the exact reviewed manifest
    manifestHash: verifiedManifestHash,
    approvedOperationHash: reviewedOperationHash,
    runId,
    source
  }),
  bankEvidenceTransactionOptions
);
```

Compute `reviewedOperationHash` with `hashBankEvidenceOperation` while preparing
the reviewed manifest. Do not recompute an altered operation's approval hash at
execution time. Object key order and selected row order do not change the hash.
The operation schema is strict: source identity, a technical operation ID,
expected existing account/version, full source account window/balances, and
explicit `(rowNumber, fingerprint)` references. The original CSV is reparsed;
the operation cannot supply transaction descriptions, classification or ORM data.
The verified source is an in-memory opaque token and cannot be reconstructed
from JSON. Revolut's company selection must already be supported by reviewed
account ownership evidence; its CSV does not independently verify the holder.

`check` takes locks and reads authoritative state with the same guards as apply,
then returns `applied:false`, `created:0`, `wouldCreate` and `duplicates`. It
performs no business or audit writes. It is not a reservation of future state:
apply must repeat every guard in a new transaction.

`apply` locks the legal entity and account before checking their active state,
identity, currency and exact account `updatedAt`. Source balances must reconcile
over the complete account window. Every selected row must exist uniquely in the
source, have exactly one positive debit/credit direction and no parser warnings.
Fingerprint duplicates preserve the existing row. Conflicting stable bank
references, or matching document reference/description with date and amounts,
are refused for review. Ambiguous repeated source rows are also refused.

The receipt key is derived from company, account, source hash and source account
key. The account lock serializes concurrent attempts. The same operation replays
with `created:0`; a different operation for the same receipt key is rejected.
Receipts are durable audit rows committed atomically with the import, attributed
to `SYSTEM` with `userId:null`, source/manifest/operation hashes and run ID.
The application and caller must retain these receipts; deleting them invalidates
the durable intention history.

Only new fingerprints are inserted, with no `skipDuplicates` or upsert. A unique
constraint or any failed guard rolls back the whole operation. Existing account,
statement, transaction classification and payment/allocation records are never
updated. An existing matching source statement can receive missing rows; a new
upload/statement is created only when at least one new row is inserted.

Statement opening/closing balances describe the **full source account window**.
Rows already imported retain their original statement association. Upload
summary metadata distinguishes full source rows, selected rows, already present
fingerprints and newly imported rows; the statement's newly associated rows alone
are not expected to reconcile those full-window balances.

Use `ENV_FILE=.env.implementation.local tsx scripts/test-bank-evidence-executor.ts`
against a dedicated local MySQL database named `focus_preview_bank_evidence`,
with the repository's synthetic environment guards. The test refuses other
targets and verifies rollback, concurrency, check mode, idempotency, preservation,
source/payload/account drift and duplicate reexports. It contains synthetic data
only. No production source bytes, manifests, credentials or extracts belong in
the repository.
