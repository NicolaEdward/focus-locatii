# Focus Media OOH Portal - Practical Application Audit

Date: 2026-06-29

Scope: read-only practical audit of the existing Focus Media OOH portal: dashboards, locations, reservations, campaigns, clients, finance, billing, operations and navigation. This report intentionally ignores quote/public offer flows and does not propose OperationTask cutover.

Hard limits observed: no production deploy, no production DB writes, no destructive migration, no OperationTask production flag enablement, no broad refactor.

## A. Executive Summary

### Top 10 Practical Problems

1. The admin locations page is doing too many jobs: inventory admin, reservation creation, offer requests, operational tasks, sales exports and montaj billing all live in one surface.
2. Many dashboard buttons deep-link to generic `/admin/locatii#rezervari` instead of the exact reservation, campaign, client, location, or operational task.
3. COO dashboard duplicates operational task information: one active task list plus separate decoration and neutralization lists show overlapping content.
4. There is no dedicated operational page for "Azi", "Saptamana asta", "Intarziate", "Finalizate", "Cost montaj lipsa" and "Probleme".
5. Client and campaign pages are one shared workspace, not true detail pages; this makes navigation, documents, finance and reservations harder to inspect.
6. The location editor is a single large modal with commercial, GPS, public visibility, images, costs, blocked fields and internal notes mixed together.
7. Several important actions still use `window.prompt` instead of structured forms: period change, CRM value, CRM follow-up, CRM notes and partial payment amount.
8. Dashboard problem lists mix true blockers with operational reminders and do not always take the user to the exact fix location.
9. Finance has strong backend consistency checks now, but the UI is still a dense import/review/manual-entry workspace rather than daily cash priorities first.
10. Role dashboards show useful data, but each role still sees too much cross-functional noise and too few role-specific next actions.

### Top 10 Real Logic / Bug Risks

1. P1: COO conflict actions `markResolved` and `approveException` only append a production note; they do not resolve the underlying overlap or create a durable exception record.
2. P1: Operation action buttons can still be visible in some UI surfaces for users whose server-side permission will reject operation mutations.
3. P1: Missing neutralization warning flags `neutralizationDate` as missing even though business may accept `periodEnd` as the default neutralization date, similar to the fixed montaj rule.
4. P1: Prompt-based period changes do not show availability impact before submit and are easy to enter incorrectly.
5. P1: Admin location inline edits can change status, availability text, prices and public visibility from a crowded table with minimal context.
6. P1: The dashboard GET path calls stale hold expiry. It is now safer than before, but a read page still performs a lifecycle mutation.
7. P1: The command-center "createTask" action still writes legacy operation status/notes, not a clearly scoped task with assigned owner, date and cost.
8. P1: Seller/owner, campaign and billing information is spread across reservations, client/campaign workspace and finance rows; the user cannot easily confirm the source of truth.
9. P2: Conflict detection in `src/lib/dashboard.ts` groups by location code, not location id; duplicate codes or changed codes can create misleading COO problems.
10. P2: Public DTO serialization is currently guarded by tests and key deletion, but the serializer still constructs private keys before deleting them for public responses; keep tests strict.

### Top 10 UX / Navigation Fixes

1. Add direct reservation detail links and use them everywhere that currently says "Detalii", "Vezi detalii", "Vezi contract" or "Deschide".
2. Add `/admin/operational` and move operational task lists and montaj billing summaries there.
3. Split `/admin/locatii` into inventory-first sections and move reservation creation/listing to `/admin/rezervari`.
4. Replace prompt-based "Schimba perioada" with a modal that rechecks availability and shows conflicts before save.
5. Replace prompt-based partial payment with a small payment modal showing invoice amount, already collected and remaining.
6. Rename mixed English/Romanian labels: "Needs Review", "Backup JSON", "Accounts OOH", "Operational Health".
7. Move dangerous actions into action menus with confirmation and context: delete location, duplicate location, unblock location, archive campaign, merge client.
8. Put COO "Probleme active" into prioritized queues: Critical now, Due today, This week, Data cleanup.
9. Add true client/campaign detail routes with tabs rather than one shared workspace.
10. Add active page indication and role-specific primary actions in the admin header.

### Top 10 Missing Things

