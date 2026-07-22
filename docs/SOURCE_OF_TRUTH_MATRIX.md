# Source of Truth Matrix

| Business question | Canonical source/service | Consumers | Forbidden parallel source |
| --- | --- | --- | --- |
| Is a location bookable? | lifecycle + active override + effective reservation decision | write APIs, selector, public adapter, exports, dashboard, inventory | local component status logic or stored HOLD status alone |
| Does a HOLD block? | effective expiry rule in availability layer | every availability consumer | cron normalization as correctness dependency |
| Who owns a sale/client? | explicit seller/owner fields with documented precedence | Sales scoping, dashboards, notifications | silent name or role fallback |
| What is a campaign state? | campaign state machine/service | clients/campaigns/dashboard/operations | free-form status writes |
| What is an invoice balance? | invoice amount minus active payment ledger | finance UI, dashboard, notifications | imported collected snapshot overwriting manual ledger |
| What has been collected? | individual active payment records | finance history/summary | one mutable `collected` field |
| What is current operational work? | BOOKED-derived work plus controlled explicit assignment | operational manager and Field inbox | HOLD/RESERVED or unrestricted reservation list |
| Who may view proof photos? | operational task/reservation authorization service | assigned Field, policy-authorized Sales, COO/Admin | public DTO or permanent public URL |
| What is the CRM record? | CRM v4 company/prospect/opportunity/event | CRM workspace/export/COO read view | `ClientAccount` or legacy CRM writer |
| What is forecast confidence? | deterministic CRM stage policy | CRM cards/KPIs/export | manual weighted probability/value |
| What should a dashboard show? | dedicated role dashboard DTO services | COO and Sales dashboards | React-side totals over full datasets |
| What notifications exist? | notification service with idempotency keys | bell/agenda/scheduled sync | duplicate creation during page load |
| What is public location data? | explicit public DTO adapter | public pages/APIs | Prisma model serialization |
| What records changed? | audit/event append-only records | authorized history/integrity tools | unlogged direct updates |

## Boundary rules

1. Selector reads availability and never creates reservations.
2. CRM does not create clients, campaigns, reservations or finance records automatically.
3. SmartBill and spreadsheets are inputs to the canonical finance register, not alternate ledgers.
4. Proof photos are private temporary evidence, not public gallery media or production sketches.
5. Dashboards and smoke checks are read-only.
6. Historical compatibility models remain read-only until a separately approved contract migration.
