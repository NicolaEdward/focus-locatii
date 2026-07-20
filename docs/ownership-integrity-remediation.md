# Ownership integrity and controlled remediation

## Scope

This milestone protects commercial ownership for clients, campaigns and reservations. It does not infer operational assignment and does not modify financial legacy differences.

## Canonical policy

New commercial records must have an active `SALES_AGENT` or `SALES_DIRECTOR`:

- a new active client needs `accountOwnerUserId`;
- a new campaign needs `sellerUserId` and `accountOwnerUserId`;
- a new reservation needs `sellerUserId` and `ownerId`;
- a new `BOOKED` reservation also needs `clientId` and `campaignId`;
- COO and SUPER_ADMIN must choose a commercial owner explicitly and never become the implicit seller;
- CRM prospect and opportunity ownership continues to use its existing mandatory owner policy.

Sales dashboards and notifications remain conservative. Unassigned records are not exposed to individual sellers through a legacy fallback.

## Deterministic evidence precedence

1. Direct owner on the same record.
2. Campaign seller.
3. Campaign account owner.
4. Client account owner.
5. Record creator.
6. Audited creator.
7. Exact legacy seller name/email match to one active sales user.
8. Owner of a directly related record.
9. Exact campaign name under the same client.

`SAFE_AUTOFILL` is assigned only when all deterministic evidence points to one candidate. Conflicting candidates are `NEEDS_REVIEW`; no candidate is `UNRESOLVED`. An inactive direct owner always requires review.

## Current read-only audit (2026-07-20)

- Reservations: 195.
- Reservations without seller: 97, all `CANCELLED`, all from a legacy source.
- Reservations without campaign: 120 (`CANCELLED` 115, `EXPIRED` 4, `RESERVED` 1).
- `BOOKED` without client or campaign: 0.
- Active clients without owner: 0.
- Clients without owner in all statuses: 21 (`archived` 19, `merged` 2).
- Inactive users: 1.
- Ownership findings: `SAFE_AUTOFILL` 32, `NEEDS_REVIEW` 0, `UNRESOLVED` 185.
- Proposed safe batch: `own_110b5ebface1c26ffa2c`.

The 32 safe suggestions concern cancelled historical reservations only. The batch has not been applied.

## Finance legacy classification

Finance is deliberately separate from ownership:

- 64 receivables have a legacy collected amount without an active payment-ledger row;
- 125 import issues remain unresolved;
- 1 receivable is marked `needsReview`;
- 75 included receivables do not have an owner snapshot.

No financial value is changed by this milestone. The 64 ledger differences require a dedicated financial reconciliation decision.

## Operational assignment

- OperationTask total: 288.
- Active (`NEW`/`IN_PROGRESS`): 156.
- Active and unassigned: 156.
- Active assigned to an inactive user: 0.

The commercial reassign command refuses to process a user with active operational tasks. Operational assignment therefore remains a separate controlled milestone.

## Read-only workflow

1. Open `Setari -> Integritate date` as COO or SUPER_ADMIN.
2. Refresh the report.
3. Filter by entity, reason or classification.
4. Generate a dry-run.
5. Record the batch id and review every suggested patch.
6. Obtain explicit business approval before any production apply.

CLI audit:

```powershell
$env:ENV_FILE='.env'
pnpm run audit:ownership-integrity -- --summary
```

## Production batch proposal (not executed)

1. Capture sensitive production counts.
2. Generate a fresh production dry-run; the expected id is currently `own_110b5ebface1c26ffa2c`.
3. Compare all selected item ids and before/after fields with the approved report.
4. Obtain explicit written approval for the exact batch id.
5. Temporarily set `OWNERSHIP_REMEDIATION_WRITES_ENABLED=true` in Production.
6. Call the protected COO/SUPER_ADMIN API with command `apply-safe`, the selected ids, exact batch id, a reason and confirmation phrase `APLICA BATCH-UL DE OWNERSHIP`.
7. Re-run the read-only report and sensitive counts.
8. Remove `OWNERSHIP_REMEDIATION_WRITES_ENABLED` immediately.
9. Inspect audit rows and runtime logs.

Applying a stale dry-run is rejected. Repeating an applied batch is idempotent.

## Compensating rollback

Rollback is data-aware, not a blind reverse update. It proceeds only if every current ownership field still equals the value written by the batch. Otherwise it stops without partial compensation.

Use the protected command `rollback` with:

- the original batch id;
- a reason of at least 10 characters;
- confirmation phrase `COMPENSEAZA BATCH-UL DE OWNERSHIP`;
- `OWNERSHIP_REMEDIATION_WRITES_ENABLED=true` temporarily enabled.

The compensating event is stored in `AuditLog`. Platform deployment rollback does not undo data changes and must not be used as a substitute for this compensating action.

## User departure workflow

1. Select source user and target active seller in `Integritate date`.
2. Generate reassignment dry-run.
3. Review client, campaign, reservation, receivable and CRM dependency counts.
4. Resolve operational assignments separately if present.
5. Apply only after exact batch approval.
6. Deactivate the source user only after active dependency count reaches zero.

Historical creator/audit references are preserved and are never reassigned.
