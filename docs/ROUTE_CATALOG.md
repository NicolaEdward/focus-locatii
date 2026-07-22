# Route Catalog

## User-facing pages

| Route | Purpose | Primary roles | Canonical source |
| --- | --- | --- | --- |
| `/` | Public entry and inventory summary | Public | public location DTO |
| `/locatii` | Public location portfolio | Public | public location DTO + canonical public availability adapter |
| `/locatii/[id]` | Public location presentation | Public | public location detail DTO |
| `/admin/login` | Authentication | Public/unauthenticated | auth service |
| `/admin/dashboard` | COO command center or Sales agenda | COO, SUPER_ADMIN, SALES_* | dashboard services over canonical domains |
| `/admin/locatii` | Inventory and reservation/HOLD context | COO, SUPER_ADMIN, SALES_* according to RBAC | paginated locations/reservations |
| `/admin/selectie-locatii` | Offer selector and availability export | commercial roles | canonical availability batch service |
| `/admin/clienti` | Client list/detail | commercial and permitted finance roles | `ClientAccount` service |
| `/admin/campanii` | Campaign list/detail | commercial and permitted finance roles | `Campaign` service |
| `/admin/crm` | CRM v4 prospect/opportunity workspace | SALES_*, managers read-only by policy | CRM v4 service/events |
| `/admin/operational` | Global operations or assigned Field inbox | COO/SUPER_ADMIN/Sales policy/Field assigned | BOOKED-derived work + assignment pilot |
| `/admin/financiar/incasari` | Customer invoices, payments, imports and history | FINANCE_OPERATOR, COO/SUPER_ADMIN | `FinancialReceivable` + active payments |
| `/admin/furnizori` | Supplier registry | Finance and global managers | supplier service |
| `/admin/locatii/import` | Restricted inventory import | inventory managers | secure spreadsheet staging/import |
| `/admin/locatii/gps` | GPS audit and display-coordinate maintenance | inventory managers | location GPS service |
| `/admin/utilizatori` | Users, roles, invites and administrative recovery | users.manage | identity/user service |
| `/admin/integritate-date` | Ownership integrity report and dry-run | COO/SUPER_ADMIN | ownership integrity service |
| `/admin/integrari/saga` | Restricted read-only SAGA shadow reconciliation | COO, FINANCE_OPERATOR, SUPER_ADMIN | integration adapter over canonical finance registry |
| `/admin/securitate` | MFA/session management | authenticated roles | identity/session service |
| `/admin/accepta-invitatie` | One-time invite acceptance | invited user | identity token service |
| `/admin/resetare-parola` | One-time password reset | token holder | identity token service |

## API ownership

| API family | Responsibility | Write policy |
| --- | --- | --- |
| `/api/locations`, `/api/locations/[id]` | Public safe inventory DTO | read-only, no private fields |
| `/api/admin/location-selection*` | Selector list and batched availability | read-only |
| `/api/admin/availability/excel` | Availability export | generated on explicit action |
| `/api/admin/locations*` | Admin inventory summaries/detail/override | permissioned; canonical lifecycle/override writer |
| `/api/admin/reservations*`, `/api/reservations*` | Reservation list/detail/write/conflict preview | canonical transaction + lock + availability recheck |
| `/api/admin/clients*`, `/api/admin/campaigns*` | Client/campaign list and detail | ownership-scoped writes |
| `/api/admin/crm/*` | CRM v4 commands, agenda, analytics and export | idempotent commands; optimistic versioning; legacy writes retired |
| `/api/admin/operational/*` | Assignment, completion, reschedule and private proof | assigned/owner/global RBAC; IDOR protected |
| `/api/admin/receivables*` | Canonical invoice/payment/import workspace | finance RBAC; ledger semantics preserved |
| `/api/admin/financial/smartbill/*` | Restricted upstream SmartBill integration | integration/admin context only |
| `/api/admin/integrations/saga/shadow` | SAGA status and fixture-only shadow reconciliation | no Production writes; finance integration permissions |
| `/api/admin/notifications*` | Authenticated notification inbox | no creation during dashboard reads |
| `/api/auth/*` | Login, MFA, reset, invite and sessions | origin/CSRF and distributed rate limiting |
| `/api/import/*`, `/api/gps/*` | Restricted inventory tools | validate/stage before write |
| `/api/cron/*` | Financial notification sync and proof cleanup | production schedule + distinct secret; idempotent |
| `/api/offer-requests` | Public commercial request | honeypot/rate-limit/origin policy |
| `/api/health/db` | Minimal DB health | exposes no secrets or schema details |

## Role smoke contract

- COO: all routes in the release smoke matrix.
- Sales Director/Agent: Dashboard, Locations, Selector, Clients, Campaigns, CRM, Operational and Security; no global Finance, Suppliers, Import, GPS, Users or Integrity report.
- Finance Operator: Clients, Campaigns, Customer invoices, Suppliers, SAGA shadow integration and Security.
- Field Operator: Operational assigned inbox and Security only.
- Unauthenticated requests to protected routes redirect to `/admin/login`.
