# Open Decisions

| Priority | Decision | Current safe behavior | Decision owner / gate |
| --- | --- | --- | --- |
| P1 | Production email provider and verified sender | Invite/reset email delivery remains disabled; admin reset stays available | COO + Security before enabling delivery |
| P1 | Mandatory MFA rollout date | MFA foundations exist; enforcement remains off to avoid lockout | COO + Security after enrollment/recovery drill |
| P2 | OperationTask cutover | Feature flag remains globally off; Field uses only controlled assignment policy | COO + Operations after pilot and assignment dry-run |
| P2 | Treatment of 230 stale OperationTask records | Preserved, invisible to Field, no automatic backfill | Operations data review |
| P2 | Selector latency budget | Correct but about 1.0-1.35s median for availability | Engineering profiling; no business-rule rewrite |
| P2 | Legacy location block cleanup | Two scalar blocks remain compatibility reads | Inventory dry-run and explicit approval |
| P1 | SAGA production contract and product | Fixture-only shadow foundation; no production connector or write-back | Finance + SAGA vendor + Security approval |
| P2 | SAGA external IDs and invoice allocation cardinality | Existing canonical registry remains unchanged; no one-campaign assumption | Finance/Product data-model review |
| P2 | Dedicated Integrations area | SAGA shadow is restricted under Setari; SmartBill backend remains restricted | Finance/Product navigation review |
| P2 | Archived finance snapshot differences | 64 differences are classified and not part of active ledger | Finance review only if historical reporting requires it |
| P3 | Historical cancelled ownership gaps | Conservative, not exposed to Sales | Optional historical cleanup batch |
| P3 | Compact desktop target sizes | No critical accessibility failures; some links are under the conservative 32px audit threshold | Design/accessibility follow-up |

No open decision authorizes Media Plan, AI or destructive legacy deletion.