1. `/admin/rezervari/[id]` reservation detail page.
2. `/admin/clienti/[id]` client detail page.
3. `/admin/campanii/[id]` campaign detail page.
4. `/admin/locatii/[id]` location detail page with tabs.
5. `/admin/operational` operational workbench.
6. Day/week operational calendar or grouped task view.
7. Dedicated montaj billing page or finance/operations shared view.
8. Server-side pagination for large admin lists.
9. Central action map / route helper for deep links.
10. Practical empty/error/loading states for each major panel.

## B. Severity Table

| Title | Area | Severity | File / component / route | Current behavior | Expected behavior | Business impact | Recommended fix | Complexity | Safe order |
|---|---|---:|---|---|---|---|---|---:|---:|
| Conflict "resolved" actions only append notes | COO dashboard | P1 | `src/components/admin/CooCommandCenter.tsx`, `src/app/api/admin/command-center/route.ts` | `markResolved` / `approveException` writes text to `productionNotes`. | A conflict should remain open until periods/statuses are corrected or a durable exception exists. | COO may think a booking conflict is fixed when it is only annotated. | Hide these buttons or add a real `ConflictResolution`/audit-backed exception model. | M | 1 |
| Generic reservation links | Navigation | P1 | `RoleDashboard.tsx`, `DashboardHoldActions.tsx`, `CooCommandCenter.tsx` | Many actions go to `/admin/locatii#rezervari`. | Link to exact reservation, campaign, client, or location. | Users lose time and may edit the wrong row. | Add route helpers and detail pages or filtered query params as interim. | M | 1 |
| Prompt-based period change | Reservations | P1 | `DashboardHoldActions.tsx`, `CooCommandCenter.tsx` | Uses two browser prompts for date changes. | Structured modal with date fields, availability recheck and conflict preview. | Bad dates or hidden conflicts can be submitted. | Replace prompt with controlled modal calling existing domain update. | M | 4 |
| Operation buttons visible beyond real permission | Operations/RBAC UX | P1 | `AdminReservationsPanel.tsx`, `CooCommandCenter.tsx` | Some UI gating still includes reservation ownership for operational status editing. | Operation status controls should appear only to roles with `campaigns.operate`. | Sales users can see actions that fail or create role confusion. | Align UI gating with server permission, keep read-only status visible. | S | 1 |
| Missing neutralization warning may be noisy | COO dashboard | P1 | `src/lib/dashboard.ts` | Flags BOOKED rows ending soon when `neutralizationDate` is null. | Use effective neutralization date: `neutralizationDate ?? periodEnd`; flag only missing/invalid schedule. | COO gets false problems and ignores the problem center. | Mirror the fixed installation date rule for neutralization. | S | 2 |
| Read page expires stale holds | Lifecycle | P1 | `src/lib/dashboard.ts`, `src/lib/reservation-lifecycle.ts` | `getDashboardData` calls `expireStaleHolds()`. | Lifecycle expiry should run from cron/job, not from a dashboard read. | Hidden writes during reads are hard to reason about and audit. | Keep idempotent helper for now, add real cron/job and remove opportunistic call later. | M | 5 |
| Create task is not a real task | Operations | P1 | `src/app/api/admin/command-center/route.ts` | `createTask` writes operation status/notes. | Task creation should create relational OperationTask only when feature is enabled, or be hidden until supported. | Operators may believe a trackable task exists when it does not. | Disable/rename as "Adauga nota operationala" or route through OperationTask bridge behind staging flag. | M | 5 |
| Location table has too many inline edits | Locations | P1 | `src/components/admin/AdminDashboard.tsx` | Status, availability, price and public toggles are editable from the list. | List should be scan-first; edits should happen in detail/edit sections. | Accidental public visibility or pricing mistakes. | Keep only critical status indicator; move edits to detail/edit modal tabs. | M | 3 |
| Delete location too visible | Locations | P1 | `src/components/admin/AdminDashboard.tsx` | Trash button is visible on every row. | Dangerous action should live in advanced action menu and require context confirmation. | Accidental destructive attempts; even blocked by backend, it is stressful. | Move delete to "Advanced" menu and include code/address in confirmation. | S | 3 |
| Client/campaign lack detail routes | Clients/Campaigns | P1 | `src/app/admin/clienti/page.tsx`, `src/app/admin/campanii/page.tsx`, `ClientCampaignsWorkspace.tsx` | One workspace handles lists, details, documents, invoices and cleanup. | Direct detail pages with tabs. | Poor navigation and hard audit trail. | Add read-only detail routes first, then move edit actions gradually. | L | 2 |
| Partial payment prompt | Finance | P1 | `ClientCampaignsWorkspace.tsx` | Partial payment uses `window.prompt`. | Modal with remaining amount, currency, date and validation. | Wrong cash entry is easy. | Small controlled modal using existing payment endpoint. | S | 4 |
| Finance UI mixes upload, manual entry and daily cash | Finance | P2 | `FinancialDashboardPanel.tsx` | All finance workflows live in one long dashboard. | Daily cash priorities first; upload/review/manual entry as tabs. | Finance operator spends time scanning irrelevant sections. | Reorder sections; keep data logic unchanged. | M | 5 |
| COO operations duplicated | COO dashboard | P2 | `CooCommandCenter.tsx` | Shows active tasks, then separate decoration and neutralization tables. | One grouped task list with filters/tabs. | Repetition makes counts feel inconsistent. | Replace duplication with segmented filters: all/decorari/neutralizari/intarziate. | M | 2 |
| COO dashboard too broad | COO dashboard | P2 | `CooCommandCenter.tsx` | One page has issues, sales, CRM, operations, inventory, finance, exports, admin. | COO home should show priorities and link to dedicated pages. | Daily priority is buried. | Keep overview + critical queues; move modules to separate pages. | M | 2 |
| Admin header lacks active state and destination clarity | Navigation | P2 | `AdminHeader.tsx` | Buttons are all styled the same; "Public" is prominent in admin nav. | Active page state and role-specific nav order. | Users cannot orient quickly. | Add active state and demote public link. | S | 1 |
| "Backup JSON" label is developer-ish | Locations | P2 | `AdminDashboard.tsx` | Admin sees "Backup JSON". | Label as "Export inventar JSON" or move to admin/export area. | Confusing to non-technical users. | Rename or move. | S | 1 |
| Location editor is not tabbed | Locations | P2 | `LocationEditor.tsx` | Huge modal mixes all fields. | Tabs: Overview, Comercial, Disponibilitate, Galerie, Operational, Financiar, Documente, Istoric, Avansat. | Editing is slow and error-prone. | Add internal section tabs without changing schema. | M | 3 |
| Images are URL text, not gallery management | Locations | P2 | `LocationEditor.tsx`, `src/components/public/*` | Gallery is managed through URL textarea. | Preview, main image selector, add/remove/reorder. | Public inventory quality suffers. | Add gallery panel using existing `Image` records. | M | 3 |
| Large client-side state in huge components | Technical | P2 | `AdminReservationsPanel.tsx`, `ClientCampaignsWorkspace.tsx`, `CooCommandCenter.tsx`, `FinancialDashboardPanel.tsx` | Many workflows share state in one file. | Small workflow components with service helpers. | Bugs hide in stale local state and duplicated formatting. | Extract only after UX changes are clear. | L | 6 |
| Server-side pagination missing | Performance | P2 | `listReservations`, `listAdminLocations`, clients/suppliers APIs, dashboard | Large `take: 500/800/1000/5000` lists and client-side filtering. | Paginated/searchable server endpoints. | Slow pages as data grows. | Add pagination to one module at a time. | M | 6 |
| Dashboard conflict grouping by code | COO dashboard | P2 | `src/lib/dashboard.ts` | Conflicts are grouped by `location.code`. | Use `location.id` and display code only as label. | Duplicate code or code changes can mislead COO. | Change grouping key, add test. | S | 2 |
| Mixed English/Romanian labels | UX copy | P3 | Multiple components | "Needs Review", "Operational Health", "Accounts OOH", "Backup JSON". | Consistent Romanian business labels. | Reduces trust and clarity. | Copy cleanup pass. | S | 2 |
| No browser-friendly empty states in some tables | UX polish | P3 | Finance, client/campaign, dashboard tables | Some empty rows are generic. | Empty state should say next action. | Users do not know what to do next. | Add contextual empty messages. | S | 5 |
| Shortlist localStorage has limited recovery | Public | P3 | `LocationExplorer.tsx` | Invalid localStorage falls back silently. | Clear invalid shortlist and optionally show tiny notice. | Public user may lose shortlist silently. | Minor hardening. | S | 5 |

