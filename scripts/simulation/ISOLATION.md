# Isolated OOH simulation runner

This runner is for the synthetic `focus-ooh-real-company-v1` company. It never
loads the ordinary release environment wrapper. It reconstructs the child's
environment from a small operating-system allowlist and an explicit synthetic
file. Outbound credentials and dangerous delivery/build flags are overwritten
with empty or false values, including when they were present in the parent.
The runner never prints authentication secrets or a complete database URL.
Start the runner itself with a trusted Node bootstrap (clear inherited
`NODE_OPTIONS` before invoking Node). It can replace its child's preload options,
but cannot undo a preload that Node executed before the runner's code.

Before setting the example manifest's three `isolation` attestations to true,
the operator must record evidence that the local database account can access
only the new schema, Docker reports an internal network, and the runtime contains
no real dotenv files. These are externally supplied attestations, not discoveries
made by the runner. Merely editing the JSON does not prove isolation.

Use `host=127.0.0.1, port=33407` for a local forwarded database and a separate
manifest with `port=3306` inside the database network namespace. A remote database,
root/admin account, unrelated schema or target different from the manifest is
refused. No production connection is needed for these checks.

Required synthetic env file keys (use fresh random secrets, not these placeholders):

```dotenv
OOH_SIMULATION=true
OOH_SIMULATION_DATASET_ID=focus-ooh-real-company-v1
APP_ENV=preview
VERCEL_ENV=preview
NODE_ENV=test
ALLOW_SYNTHETIC_SEED=true
PREVIEW_DATASET_ID=focus-media-synthetic-v1
DATABASE_URL=mysql://ooh_simulation_scoped:FRESH_RANDOM_PASSWORD@127.0.0.1:33407/focus_preview_simulation_ooh_20261113?connection_limit=5&pool_timeout=10
NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3050
AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3050
AUTH_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
AUTH_MFA_ENCRYPTION_KEY=REPLACE_WITH_AT_LEAST_32_OTHER_RANDOM_CHARACTERS
CRON_SECRET=REPLACE_WITH_AT_LEAST_24_RANDOM_CHARACTERS
OPERATIONAL_ASSIGNMENT_ENABLED=true
```

The file supports literal single-line `KEY=value` entries, optional matching
quotes, and full comment lines. It performs no shell expansion. Unknown and
duplicate keys are rejected. Keep the file outside Git and restrict it to its
owner. Additional base URL keys must match the manifest application origin.
`NODE_ENV=production` is permitted for a production Next build/start while
`APP_ENV` remains synthetic and `VERCEL_ENV=preview`; it never authorizes a
production database or any external delivery. `SAGA_SHADOW_MODE=fixture` can be
used to exercise the existing read-only fiscal fixture; real writeback is absent.

```sh
node scripts/simulation/run-isolated.cjs --help
node scripts/simulation/run-isolated.cjs --env /private/host.env --manifest /private/isolation-host.json --check
node scripts/simulation/run-isolated.cjs --env /private/host.env --manifest /private/isolation-host.json -- node scripts/simulation/seed.ts
node scripts/simulation/run-isolated.cjs --env /private/runtime.env --manifest /private/isolation-runtime.json --cwd /private/clean-runtime -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3050
node scripts/test-simulation-isolation.cjs
```

Invoke TypeScript entry points with the project's TSX executable rather than
bare Node if they use syntax/imports requiring TSX. Seed and browser scenario
entry points are maintained separately from this guard.

Every Node child inherits a preload that validates the synthetic environment and
refuses nonloopback `net.Socket` connections and Unix sockets before connection.
Native Prisma engines, arbitrary subprocesses and Chromium do not all use Node's
socket code. Therefore the guard supplements the internal Docker network; it is
not an operating-system firewall. Browser contexts must independently block
nonlocal origins, service workers, external popups and customer links. Use local
fixture images/maps and `example.invalid` contacts.

The local Next server does not schedule Vercel's cron jobs itself. Keep a fresh
synthetic cron secret and test unauthorized calls are refused. The registered
jobs change proof records, synchronize notifications and audit documents; the
notification digest can send email if a provider key is present. Its path does
not share `AUTH_EMAIL_DELIVERY_ENABLED`, so provider keys are always blanked.
