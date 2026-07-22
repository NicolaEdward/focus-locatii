# Audit Delta - Stabilization Release

## Scope and baseline

- Baseline code: `main` at `3a915f6b5997b80c25c524f6a1a7363f972af2b0`.
- Production baseline deployment: `dpl_EdYd9uZxbcLUggCqoSEqRHQT4Rn9`.
- Audit environment: isolated `focus_preview` database with synthetic role accounts.
- No production migration, reservation, payment, notification or proof mutation is permitted by this release.

## Before and after

| Area | Before stabilization | Final verified state |
| --- | --- | --- |
| Availability | Multiple consumers historically diverged | Canonical lifecycle + override + effective reservation decision; inclusive intervals; transactional lock/recheck |
| HOLD | Stored status could lag expiry | Effective expiry controls blocking and dashboard counts; cleanup is hygiene only |
| Inventory | Large initial workspace and legacy detail hydration | Paginated list, lazy detail/editor, compact initial payload |
| Clients/Campaigns | Combined heavy workspace | Dedicated list/detail APIs and lazy tabs with shared canonical services |
| Finance | Mixed legacy summaries and active register | `FinancialReceivable` plus active payment ledger is canonical; settled invoices live in history |
| CRM | Legacy and v4 surfaces coexisted | CRM v4 is the only write surface; legacy data remains read-only |
| Operations | Field visibility too broad | Explicit assignment policy; Field sees assigned work only; proof access remains private |
| Auth | Memory-only abuse protection and admin-only recovery | Distributed limiting, invite/reset/MFA foundations, audited sessions; rollout gates remain documented |
| Observability | Mixed logs and weak correlation | Structured request logs, correlation IDs, slow-query and payload budget signals |
| Release QA | Partial route smoke and fragile browser capture | 5-role smoke, 25-page visual matrix, 4 viewports, workflow-state screenshots and accessibility audit |

## Defects confirmed and corrected in Milestone 16

1. Synthetic DB-writing reservation and client/supplier tests lacked an explicit Preview/Test guard. Both now fail before writes unless the isolated synthetic environment is proven.
2. The final role smoke omitted Suppliers, location import, GPS audit, user management and ownership integrity. These routes are now included with role-specific expected access.
3. Reservation, inventory and offer-request filters had missing accessible labels. Labels and regression assertions were added.
4. The lazy reservation workspace duplicated the `rezervari` HTML id. It now uses `rezervari-workspace`.
5. GPS status filtering lacked an accessible label.
6. User-role controls did not identify the affected user and role names were visually truncated. They now have contextual labels and a stable minimum width.

## Visual and accessibility evidence

- 100 screenshots: 25 page/role combinations x 4 viewports.
- Viewports: 1440x900, 1366x768, 768x1024 and 390x844.
- Additional states: finance payment preview, full reservation workspace and qualified CRM prospect modal.
- Critical automated accessibility findings after fixes: 0.
- Horizontal page overflow findings: 0.
- Console/runtime errors in the final matrix: 0.
- Non-blocking warnings: controls/links below the conservative 32px audit threshold, mainly compact desktop links; touch layouts use larger targets. These remain P3 and should be evaluated against WCAG 2.2 target-spacing exceptions.
- Local artifact index: `artifacts/m16-final-audit/manifest.json`.

## Performance evidence

| Route/API | Observed median | Payload | Status |
| --- | ---: | ---: | --- |
| `/admin/locatii` HTML | 1,253-1,370 ms | 182,958 B | within current budget |
| `/api/admin/locations?page=1` | 1,203 ms | 13,527 B / 15 rows | bounded |
| `/admin/clienti` | 705 ms | 52,279 B | improved/bounded |
| `/admin/financiar/incasari` | 898 ms | 106,924 B | bounded, no settled registry preload |
| `/api/locations` | 57-61 ms warm median | 119,591 B production | within budget |
| Selector list | 729 ms | 71,769 B | warning-level latency |
| Selector availability | 994-1,350 ms | 53,625 B | P2 optimization candidate |
| Conflict preview | 1,143 ms | 33,984 B | P2 optimization candidate |
| CRM workspace | 328 ms warm median | 1,191 B | healthy |

## Data integrity evidence (read-only)

- Reservations: 198; effective blockers: 68; active overlap conflicts: 0.
- Stored expired HOLD: 0; HOLD without expiry: 0; invalid periods: 0.
- Active availability overrides: 1; legacy scalar blocks: 2.
- Active clients without owner: 0; historical archived/merged clients without owner: 21.
- Reservations without seller: 65, all cancelled historical records.
- Financial receivables: 219; classified ledger/snapshot differences: 64, all archived legacy snapshots.
- OperationTask: 288; assigned: 0; unassigned: 288; current derived operational work: 130.
- No automatic remediation or backfill was executed.

## Remaining risks

- P1: production email delivery is not configured, so self-service invite/reset notifications are not fully operational.
- P1: mandatory MFA rollout is not enabled; enrollment/recovery must be completed before enforcement.
- P2: operational cutover is blocked by unassigned/stale OperationTask data and needs a controlled pilot.
- P2: selector availability/conflict preview latency exceeds the preferred warm budget.
- P2: legacy full reservation endpoints remain large (about 288-361 KB) although they are no longer initial-page dependencies.
- P2: two legacy location block scalars remain for compatibility.
- P2: no dedicated user-facing Integrations page exists; SmartBill remains backend/restricted finance infrastructure.
- P3: historical ownership gaps are preserved conservatively and are not exposed to Sales.

## Release conclusion

The code is eligible for release only if the complete gate, Preview deployment, production count comparison and post-deploy logs remain green. Any availability divergence, Field overexposure, financial mutation, public leak or material 5xx requires immediate rollback.
