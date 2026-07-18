# Focus Media release governance

## Environment architecture

| Concern | Production | Preview / Staging |
| --- | --- | --- |
| Database | Production MySQL database | Separate `focus_preview` database and least-privilege user |
| Data | Real business data | Deterministic synthetic dataset only |
| Authentication | Production secret and real users | Distinct secret and synthetic role accounts |
| Cron | Vercel production schedules | Not scheduled by Vercel; routes retain a distinct cron secret |
| Email | Provider may be configured | `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` are omitted |
| Upload storage | Production database-backed documents | Separate Preview database; synthetic assets only |
| Bootstrap access | Existing production controls | No production admin/bootstrap credentials |

Preview must never reuse the Production `DATABASE_URL`. The isolation verifier compares database fingerprints, names and sensitive counts, then creates and removes one synthetic Preview notification while proving Production counts remain unchanged.

## Synthetic accounts

The deterministic seed creates these users. Their shared password is supplied only through `PREVIEW_TEST_PASSWORD` and is never committed.

| Role | Email | Landing page |
| --- | --- | --- |
| COO | `coo.preview@focusmedia.test` | `/admin/dashboard` |
| Sales Director | `director.preview@focusmedia.test` | `/admin/dashboard` |
| Sales Agent | `agent.preview@focusmedia.test` | `/admin/dashboard` |
| Finance Operator | `finance.preview@focusmedia.test` | `/admin/financiar/incasari` |
| Field Operator | `field.preview@focusmedia.test` | `/admin/operational` |

The seed is guarded by `APP_ENV`, `VERCEL_ENV`, `ALLOW_SYNTHETIC_SEED`, `PREVIEW_DATASET_ID` and a database-name check. It does not create `OperationTask` records or activate feature flags.

## Preview preparation

1. Pull Preview-scoped variables into ignored `.env.preview.local`.
   For first-time provisioning, run `PROVISION_PREVIEW_DATABASE=true pnpm run preview:db:provision` with authorized infrastructure credentials.
   Publish only the allow-listed Preview variables with `pnpm run preview:env:sync`.
2. Run `pnpm run preview:db:sync` only against the isolated Preview database.
3. Run `pnpm run preview:seed`.
4. Run `pnpm run release:verify-isolation` with `ENV_FILE=.env.preview.local` and `PRODUCTION_ENV_FILE=.env`.
5. Build with Preview values using `pnpm run preview:build`.

Schema synchronization uses `prisma db push` because the historic production database is not reproducible from the incomplete migration chain. This command is protected by the synthetic-environment guard and must never target Production.

## Required release gate

- [ ] Repository clean and branch scope reviewed
- [ ] Production and Preview database fingerprints differ
- [ ] Preview email provider absent
- [ ] Preview cron secret differs; Preview cron is not scheduled
- [ ] Media Plan and OperationTask flags absent
- [ ] `pnpm run test:release-governance`
- [ ] `pnpm run typecheck`
- [ ] Domain tests relevant to the change
- [ ] `pnpm run test:rbac`
- [ ] `pnpm run test:public-visibility`
- [ ] `pnpm prisma validate`
- [ ] `git diff --check`
- [ ] `pnpm run build`
- [ ] Role-based HTTP smoke passes
- [ ] Real-browser screenshots reviewed at 1440x900, 1366x768, 768x1024 and 390x844
- [ ] Sensitive Production counts captured before and after Preview mutation proof
- [ ] Preview logs inspected
- [ ] Production rollback target recorded before any future Production deploy

## Sensitive count snapshot

`pnpm run release:snapshot` reads only counts for Reservations (total/HOLD/RESERVED/BOOKED), customer invoices, Payments, Notifications, proof documents and OperationTask. Set `SNAPSHOT_OUT` to store a JSON artifact. Never commit snapshots.

Compare two snapshots with `pnpm run release:compare-snapshots <before.json> <after.json>`. The command fails if the database fingerprint differs or any sensitive count changed.

## Rollback baseline

Stable Production at the start of this milestone:

- Commit: `01f4b63fc60faf024a369d4676d150b37ac0af93`
- Deployment: `dpl_H7dsUvW2gQeBAEfd5EV5Ki6mRMXx`
- URL: `https://focus-locatii-fvxjl45xx-edward-s-projects23.vercel.app`
- Public alias: `https://locatii.focusmedia.ro`

Previous Production deployment:

- Deployment: `dpl_Btim6YgQSuCoJP7RjhMvbe8FfdDT`
- URL: `https://focus-locatii-gmdbn50oi-edward-s-projects23.vercel.app`

Rollback to the milestone baseline:

```powershell
pnpm dlx vercel rollback dpl_H7dsUvW2gQeBAEfd5EV5Ki6mRMXx
```

This milestone does not deploy Production. A future release must re-confirm the deployment IDs immediately before release.
