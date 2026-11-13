# CRM command outcomes and recovery

The CRM command API distinguishes a committed domain result, a known rejection and an unknown outcome. A failed supplementary audit after the command resolved returns the preserved result with `outcome: committed`, `auditStatus: incomplete` and a visible warning. Timeouts and unknown errors never claim that no data was saved and never instruct the client to repeat the write. Inbound creation spans two transactions, so a later failure can leave a prospect; read-only recovery can report that partial outcome.

A caller key is scoped to the authenticated actor and bound to the complete payload hash through an immutable, transactional AuditLog claim. Concurrent or repeated potentially committed writes are refused. A different payload with the same key is refused. Known rejected transactions receive a rejection marker before that exact intention may be submitted again. Legacy keys belonging to the actor also require verification before reuse. Existing domain keys are namespaced so another actor cannot receive a foreign result by reusing a known caller key. The endpoint still accepts legacy commands without a key, but never recommends replaying them after uncertainty.

`GET /api/admin/crm/commands?intentKey=...` looks up only the authenticated actor's persisted CRM events or completed route audit. An absent event is always unknown; it does not prove that a command rolled back. Business record IDs are returned only within the current read scope. The UI retains the opaque intention key and request ID across reloads without storing form data. It blocks another save until read-only verification succeeds or the user explicitly closes the intention after manually checking the register and history. Closing an intention does not submit a write; a subsequent save is a new intention.

Verification:

```sh
node scripts/release/run-with-env.cjs .env.implementation.local node_modules/.bin/tsx scripts/test-crm-command-outcomes.ts
node scripts/test-crm-v2.cjs
node scripts/release/run-with-env.cjs .env.implementation.local node scripts/release/smoke-crm-command-recovery.cjs
```

The synthetic MySQL suite injects a post-commit audit failure and a transaction timeout, verifies partial inbound recovery, actor isolation, payload mismatch rejection and concurrent one-winner claims. Client transport tests prove response loss produces only one POST. A Chromium test at 390px also exercised real committed response loss, blocked resubmission, preserved key after reload and successful GET recovery with one resulting prospect.

The browser smoke requires a running local synthetic app and Playwright Chromium. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a system Chromium. Only for a development server whose CSP blocks framework development scripts, set `CRM_SMOKE_BYPASS_CSP=true` on the test process; the default leaves CSP enforcement enabled and no application headers are changed.