## C. Button / Navigation Audit Table

| Page | Button / action | Current behavior | Problem | Correct behavior / destination | Fix recommendation |
|---|---|---|---|---|---|
| Admin header | Dashboard | `/admin/dashboard` | Good, but no active state. | Same destination with active styling. | Add current-route highlight. |
| Admin header | Public | `/locatii` | Public page is prominent inside admin. | Keep, but secondary / lower priority. | Move to dropdown or label "Vezi portal public". |
| Admin header | Locatii | `/admin/locatii` | This is also reservation hub. | Inventory page only. | Split reservations into `/admin/rezervari`. |
| Admin header | Clienti / Campanii | `/admin/clienti`, `/admin/campanii` | Both load same workspace. | Dedicated list/detail pages. | Add `/admin/clienti/[id]` and `/admin/campanii/[id]`. |
| Role dashboard | Vezi inventarul | `/admin/locatii` | OK for inventory but lands in mixed page. | Inventory list. | Keep after page split. |
| Role dashboard | Actiune comerciala | `/admin/locatii#rezervari` | Generic anchor; not a real action. | `/admin/rezervari/new` or open create reservation. | Add deep link/new route. |
| Role dashboard | Operations preview "Vezi toate" | `/admin/locatii#rezervari` | Operational users land in reservation hub. | `/admin/operational`. | Add operational page. |
| Role dashboard | Recent campaigns "Deschide" | `/admin/locatii#rezervari` | Does not open selected row. | Reservation/campaign detail. | Add row-specific links. |
| Dashboard hold actions | Detalii | `/admin/locatii#rezervari` | User must search again. | `/admin/rezervari/[id]`. | Add reservation detail route or filtered query. |
| Dashboard hold actions | Schimba perioada | `window.prompt` | Weak validation and no conflict preview. | Modal with availability check. | Replace prompt. |
| COO header | Creeaza rezervare | `/admin/locatii#rezervari` | Generic. | `/admin/rezervari/new`. | Add new reservation route. |
| COO header | Adauga locatie | `/admin/locatii` | Does not open create modal directly. | `/admin/locatii/new` or query opens editor. | Add action route/query. |
| COO issues | Marcheaza rezolvat | Appends note | Not actual resolution. | Real resolution/exception model or hide. | Remove until durable. |
| COO issues | Aproba exceptie | Appends note | No durable exception status. | Durable exception with audit. | Remove or implement model. |
| COO issues | Creeaza task | Writes legacy status/note | Not a real task record in production. | OperationTask-only behind staging flag or "Adauga nota". | Rename/hide. |
| COO hold card | Confirma | Command-center route | Useful but should show only for eligible status. | Same with confirmation and availability summary. | Add modal/eligibility display. |
| COO hold card | Elibereaza | Direct command | Destructive; minimal confirmation currently via command helper for some actions. | Confirm with exact code/client. | Add contextual confirmation. |
| COO task row | Finalizat | Command-center operation status | Useful, recently fixed. | Same, plus optional cost if montaj requires billing. | Keep; add cost-required flow. |
| COO task row | Vezi contract | `/admin/locatii#rezervari` | Generic. | Reservation detail. | Deep-link. |
| Admin locations | Adauga locatie | Opens modal | Good but modal overloaded. | Location detail/create with tabs. | Keep short term; tab modal. |
| Admin locations | Backup JSON | `/api/export/json` | Technical label and placed next to create. | "Export inventar JSON" in exports/admin area. | Rename/move. |
| Admin locations table | Status select | Direct PATCH from table | Too easy to change without context. | Status in detail/commercial/availability tab. | Move or require confirmation for public-impacting status. |
| Admin locations table | Public toggles | Direct PATCH from table | Public exposure changes are very visible/quick. | Visibility section with preview. | Move to detail or add confirmation. |
| Admin locations table | Duplicate | POST then full reload | Works but heavy and context-less. | Duplicate wizard or confirmation with copied code. | Move into action menu. |
| Admin locations table | Delete | Visible trash button | Dangerous action too visible. | Advanced menu + contextual confirm. | Move into overflow. |
| Reservations panel | Sync rezervari | Legacy sync action | Powerful/admin-ish action inside daily workflow. | Admin/manual sync page only. | Move to admin/import area. |
| Reservations panel | Export Excel | Useful but shares page with create form. | Reports mixed with workflow. | Reports/export section. | Move after page split. |
| Reservation form | Curata | Resets form | Useful but can lose data. | Reset with confirmation if dirty. | Add dirty-state guard. |
| Client workspace | Campanie noua | Inline editor in client detail | Useful. | Client detail tab. | Keep but move to route later. |
| Campaign table | Schimbare vizual | Opens redecoration modal | Useful but small button repeated per rental. | Operations tab/action menu per reservation. | Keep short term; move to campaign detail. |
| Client workspace | Incasata / Partial | Full direct, partial prompt | Prompt risks wrong amount. | Payment modal. | Replace prompt. |
| Cleanup tab | Merge in primul | Merges duplicate client | Dangerous but confirmed. | Dedicated duplicate review page. | Keep with better diff summary. |
| Cleanup tab | Arhiveaza duplicat | Archives duplicate invoice | Dangerous but confirmed and backend checks exist. | Dedicated duplicate invoice review. | Add side-by-side validation summary. |
| Finance dashboard | Confirma raportul | Confirms upload | Useful. | Keep; show blocking issue count and active version impact. | Add clearer summary before confirm. |
| Finance review | Exclude | Direct exclude button | Can remove from totals quickly. | Needs reason, already has reason when panel open but button is visible. | Open reason modal before exclude. |
| CRM workspace | Creeaza hold | `/admin/locatii#rezervari` | Generic; does not carry lead context. | Create hold with CRM lead prefilled. | Add query params/new hold route. |

