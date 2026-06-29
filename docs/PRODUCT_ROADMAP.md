# Focus Media Platform Roadmap

Date: 2026-06-29

Scope: product and architecture roadmap for evolving the Focus Media locations app into a complete sales, operations and finance platform. This document is planning-only. It does not propose enabling OperationTask flags in production, running backfills, deploying, or implementing quote/offer flows immediately.

## 1. Current App Status

### What Works Well Today

- Public inventory exists at `/locatii` with filters, map, cards, presentation overlays, shortlist drawer, Excel export and public offer request submission.
- Public API privacy has been hardened: hidden prices, hidden install costs, private coordinates, reservations, internal notes, financial data and documents are not exposed by public serializers.
- Admin inventory has a scan-first locations table, a location detail drawer, an edit modal split into sections, public-impact warnings and safer duplicate/delete actions.
- Location detail drawer gives a practical view of public presentation plus future HOLD / RESERVED / BOOKED periods.
- Reservations support HOLD / RESERVED / BOOKED lifecycle, conflict preview, transactional conflict checks, seller assignment protections and atomic group edits.
- COO and role dashboards have been cleaned up and now focus more on priorities, holds, conflicts, operations and finance.
- Client/campaign workspace connects clients, campaigns, reservations, contacts, documents, receivables and cleanup views.
- Finance dashboard has SmartBill import MVP with required company context, preview/review buckets, manual correction actions, storno/discount handling and safer confirm flow.
- Montaj/decorare cost tracking exists through productionNotes metadata and monthly billing summary/export.
- OperationTask relational foundation exists behind disabled flags with legacy fallback and productionNotes mirroring.
- RBAC and document access protections were strengthened, with coverage for public/private data, sales ownership and finance permissions.

### What Is Still Fragile

- Public "media plan" is currently a client-side shortlist plus export/contact request, not a saved commercial object.
- `OfferRequest` captures interest, but there is no MediaPlan / Quote / OfferLink lifecycle yet.
- Operation status still relies on legacy productionNotes in production. OperationTask exists, but is not authoritative.
- SmartBill imports finance rows, but there is no dedicated credit note / receivable adjustment model yet.
- Clients, campaigns and reservations do not have dedicated detail pages. Users still work through large panels.
- `/admin/locatii` still combines inventory and reservation workflows.
- Dashboard data still aggregates several domains in `src/lib/dashboard.ts`.
- Several workflows remain in large client components:
  - `src/components/admin/AdminReservationsPanel.tsx`
  - `src/components/admin/ClientCampaignsWorkspace.tsx`
  - `src/components/admin/CooCommandCenter.tsx`
  - `src/components/admin/FinancialDashboardPanel.tsx`
- Server-side pagination is still inconsistent for large admin lists.
- Scheduled jobs, queues, external observability and distributed login rate limiting remain future infrastructure work.

### Where Users May Still Get Confused

- Public users see "media plan" wording, but it is not a saved plan yet.
- Sales users create holds/reservations directly, but cannot yet build a professional offer link first.
- COO can see operational tasks, but there is no dedicated operational workbench with day/week/late grouping.
- Finance can import SmartBill, but review/correction, credit notes and campaign profitability still need a clearer permanent model.
- Client/campaign data appears in a shared workspace, so it is hard to answer "what happened to this client/campaign?" quickly.
- Location availability is much clearer after the detail drawer, but full reservation detail still requires focused links into `/admin/locatii`.

## 2. Target Product Architecture

The desired platform flow:

```text
Location inventory
  -> public presentation
  -> shortlist
  -> media plan draft
  -> secure offer link
  -> client accept / change request
  -> HOLD / reservation
  -> contract / campaign
  -> operations / implementation
  -> invoicing / SmartBill
  -> payment tracking
  -> margin / profitability
  -> final report
```

Recommended domains:

