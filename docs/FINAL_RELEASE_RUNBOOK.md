# Final Release Runbook

## 1. Freeze and baseline

1. Confirm the feature branch and clean intended diff.
2. Fetch `origin/main`; rebase only after conflict review.
3. Record current Production commit, deployment ID, URL and rollback command.
4. Capture a read-only Production sensitive-count snapshot.
5. Verify Preview and Production database fingerprints differ.

## 2. Isolated Preview gate

1. Load `.env.preview.local`; never use Production DB for a writing test.
2. Confirm `APP_ENV=preview`, synthetic seed guard and email delivery disabled.
3. Confirm OperationTask/Media Plan/legacy sync flags are absent unless an approved pilot explicitly requires one.
4. Seed deterministic synthetic accounts.
5. Run all domain tests. Any fixture-writing suite must call `assertSyntheticEnvironment()` before its first query/write.
6. Run `prisma validate`, `git diff --check`, typecheck and production build.
7. Start the built app using the exact Preview base URL so CSRF checks remain representative.
8. Run role smoke and the 4-viewport capture matrix.
9. Compare Preview counts before/after; only explicitly temporary synthetic records may change and must be cleaned.
10. Verify Production snapshot remains unchanged after Preview mutation proof.

## 3. Mandatory release commands

Use the exact scripts available in `package.json`; the minimum gate is:

```powershell
pnpm run test:release-governance
pnpm run typecheck
pnpm run test:rbac
pnpm run test:public-visibility
pnpm run test:availability
pnpm run test:location-selection
pnpm run test:inventory-reservations-scale
pnpm run test:admin-route-links
pnpm run test:dashboard-command-centers
pnpm run test:finance-consistency
pnpm run test:receivables-import
pnpm run test:crm
pnpm run test:operational-assignment
pnpm run test:auth-hardening
pnpm run test:notifications
pnpm run test:observability
pnpm prisma validate
git diff --check
pnpm run build
```

Reservation integrity and any other DB fixture test must run with `ENV_FILE=.env.preview.local`.

## 4. Preview sign-off

- Deploy the branch to Vercel Preview.
- Record Preview URL, deployment ID and commit.
- Run route smoke against Preview. If SSO blocks automation, report it and rely only on verified local production-browser evidence; never claim remote smoke.
- Inspect Preview runtime logs for 5xx, timeouts, Prisma errors, auth/RBAC failures and request loops.
- Review representative screenshots and the accessibility manifest.

## 5. Production release

1. Update local `main` from `origin/main`.
2. Fast-forward merge the verified branch; never force.
3. Push `main` and deploy that exact commit.
4. Wait for Vercel `Ready`; verify aliases point to the new deployment.
5. Run read-only smoke for Public, COO, Sales, Finance and Field routes.
6. Do not submit payment, reservation, HOLD, BOOKED, proof, import confirmation or notification sync actions.
7. Inspect logs for material 5xx, missing-table errors, RBAC failures and latency regressions.
8. Capture the Production after snapshot and compare with the baseline.

## 6. Immediate rollback conditions

Rollback immediately when any of these occurs:

- public/private data leak;
- write/public/selector availability divergence;
- active BOOKED appears available or expired HOLD still blocks;
- overlapping writes can both succeed;
- Sales sees global finance or Field sees unassigned work/proofs;
- canonical finance values mutate during smoke;
- material repeated 5xx/timeout/Prisma errors;
- navigation blocks a critical daily workflow.

Rollback baseline for this release:

```powershell
pnpm dlx vercel rollback dpl_EdYd9uZxbcLUggCqoSEqRHQT4Rn9
```

After rollback, repeat health, public privacy, authenticated role smoke, logs and sensitive-count comparison.