## D. Panel Simplification Plan

### Admin Locations Panel

Keep:
- Search, category filter, public/admin visibility indicators, GPS status, high-level availability.

Remove from first view:
- Inline price editing, availability text editing, public toggles, duplicate/delete buttons, raw GPS coordinates.

Move:
- Reservation workflow to `/admin/rezervari`.
- Export and backup actions to Reports/Admin.
- Dangerous actions to an overflow menu.

Suggested structure:
- Overview: code, address, category, city, public status, computed availability.
- Comercial: rate card, public price toggle, installation/removal cost toggle, display labels.
- Disponibilitate: status, availability text, blocks, active reservations.
- Galerie / Poze: preview, main image, gallery reorder.
- Operational: GPS audit, display vs real coordinates, blocked reason.
- Financiar: supplier/cost/monthly cost/internal cost notes.
- Documente: contracts, permits, images.
- Istoric / Audit: changes and imports.
- Setari avansate: raw fields, duplicate, delete/archive.

### COO Dashboard

Keep:
- Critical issues, active/expired holds, overdue operations, starting/ending campaigns, finance overdue summary.

Remove or reduce:
- Duplicate operations tables.
- Admin and exports tabs from daily COO home.
- Generic inventory breakdowns unless they link to filtered inventory.

Rename:
- "Operational Health" -> "Stare operationala".
- "Conflict Center" -> "Suprapuneri contracte".
- "Taskuri operationale active" -> "Operatiuni de facut".

