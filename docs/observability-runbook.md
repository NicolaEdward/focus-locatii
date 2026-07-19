# Focus Media observability runbook

## Scope

This milestone uses Vercel Runtime Logs and the existing database audit trail. It does not create another business-data source and does not add a paid vendor.

## Structured log schema

Every application log is one JSON object. Allowed fields are:

- `timestamp`, `environment`, `level`, `event`;
- `route`, `operation`, `method`, `durationMs`, `status`;
- `role`, never user name or email;
- `correlationId` / response header `x-request-id`;
- safe `entityType` and internal `entityId`;
- `errorCode`, never exception stack or raw error message;
- `payloadBytes`, `queryCount`, `slowQueryCount`;
- numeric counters under `metrics`.

Forbidden runtime-log data:

- client or user names and email addresses;
- invoice numbers and individual amounts;
- uploaded file names;
- IP addresses, tokens, cookies and authorization headers;
- raw SQL, Prisma parameters, spreadsheet cell values and stack traces.

Example:

```json
{"timestamp":"2026-07-19T10:00:00.000Z","environment":"production","level":"warn","event":"prisma_slow_query","route":"/api/admin/location-selection/availability","operation":"prisma.select","method":"POST","durationMs":612,"role":"COO","correlationId":"c725fca7-e330-4a23-b4be-66ebac345e5d","errorCode":"PRISMA_SLOW_QUERY","queryCount":4,"slowQueryCount":1,"metrics":{"thresholdMs":500}}
```

## Initial budgets

| Surface | Warning duration | Severe duration | Warning payload | Severe payload |
| --- | ---: | ---: | ---: | ---: |
| `/admin/locatii` HTML | 1500 ms | 3000 ms | 250 KB | 500 KB |
| `/admin/clienti` HTML | 1500 ms | 3000 ms | 250 KB | 500 KB |
| `/admin/financiar/incasari` HTML | 1500 ms | 3000 ms | 250 KB | 500 KB |
| Selector availability API | 900 ms | 2000 ms | 1 MB | 2 MB |
| Public locations API | 700 ms | 1500 ms | 250 KB | 500 KB |

Query warnings range from 6-30 queries per request depending on the surface. Severe limits are 12-60. A query is slow at 500 ms by default; configure `PRISMA_SLOW_QUERY_MS` to a value of at least 50 ms.

Warnings are observability signals. `release:performance-budgets` fails only on severe regressions, non-2xx/3xx responses, or a missing request ID on an instrumented API.

## Runtime searches and alerts

Use these production Runtime Log searches:

```text
"event":"request_5xx"
"event":"request_failed"
"event":"cron_failed"
"event":"spreadsheet_import_failed"
"event":"spreadsheet_import_confirm_failed"
"event":"audit_write_failed"
"event":"prisma_slow_query"
"event":"performance_budget_exceeded"
"event":"proof_storage_delete_failed"
"event":"notification_sync_failed"
```

Current stack limitation: Runtime Logs retain operational logs for a limited period and this project has no external alert destination. Configure a Vercel Log Drain only after approval when real-time notification or longer retention is required. Route the JSON events above to the approved provider and alert on:

- any `audit_write_failed` or `cron_failed`;
- any `request_5xx` burst of 3 in 5 minutes per route;
- any `spreadsheet_import_confirm_failed` burst of 3 in 15 minutes;
- any severe `performance_budget_exceeded`;
- any `proof_storage_delete_failed`.

Until a drain is approved, the release owner checks the searches above after deployment and after the next scheduled cron interval.

## Cron verification

- Proof cleanup: daily at 03:00 UTC.
- Notification sync: daily at 04:00 UTC.
- Never trigger either production cron manually for smoke.
- Confirm `cron_completed` with the matching route, non-error status and duration.
- A missing or invalid secret is logged only as a safe code; the secret is never logged.

## Incident workflow

1. Capture `correlationId`, route, event and deployment ID.
2. Search all log lines with the same correlation ID.
3. Compare `queryCount`, `slowQueryCount`, `durationMs` and `payloadBytes` against the budget.
4. Verify sensitive record counts with `pnpm run release:snapshot`; do not inspect or log record contents.
5. Roll back to the recorded stable deployment if data safety, availability or authorization is affected.

## Cost and impact

- No new vendor or database table.
- One compact JSON line per instrumented request plus exceptional warning/error lines.
- Prisma query events record duration only; SQL and parameters are not logged.
- Response payload measurement clones JSON/text responses on selected API routes. Large binary downloads are excluded.
- Vercel Runtime Log ingestion remains within the existing deployment stack; a future drain may have provider and Vercel ingestion costs.