| Domain | Purpose | Source of truth |
|---|---|---|
| Inventory | Locations, photos, public/private fields, availability inputs | `Location`, `Image`, reservation-derived availability |
| Public sales | Premium catalog, public cards, shortlist, offer request | Public DTOs, local shortlist, `OfferRequest` |
| CRM / sales | Leads, clients, campaign intent, seller ownership | `CrmLead`, `OfferRequest`, `ClientAccount`, `Campaign` |
| Media planning | Saved proposal draft with pricing snapshots | Future `MediaPlan`, `MediaPlanItem` |
| Offer links | Secure client-facing proposal page and response tracking | Future `Offer`, `OfferEvent` or MediaPlan token fields |
| Reservations | HOLD / RESERVED / BOOKED / CANCELLED / EXPIRED lifecycle | `Reservation`, domain service in `src/lib/reservations.ts` |
| Campaign / contract | Commercial wrapper around reservations | `Campaign`, `Reservation`, documents |
| Operations | Decoration, neutralization, redecoration, issues, photos, cost | Phase-in `OperationTask`, legacy productionNotes during transition |
| Finance | SmartBill imports, receivables, payables, payments, adjustments | `FinancialReceivable`, `FinancialPayable`, future adjustment model |
| Reporting | Dashboards, exports, profitability, final reports | Read models over all domains |
| Platform | RBAC, audit, notifications, jobs, logging | `User`, RBAC, `AuditLog`, `AppNotification`, future jobs |

## 3. Recommended Domain Boundaries

### Inventory

Keep inventory focused on locations, photos, public presentation and sellability. It should not own reservations, invoicing or operations history, but it should show linked summaries.

Likely files/modules:
- `src/lib/locations.ts`
- `src/lib/location-mutations.ts`
- `src/components/admin/AdminDashboard.tsx`
- `src/components/admin/LocationEditor.tsx`
- `src/components/admin/LocationDetailDrawer.tsx`
- `src/components/public/*`

### Sales / CRM

Sales should progress from lead to media plan to offer to HOLD. Avoid creating BOOKED directly from public/client acceptance.

Likely files/modules:
- `src/lib/offer-requests.ts`
- `src/lib/clients.ts`
- `src/lib/client-campaigns.ts`
- `src/components/admin/CrmWorkspace.tsx`
- future `src/lib/media-plans.ts`

### Reservation / Booking

Reservations remain the authority for availability blocking. Every conversion from offer to hold must recheck conflicts in the same safe domain path.

Likely files/modules:
- `src/lib/reservations.ts`
- `src/lib/reservation-workflow.ts`
- `src/lib/reservation-lifecycle.ts`
- `src/app/api/reservations/*`
- `src/app/api/admin/reservations/conflict-preview/route.ts`

### Operations

Operations should gradually move from productionNotes metadata to relational OperationTask, but only after staged read/write verification and rollback confidence.

Likely files/modules:
- `src/lib/operation-status.ts`
- `src/lib/operation-tasks.ts`
- `src/lib/operation-task-bridge.ts`
- `src/lib/operation-task-read-adapter.ts`
- `src/app/api/reservations/[id]/operations/route.ts`
- future `/admin/operational`

### Finance

Finance should treat SmartBill as main external source, but internal profitability must connect invoices and supplier costs back to campaign/reservation/location/operation.

Likely files/modules:
- `src/lib/smartbill-import.ts`
- `src/lib/financial-dashboard.ts`
- `src/lib/financial-integrity.ts`
- `src/lib/financial-review.ts`
- `src/components/admin/FinancialDashboardPanel.tsx`
- future adjustment/credit note service

## 4. Phased Roadmap

### Phase 0 - Stabilization / QA Foundation

Goal: make every future change safe to test and deploy.

User value:
- Fewer regressions.
- Safer production deployments.
- Clear staging validation before changing business-critical flows.

Likely files/modules:
- `scripts/*` tests and smoke checks
- docs/deploy checklist
- Vercel project/env configuration
- RBAC and public API tests

