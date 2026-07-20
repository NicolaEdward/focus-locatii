# Launch Readiness Checklist

Date: 2026-06-29

Goal: define checks required before launching major modules such as public redesign, media plans, offer links, operations and finance improvements.

## 1. Environment Readiness

- [ ] Production and staging databases are clearly separated.
- [ ] Production `DATABASE_URL` is documented and intentionally named.
- [ ] Staging/test `DATABASE_URL` is documented.
- [ ] Vercel production environment variables are reviewed.
- [ ] `OPERATION_TASKS_ENABLED` is not enabled in production until approved.
- [ ] `OPERATIONAL_ASSIGNMENT_ENABLED` is enabled only for an approved Preview/Production pilot with explicit assigned tasks.
- [ ] `OPERATION_TASK_READS_ENABLED` is not enabled in production until approved.
- [ ] SmartBill confirm import is used only through authenticated UI and explicit confirm.
- [ ] No secrets are committed.
- [ ] GitHub main branch contains the deployed code.
- [ ] Vercel project is connected to the expected repository/branch.

## 2. Test Accounts

Create and document staging accounts for:

- [ ] Super Admin.
- [ ] COO.
- [ ] Sales Director.
- [ ] Sales Agent A.
- [ ] Sales Agent B.
- [ ] Finance Operator.
- [ ] Future Operational role, if added.

Each role should have known test data:

- [ ] Own client.
- [ ] Foreign client.
- [ ] Own reservation.
- [ ] Foreign reservation.
- [ ] Campaign with multiple locations.
- [ ] Finance rows.
- [ ] Operation tasks.

## 3. Backup And Rollback

- [ ] Production DB backup procedure documented.
- [ ] Backup verified before destructive migrations.
- [ ] Vercel previous deployment ID captured before every production deploy.
- [ ] Rollback command documented:
  - `vercel rollback`
  - or `vercel rollback <deployment-id>`
- [ ] Release notes identify migration/backfill status.
- [ ] Backfill scripts default to dry-run.
- [ ] No production backfill runs without explicit approval.

## 4. Core Automated Checks

Run before major releases:

- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:public-visibility`
- [ ] `pnpm run test:availability`
- [ ] `pnpm run test:rbac`
- [ ] `pnpm run test:reservation-route-safety`
- [ ] `pnpm run test:reservation-lifecycle`
- [ ] `pnpm run test:reservation-write-classification`
- [ ] `pnpm run test:billing`
- [ ] `pnpm run test:finance-consistency`
- [ ] `pnpm run test:financial-import`
- [ ] `pnpm run test:smartbill-import`
- [ ] `pnpm run test:operation-task-reads`
- [ ] `pnpm run test:operation-route-bridge`
- [ ] `pnpm prisma validate`
- [ ] `git diff --check`

Run DB-backed concurrency checks when environment supports it:

- [ ] `pnpm run test:reservation-integrity`

## 5. Browser Smoke Tests

Public:

- [ ] `/` loads.
- [ ] `/locatii` loads.
- [ ] Filters work.
- [ ] Map/cards render.
- [ ] Location preview opens.
- [ ] Location presentation page opens.
- [ ] Shortlist add/remove works.
- [ ] Offer request submits in staging only.
- [ ] Mobile viewport does not overflow.

Admin:

- [ ] `/admin/login` loads.
- [ ] Dashboard loads for each role.
- [ ] Admin header active state works.
- [ ] `/admin/locatii` loads.
- [ ] Location drawer opens.
- [ ] Reservation panel loads.
- [ ] Conflict preview opens.
- [ ] Client/campaign workspace loads.
- [ ] Finance dashboard loads.
- [ ] SmartBill preview works in staging.

No production data mutation during smoke unless explicitly using safe test records.

## 6. Public API Leak Checks

For `/api/locations`, verify response does not contain:

- [ ] `latReal`
- [ ] `lngReal`
- [ ] `internalNotes`
- [ ] `reservations`
- [ ] `monthlyCost`
- [ ] internal cost fields
- [ ] private documents
- [ ] seller/user data
- [ ] financial fields
- [ ] SmartBill fields
- [ ] productionNotes

Verify:

- [ ] price appears only when `showPricePublic` is true.
- [ ] install/removal cost appears only when `showInstallationCostPublic` is true.
- [ ] only display/public coordinates appear.

## 7. RBAC Checks

Sales Agent:

- [ ] Cannot access foreign client documents.
- [ ] Cannot mutate operation status.
- [ ] Cannot reassign foreign reservations.
- [ ] Cannot access full finance import.

Sales Director:

- [ ] Can manage team sales workflows.
- [ ] Cannot use finance import unless policy grants it.

COO:

- [ ] Can manage operations.
- [ ] Can view cross-client reservations.
- [ ] Can reassign sellers.

Finance:

- [ ] Can access finance dashboard/import/review.
- [ ] Cannot mutate reservation lifecycle.
- [ ] Cannot mutate operations.

Super Admin:

- [ ] Full access.

## 8. Reservation Integrity Checks

- [ ] Overlapping HOLD is rejected.
- [ ] Overlapping RESERVED is rejected.
- [ ] Overlapping BOOKED is rejected.
- [ ] CANCELLED/EXPIRED rows do not block.
- [ ] Update period rechecks conflicts.
- [ ] Convert to BOOKED rechecks conflicts.
- [ ] Group update is atomic.
- [ ] Seller reassignment uses domain command.
- [ ] Audit logs written for critical actions.

## 9. Finance Import Checks

- [ ] Company context required before preview.
- [ ] Preview token includes company context.
- [ ] Confirm rejects company mismatch.
- [ ] Preview is read-only.
- [ ] Invalid rows are excluded.
- [ ] Needs-review rows are excluded unless corrected.
- [ ] Duplicate rows are not imported twice.
- [ ] Storno/discount rows never make remaining negative.
- [ ] Supplier negative docs remain review-only unless future model supports them.
- [ ] Confirm transaction does not time out on known real files.

## 10. Offer Link Security Checks

Before launching offer links:

- [ ] Token is random and unguessable.
- [ ] Token expires by validity date.
- [ ] Public offer page exposes only offer snapshot.
- [ ] Accepting offer does not create BOOKED.
- [ ] Change request stores message safely.
- [ ] Rate limiting exists for public token actions.
- [ ] Viewed/accepted/change events are logged.

## 11. Performance Checks

- [ ] Public `/locatii` load time acceptable on mobile.
- [ ] Image sizes optimized.
- [ ] Admin locations list does not freeze for current dataset.
- [ ] Dashboard queries complete within acceptable time.
- [ ] Finance SmartBill preview handles expected report size.
- [ ] Server-side pagination planned for larger datasets.

## 12. Observability

Recommended:

- [ ] Structured logging for imports, reservation lifecycle and offer actions.
- [ ] Error monitoring.
- [ ] Vercel logs checked after deploy.
- [ ] Health endpoint verified.
- [ ] Cron/job run history for stale holds and future scheduled jobs.
- [ ] Audit logs for business-critical actions.

## 13. Post-Deploy Checklist

- [ ] Homepage returns 200.
- [ ] `/api/health/db` returns `{"ok":true}`.
- [ ] `/locatii` returns 200.
- [ ] `/admin/login` returns 200.
- [ ] `/api/locations` returns 200.
- [ ] Public API leak check passes.
- [ ] Production logs show no new errors.
- [ ] Feature flags remain in intended state.
- [ ] Rollback target is known.