Deep-link:
- Every problem row to reservation/client/campaign/location detail.

Separate page:
- `/admin/operational` for operational task work.
- `/admin/rapoarte` or admin exports panel for export actions.

### Reservation Form

Keep in main form:
- Status, selected locations, client/campaign for BOOKED, hold client for HOLD/RESERVED, seller, contract company, contract number, rent, currency, period start/end.

Keep optional/collapsed:
- Billing rule/frequency/day/custom date, billing notes.
- Contact email/phone for hold.
- Production notes/internal notes.

Improve:
- Make montaj/decorare cost request appear only when "Necesita montaj" is checked.
- Add dirty-state warning before "Curata".
- Add availability/conflict preview before create/update.
- Replace group edit table interactions with a clearer "applies to all locations" summary.

Separate page:
- `/admin/rezervari/new`
- `/admin/rezervari/[id]`

### Client / Campaign Detail

Client detail tabs:
- Overview
- Campanii
- Rezervari
- Financiar
- Documente
- Contacte
- Istoric

Campaign detail tabs:
- Overview
- Locatii
- Rezervari
- Operational
- Financiar
- Documente
- Istoric

Keep cleanup:
- Duplicate clients and duplicate invoices should become a review queue, not a tab beside daily client work.

### Finance Dashboard

Keep:
- Upload preview/confirm, review/exclude, manual entry, receivable/payable lists.

Reorder:
- Daily priorities first: overdue, due today, next 7 days.
- Then review rows.
- Then upload/manual entry.

Improve:
- Replace partial payment prompt with modal.
- Add links from receivable rows to client/campaign/reservation when known.
- Add "montaj finalizat fara cost" warning in finance or operations view.
- Use Romanian labels consistently.

### Operations

Recommended new page: `/admin/operational`