Data model changes:
- None.

Risks:
- False confidence if staging DB does not match production shape.
- Browser flows may still be untested if no stable test accounts exist.

Testing needed:
- Typecheck.
- Public API leak tests.
- RBAC tests.
- Reservation conflict/lifecycle tests.
- Finance import tests.
- Browser smoke for public/admin/finance.

Deployment strategy:
- No feature flags enabled by default.
- Keep rollback deployment ID visible for every production release.

### Phase 1 - Public Redesign

Goal: make `/locatii` feel like a premium outdoor media catalog.

User value:
- Public visitors understand locations faster.
- Sales receives higher-quality requests.
- Shortlist feels like a sales basket, not a raw list.

Likely files/modules:
- `src/app/locatii/page.tsx`
- `src/app/locatii/[id]/page.tsx`
- `src/components/public/LocationExplorer.tsx`
- `src/components/public/LocationCard.tsx`
- `src/components/public/LocationPresentation.tsx`
- `src/components/public/LocationMiniPreview.tsx`
- `src/components/public/ShortlistDrawer.tsx`
- `src/lib/locations.ts`

Data model changes:
- None for MVP.

Risks:
- Accidentally exposing private fields in a nicer UI.
- Making mobile layout too heavy.

Testing needed:
- Public visibility tests.
- Browser smoke for `/locatii`, presentation overlay, detail page, shortlist.
- Mobile viewport checks.

Deployment strategy:
- Ship as UI-only behind existing public DTO rules.

### Phase 2 - Media Plan MVP

Goal: create saved internal commercial proposal drafts.

User value:
- Sales can prepare proposals without immediately creating holds.
- Prices and location snapshots are preserved.
- Availability can be checked before sending.

Likely files/modules:
- Future `src/lib/media-plans.ts`
- Future `/admin/media-plan`
- Future `/admin/media-plan/[id]`
- Public shortlist integration
- `src/lib/availability.ts`
- `src/lib/admin-routes.ts`

Data model changes:
- Add `MediaPlan`.
- Add `MediaPlanItem`.
- Possibly add `MediaPlanEvent` or reuse `AuditLog`.

Risks:
- Confusion between MediaPlan, Campaign and Reservation.
- Pricing changing after draft creation.
- Availability becoming stale between draft and send.

Testing needed:
- Snapshot tests.
- Availability check tests.
- RBAC tests for own vs global plans.
- No public data leak tests.

Deployment strategy:
- Internal-only first.
- Do not create public offer links in this phase.

### Phase 3 - Public Offer Link

Goal: send secure, professional client-facing offer links.

User value:
- Clients can review locations and prices in one branded page.
- Client acceptance/change requests are captured cleanly.
- Sales gets a clear next action.

Likely files/modules:
- Future `/oferta/[token]`
- Future `/api/offers/[token]`
- Future `src/lib/offer-links.ts`
- `MediaPlan` service
- notifications/audit

Data model changes:
- Either add `Offer` / `OfferEvent`, or add offer token/status fields to `MediaPlan`.

Risks:
- Public token leaking internal pricing or admin fields.
- Client acceptance being mistaken for confirmed booking.
- Expired links still being actionable.

Testing needed:
- Token security tests.
- Expiry tests.
- Public privacy tests.
- Accept/change request tests.

Deployment strategy:
- Start with read-only offer view.
- Then add accept/change request.

### Phase 4 - Convert Offer To HOLD

Goal: convert accepted offers into HOLD/reservation only after availability recheck.

User value:
- Sales can quickly act on accepted offers.
- Availability integrity is preserved.

Likely files/modules:
- `src/lib/reservations.ts`
- `src/lib/availability.ts`
- Future `src/lib/media-plans.ts`
- Future offer action routes

Data model changes:
- Link `MediaPlanItem` to created `Reservation`.
- Track converted timestamp/user.

