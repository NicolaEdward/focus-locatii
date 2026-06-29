# Operations And Finance Roadmap

Date: 2026-06-29

Goal: build practical operational and financial control without making OperationTask authoritative prematurely and without bypassing SmartBill preview/review safety.

## 1. Operations Current State

Current strengths:

- Decoration and neutralization are visible in COO/dashboard flows.
- Montaj/decorare DONE status can carry cost.
- Monthly "Facturare montaj" summary exists.
- OperationTask model, service foundation, backfill and read adapter exist behind disabled flags.
- ProductionNotes remains active and mirrored by bridge paths.
- Operation status mutations require operations/admin permission.

Current limitations:

- Production operations still depend on productionNotes metadata.
- There is no dedicated `/admin/operational` workbench.
- Task assignment, photos, issue tracking and SLA tracking are not complete.
- Operational costs are captured only lightly.
- Final campaign implementation report does not exist yet.

## 2. Future Operations Module

Recommended route:

- `/admin/operational`

Dashboard sections:

- Azi
- Saptamana asta
- Intarziate
- De montat
- De neutralizat
- Print in lucru
- Probleme
- Finalizate recent
- Cost montaj lipsa

Each task should show:

- task kind;
- status;
- location code/name;
- client/campaign;
- scheduled date;
- deadline;
- responsible person/team;
- supplier;
- cost estimated/actual;
- notes;
- before/after photos;
- linked reservation/campaign/location;
- issue status.

## 3. OperationTask Rollout Plan

Current rule:
- Do not enable OperationTask flags in production by default.
- Keep productionNotes active until cutover is proven.

Recommended phased rollout:

1. Keep writing through bridge with productionNotes mirroring.
2. Keep read adapter comparison in staging.
3. Build `/admin/operational` first with legacy fallback.
4. Enable OperationTask reads in staging only.
5. Compare counts and task keys for several weeks.
6. Enable reads in production only after:
   - no mismatches;
   - fallback works;
   - rollback flag confirmed.
7. Later make OperationTask authoritative for writes.
8. Keep productionNotes parser as read-only fallback until historical confidence is complete.

Future OperationTask additions:

- `priority`
- `deadline`
- `startedAt`
- `cancelledAt`
- `cancelReason`
- `estimatedCost`
- `actualCost`
- `issueStatus`
- `photoBeforeDocumentId`
- `photoAfterDocumentId`
- `completedByUserId`
- task event/history table

## 4. Operational Reports

Recommended reports:

- Campaigns starting in next 7/14/30 days.
- Decorations due today.
- Decorations overdue.
- Neutralizations due this week.
- Tasks completed this month.
- Finalized montaj with missing cost.
- Costs by supplier.
- Costs by campaign.
- Before/after photo completion.
- Final implementation report per campaign.

## 5. Finance Current State

Current strengths:

- SmartBill customer invoice import exists.
- SmartBill supplier document import exists.
- Company context is mandatory.
- Preview is required before confirm.
- Manual review/correction exists.
- Storno/discount negative customer invoices can reduce remaining amount when safely linked.
- Supplier negative documents are review-only/excludable in MVP.
- Receivable/payable rows are included in dashboard overdue/due soon totals.

Current limitations:

- Credit notes are stored as financial rows with adjustment metadata, not a dedicated adjustment model.
- Payment allocation model is basic.
- Finance rows can link to client/campaign/billing item, but profitability is not yet a first-class report.
- Supplier costs are not consistently linked to operation tasks, campaigns and locations.
- SmartBill import still needs careful operational procedures before heavy production usage.

## 6. Future Finance Capabilities

Core features:

- SmartBill customer invoice import.
- SmartBill supplier document import.
- Storno/discount/credit note handling.
- Partial payments.
- Aging report.
- Overdue receivables.
- Supplier payables.
- Cashflow by month.
- Company-entity filtered reports.

Profitability:

- Margin per campaign.
- Margin per client.
- Margin per location.
- Margin per seller/team.
- Operation cost vs billed montaj.
- Supplier cost vs revenue.

Recommended future models:

```prisma
model ReceivableAdjustment {
  id                    String   @id @default(cuid())
  receivableId           String
  adjustmentReceivableId String?
  source                 String
  documentNumber         String?
  amount                 Decimal  @db.Decimal(14, 2)
  currency               String   @db.VarChar(3)
  reason                 String?
  appliedAt              DateTime @default(now())
  appliedByUserId        String?
  rawJson                Json?
}
```

```prisma
model PaymentAllocation {
  id              String   @id @default(cuid())
  receivableId    String?
  payableId       String?
  amount          Decimal  @db.Decimal(14, 2)
  currency        String   @db.VarChar(3)
  paymentDate     DateTime
  method          String?
  notes           String?
  createdByUserId String?
  createdAt       DateTime @default(now())
}
```

Optional future cost model:

```prisma
model CampaignCost {
  id              String   @id @default(cuid())
  campaignId      String?
  reservationId   String?
  locationId      String?
  supplierId      String?
  operationTaskId String?
  category        String
  amount          Decimal  @db.Decimal(14, 2)
  currency        String   @db.VarChar(3)
  source          String
  notes           String?
  createdAt       DateTime @default(now())
}
```

## 7. Finance Connections

Finance should connect to:

- Client: receivables, payment behavior, aging.
- Campaign: revenue, invoices, supplier costs, operation costs, margin.
- Reservation: location rental revenue and billing schedule.
- MediaPlan: offered value vs converted value.
- Contract: contract number/company and invoice references.
- Location: revenue/cost/margin by asset.
- Supplier: payables and operational cost source.
- OperationTask: actual implementation costs and supplier work.

## 8. Recommended Finance UI Structure

Finance dashboard top:

- De incasat depasit.
- De platit depasit.
- Scadent azi.
- Scadent urmatoarele 7 zile.
- Net cash position by company/currency.

Tabs:

- Incasari.
- Plati.
- SmartBill import.
- Review.
- Ajustari / storno.
- Rapoarte.

SmartBill import rules:

- Company selector required.
- Preview before confirm.
- Manual review rows are not imported automatically.
- Confirm validates token/company/report type/manual actions server-side.
- No direct production import without visible user confirmation.

## 9. Tests Required

Operations:
- Legacy vs OperationTask read comparison.
- Task action RBAC.
- ProductionNotes mirror.
- DONE excluded from active.
- ARCHIVED in history.
- Montaj billing dedupe.
- Missing cost warning.

Finance:
- SmartBill real-format parser tests.
- Company context enforcement.
- Confirm idempotency.
- Storno/discount link validation.
- Overpayment prevention.
- Partial/full payment.
- Credit note does not alter original invoice total.
- Payable/receivable status derivation.
- Public API leak checks.