Sections:
- Azi
- Saptamana asta
- Intarziate
- De montat
- De neutralizat
- Redecorari
- Finalizate
- Cost montaj lipsa
- Probleme

Rules:
- Feature flags stay off in production.
- Continue productionNotes mirroring while OperationTask migration remains transitional.
- Reads can use legacy productionNotes until OperationTask read flag is intentionally staged.

## Role-Specific UX

| Role | Daily need | Current noise | Buttons to hide or demote | First dashboard should show |
|---|---|---|---|---|
| Sales Agent | Leads, own holds, own campaigns, next follow-up, available inventory. | Operations preview and generic reservation hub links. | Operation status changes, admin exports, team/global finance. | Own follow-ups, expiring holds, available inventory search, active deals. |
| Sales Director | Team pipeline, holds needing decision, seller performance, conflict handoff. | Raw admin tools and operational details. | Inventory destructive actions, finance upload. | Team holds, overdue follow-ups, monthly sales, seller ranking. |
| COO | Conflicts, overdue tasks, holds stuck, starting/ending campaigns, operational blockers. | Too many tabs and duplicate task lists. | Generic exports/admin shortcuts from main view. | Critical issues, today's operations, this week's changes, blocked inventory. |
| Finance | Overdue receivables/payables, today's cash, review rows, uploads. | Operations preview before finance panel. | Inventory/admin/task actions. | Cash due today, overdue, review import issues, upload status. |
| Super Admin | System health, users, audit, all modules. | Same operational noise as COO/sales unless needed. | None globally, but admin tools should be grouped. | System health, recent audit, failed imports, permission/user tasks. |

## Technical / Product Quality Notes

- Oversized components remain the biggest maintainability risk:
  - `src/components/admin/AdminReservationsPanel.tsx`
  - `src/components/admin/ClientCampaignsWorkspace.tsx`
  - `src/components/admin/CooCommandCenter.tsx`
  - `src/components/admin/FinancialDashboardPanel.tsx`
- Route handlers have improved domain calls, but command-center still contains mixed workflow logic.
- Status strings are partially centralized but still displayed/raw in several tables.
- Many lists use client-side filtering over large `take` limits.
- Public DTO privacy is currently protected by serializer deletion and tests; keep `test:public-visibility` in the required suite for any public-location work.
- OperationTask bridge/read adapter remains behind disabled production flags; do not rely on it for production readers yet.
- Browser prompt usage should be removed from financial and reservation workflows before additional UX complexity is added.

## Routes / Pages Inspected

- `/locatii` source through public components and public location serializer.
- `/admin/dashboard`
- `/admin/locatii`
- `/admin/clienti`
- `/admin/campanii`
- `/admin/crm`
- `/admin/furnizori`
- `/admin/locatii/import`
- `/admin/locatii/gps`
- API routes for command center, reservations, operations, locations, financial rows/uploads/payments, clients, documents and seller reassignments.

## Files Inspected

