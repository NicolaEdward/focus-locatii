# Isolated OOH company fixture

These scripts contain fictional records only. They never read or clone a production database. `seed-company.ts` refuses a nonempty company database and never clears or resets one.

Before running the seed, independently prove isolation of the database, application network, runtime configuration and external effects. The dedicated guard is an additional check, not a replacement for that proof. Root orchestration keeps that proof outside the public repository.

Required configuration:

- `APP_ENV=preview`, `VERCEL_ENV=preview`, `NODE_ENV=test` for the seed process.
- `ALLOW_SYNTHETIC_SEED=true`, `PREVIEW_DATASET_ID=focus-media-synthetic-v1`.
- `OOH_SIMULATION=true`, `OOH_SIMULATION_DATASET_ID=focus-ooh-real-company-v1`.
- A MySQL URL on `localhost` or `127.0.0.1`, database named `focus_preview_simulation_*`, using a user granted access only to that database.
- `AUTH_EMAIL_DELIVERY_ENABLED=false`, `AI_SALES_GENERATION_ENABLED=false`, `COMMERCIAL_SEND_ENABLED=false`; external credentials absent.
- `SAGA_SHADOW_MODE=disabled` or the local `fixture` mode.
- `OOH_SIMULATION_OUTPUT` points to a private output directory. Docker can use `/simulation-output`.

Run `tsx scripts/simulation/test-guard.ts` to verify refusal behavior without connecting to any database. Once runtime isolation and an empty migrated schema are proved, run `tsx scripts/simulation/seed-company.ts` in that isolated runtime. The script exports `manifest.json` and `accounts.private.json` with mode `0600`; never commit credentials or customer-like artifacts to the public repository. Do not run the seed while `next start` supplies `NODE_ENV=production`; give the seed its own explicit test process.

The manifest records test identities, scenarios, expected anomalies and model limitations. Its anchor defaults to 2026-11-16 and may be overridden with `OOH_SIMULATION_ANCHOR=YYYY-MM-DD`. Hold expiry times are relative to seed execution; their purpose is testing current expiry behavior.

Three entity values are existing application configuration keys. Their stored financial legal names and tax identifiers are fictional. Audience and reach values are unverified synthetic estimates. Generated contracts have no legal effect, and their reviewed source facts do not demonstrate any actual NAS connection.