Risks:
- Race conditions if conversion bypasses reservation domain service.
- Partial conversion for multi-location offers.

Testing needed:
- Conflict recheck inside reservation transaction.
- Multi-location conversion rollback.
- Accepted offer with unavailable location.
- Audit log coverage.

Deployment strategy:
- Admin action only.
- Never auto-create BOOKED from public acceptance.

### Phase 5 - Admin Detail Pages

Goal: make every important record inspectable by direct URL.

User value:
- Staff can answer: what is this, who owns it, what happened, what needs action, what is connected?

Likely routes:
- `/admin/locatii/[id]`
- `/admin/clienti/[id]`
- `/admin/campanii/[id]`
- `/admin/rezervari/[id]`
- `/admin/media-plan/[id]`
- `/admin/oferte/[id]`

Data model changes:
- None required for read-only MVP.

Risks:
- Duplicating logic from current large workspaces.
- RBAC leaks through detail pages.

Testing needed:
- Role-based visibility tests.
- Public/private field tests.
- Deep-link tests.

Deployment strategy:
- Add read-only detail pages first.
- Move edit actions gradually.

### Phase 6 - Operations Dashboard

Goal: dedicated operational workbench for implementation and issues.

User value:
- Operators and COO know what must be done today and this week.
- Costs/photos/statuses become reportable.

Likely files/modules:
- Future `/admin/operational`
- `src/lib/operation-task-read-adapter.ts`
- `src/lib/operation-task-bridge.ts`
- `src/lib/decoration-billing.ts`

Data model changes:
- OperationTask already exists.
- Future: operation photos/documents, issue model, task events.

Risks:
- OperationTask/prodNotes divergence.
- Prematurely making OperationTask authoritative.

Testing needed:
- Legacy vs relational comparison.
- Task status RBAC.
- ProductionNotes mirroring.
- Photos/cost visibility tests.

Deployment strategy:
- Read-only page first using legacy fallback.
- Enable OperationTask reads only in staging, then carefully in production.

### Phase 7 - Finance Polish

Goal: complete SmartBill, payment tracking and profitability.

User value:
- Finance sees overdue, due soon, payments, payables and margin.
- Management can see profitability by client/campaign/location.

Likely files/modules:
- `src/lib/smartbill-import.ts`
- `src/lib/financial-dashboard.ts`
- `src/components/admin/FinancialDashboardPanel.tsx`
- Future adjustment services/models

Data model changes:
- Add `ReceivableAdjustment` / `CreditNote`.
- Possibly add `PaymentAllocation`.
- Optional `CampaignCost` for non-operation costs.

Risks:
- Incorrect credit note application.
- Mixing company contexts.
- Profitability mismatch if costs are not linked to campaign/reservation/location.

Testing needed:
- SmartBill parser/preview/confirm tests.
- Adjustment/idempotency tests.
- Payment allocation tests.
- Margin calculation tests.

Deployment strategy:
- Keep preview-before-confirm.
- Manual review remains required for ambiguous rows.

### Phase 8 - Internal Launch

Goal: roll out the platform as daily operating system.

User value:
- Each role has one clear daily workspace.
- The company can operate from one source of truth.

Likely work:
- Test accounts.
- Training docs.
- Role-specific dashboards.
- Final data cleanup.
- Monitoring and support process.

Data model changes:
- None required.

Risks:
- Team adoption issues.
- Legacy spreadsheets continuing in parallel.
- Production/staging DB confusion.

Testing needed:
- Full end-to-end scenario from public shortlist to payment tracking.
- Browser QA on desktop/mobile.
- Rollback drill.

Deployment strategy:
- Staged internal rollout.
- Daily check-ins for first week.

## 5. Privacy And RBAC Notes

Public users:
- Can see only public DTO fields.
- Can shortlist public locations.
- Can submit offer requests.
- Must never see internal notes, private coordinates, costs, reservations, documents, seller data, finance data or operational private data.