- `package.json`
- `prisma/schema.prisma`
- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/locatii/page.tsx`
- `src/app/admin/clienti/page.tsx`
- `src/app/admin/campanii/page.tsx`
- `src/app/admin/furnizori/page.tsx`
- `src/app/api/admin/command-center/route.ts`
- `src/app/api/reservations/[id]/operations/route.ts`
- `src/app/api/reservations/[id]/route.ts`
- `src/app/api/reservations/[id]/group/route.ts`
- `src/app/api/locations/route.ts`
- `src/app/api/locations/[id]/route.ts`
- `src/components/admin/AdminHeader.tsx`
- `src/components/admin/RoleDashboard.tsx`
- `src/components/admin/CooCommandCenter.tsx`
- `src/components/admin/DashboardHoldActions.tsx`
- `src/components/admin/AdminDashboard.tsx`
- `src/components/admin/LocationEditor.tsx`
- `src/components/admin/AdminReservationsPanel.tsx`
- `src/components/admin/ClientCampaignsWorkspace.tsx`
- `src/components/admin/FinancialDashboardPanel.tsx`
- `src/components/admin/CrmWorkspace.tsx`
- `src/components/admin/SupplierWorkspace.tsx`
- `src/components/public/LocationExplorer.tsx`
- `src/components/public/LocationPresentation.tsx`
- `src/components/public/LocationMiniPreview.tsx`
- `src/components/public/ShortlistDrawer.tsx`
- `src/lib/dashboard.ts`
- `src/lib/locations.ts`
- `src/lib/reservations.ts`
- `src/lib/reservation-lifecycle.ts`
- `src/lib/operation-status.ts`
- `src/lib/operation-task-read-adapter.ts`
- `src/lib/operation-task-bridge.ts`
- `src/lib/decoration-billing.ts`
- `src/lib/client-campaigns.ts`
- `src/lib/financial-dashboard.ts`
- `src/lib/financial-review.ts`
- `src/lib/financial-integrity.ts`
- `src/lib/rbac.ts`

## Checks Run

| Command | Result | Notes |
|---|---:|---|
| `pnpm run typecheck` | PASS | First attempt failed because Windows PATH lacked Node; rerun with bundled Node succeeded. |
| `pnpm run test:rbac` | PASS | 18 checks. |
| `pnpm run test:availability` | PASS | Includes legacy BOOKED blocking and cancelled/archived non-blocking checks. |
| `pnpm run test:reservation-route-safety` | PASS | Seller reassignment and command-center lifecycle source checks pass. |
| `pnpm run test:billing` | PASS | Invoice/due date, month-end, campaign-start, 12 months and prorata checks pass. |
| `pnpm run test:finance-consistency` | PASS | Financial edit/payment/merge consistency checks pass. |
| `pnpm run test:operation-task-reads` | PASS | OperationTask read adapter flag/fallback/dedupe checks pass. |
| `pnpm prisma validate` | PASS | Prisma schema valid. |

Browser smoke: not run. There was no safe authenticated admin browser session provided, and this audit avoided production mutations. Public/admin browser QA should be part of implementation batches, not this read-only audit.

## E. Recommended Next Implementation Batches

### Batch 1 - Broken Buttons / Deep-Link Fixes

Goal: remove the most frustrating navigation dead-ends.

Scope:
- Add reservation detail route or interim filtered query route.
- Update "Detalii", "Vezi detalii", "Vezi contract", "Deschide" links.
- Add exact links for client/campaign/location where IDs are available.
- Add active admin header state.
- Rename "Backup JSON" to "Export inventar JSON".

Why first: low product risk, high daily usability value.

### Batch 2 - Dashboard Noise Cleanup

Goal: make COO and role dashboards show practical priorities.

Scope:
- Remove duplicate COO operations tables.
- Hide/disable `markResolved` and `approveException` until a real conflict-resolution model exists.
- Rename mixed-language headings.
- Fix neutralization default rule if business confirms `periodEnd` is default.
- Move export/admin shortcuts lower or into a separate panel.

Why second: reduces operational confusion before bigger page splits.

### Batch 3 - Locations Panel Simplification

Goal: make inventory management safer and easier.

Scope:
- Move duplicate/delete/public toggles into row action menu or editor.
- Add tabs/sections inside `LocationEditor`.
- Move raw/private fields to advanced sections.
- Add gallery preview.
- Keep API/schema unchanged.

Why third: safer inventory edits without a schema migration.

### Batch 4 - Reservation Workflow Cleanup

Goal: make hold/reserved/booked edits clearer and safer.

Scope:
- Replace period-change prompts with modal and conflict preview.
- Add dirty-state confirmation for reset/clear.
- Make status-specific buttons visible only when valid.
- Add exact booking/hold requirements in form.
- Keep billing/contact/notes optional.

Why fourth: touches core sales workflow, needs careful tests.

### Batch 5 - Operations / Finance Practical Improvements

Goal: make montaj and cash work daily-actionable.

Scope:
- Add `/admin/operational` read-only first.
- Add "Azi / Saptamana asta / Intarziate / Finalizate / Cost montaj lipsa".
- Keep OperationTask flags disabled in production.
- Replace partial-payment prompt with modal.
- Link finance rows to client/campaign/reservation when possible.

Why fifth: builds on navigation and dashboard cleanup.

## Immediate P0/P1 Conclusion

No immediate P0 was found in this practical audit. The existing P0/P1 stabilization work appears covered by tests for public visibility, RBAC, reservation route safety, billing and finance consistency.

Immediate P1 fixes recommended before broader UX cleanup:

1. Remove or disable COO conflict actions that only append notes.
2. Align operation action button visibility with `campaigns.operate`.
3. Replace generic reservation links with exact deep links or filtered routes.
4. Replace prompt-based period change with a modal and availability recheck.
5. Review neutralization default business rule to avoid false COO warnings.

Safe to commit this audit report: yes. It is documentation-only.