Clients with offer links:
- Can see only their offer/media plan snapshot.
- Should not need login for viewing.
- Can accept or request changes.
- Must not see admin notes, internal costs, other client reservations or SmartBill data.

Sales Agent:
- Can view/manage own clients, leads, reservations and media plans.
- Can view inventory and availability.
- Should not mutate operation status or see broad finance/cost details.

Sales Director:
- Can view team sales, approve proposals and manage sales reservations.
- Should not perform finance import unless separately granted.

COO:
- Can view/manage operations, reservations, inventory, clients/campaigns and cross-client activity.
- Can see operational costs if business allows.
- Should see finance summaries, but not necessarily full import controls unless granted.

Finance:
- Can view/import/review financial data.
- Can see clients/campaigns needed for matching.
- Should not manage inventory lifecycle or operations status.

Operational:
- Recommended future role.
- Can view assigned tasks, update implementation status, upload photos, enter actual costs if allowed.
- Should not see finance totals unless allowed.

Super Admin:
- Full access.
- Owns settings, users, audit, rollback and data cleanup tools.

## 6. Key Risks

- Public redesign may accidentally expose internal fields if components consume admin DTOs.
- Media plan snapshots can drift from live inventory; must define snapshot vs live clearly.
- Offer acceptance can create expectations but not guarantee availability; conversion must recheck conflicts.
- Reservation and OperationTask domains can diverge if writes are not mirrored during transition.
- SmartBill credit notes need a proper adjustment model before heavy long-term usage.
- Large components can continue to create stale local state bugs if new modules are added inside them.
- Production and staging environment separation must stay explicit before major finance/offer rollout.

## 7. Files Inspected For This Roadmap

- `package.json`
- `prisma/schema.prisma`
- `CURRENT_APP_PRACTICAL_AUDIT.md`
- `docs/OOH_APP_OVERVIEW.md`
- `src/app/locatii/page.tsx`
- `src/app/locatii/[id]/page.tsx`
- `src/app/api/locations/route.ts`
- `src/app/api/admin/locations/[id]/availability-timeline/route.ts`
- `src/app/admin/locatii/page.tsx`
- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/clienti/page.tsx`
- `src/app/admin/campanii/page.tsx`
- `src/components/public/LocationExplorer.tsx`
- `src/components/public/LocationCard.tsx`
- `src/components/public/LocationPresentation.tsx`
- `src/components/public/LocationMiniPreview.tsx`
- `src/components/public/ShortlistDrawer.tsx`
- `src/components/admin/AdminDashboard.tsx`
- `src/components/admin/LocationDetailDrawer.tsx`
- `src/components/admin/AdminReservationsPanel.tsx`
- `src/components/admin/CooCommandCenter.tsx`
- `src/components/admin/RoleDashboard.tsx`
- `src/components/admin/ClientCampaignsWorkspace.tsx`
- `src/components/admin/FinancialDashboardPanel.tsx`
- `src/lib/locations.ts`
- `src/lib/dashboard.ts`
- `src/lib/rbac.ts`
- `src/lib/admin-routes.ts`
- `src/lib/company-entities.ts`
- `src/lib/media-plan.ts`
- `src/lib/media-plan-download.ts`
- `src/lib/decoration-billing.ts`
- `src/lib/smartbill-import.ts`
- `src/lib/financial-dashboard.ts`
- `src/lib/client-campaigns.ts`
- `src/lib/operation-tasks.ts`
- `src/lib/operation-task-read-adapter.ts`

## 8. Recommended First Build Batch

Recommended first batch: Public Redesign MVP.

Reason:
- It gives immediate business value.
- It does not require a database migration.
- It uses existing public DTO privacy protections.
- It prepares the surface for future MediaPlan without building offer/quote yet.

See `docs/NEXT_IMPLEMENTATION_BATCH.md` for exact scope.
