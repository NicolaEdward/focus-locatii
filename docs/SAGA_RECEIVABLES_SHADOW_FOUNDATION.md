# SAGA Receivables Shadow Foundation

## Decision

SAGA is an upstream accounting system. Focus Media remains the operational source of truth:

- `FinancialReceivable` is the customer-invoice registry;
- `FinancialReceivablePayment` is the individual payment ledger;
- manual payments are authoritative and are never overwritten by a SAGA snapshot;
- SmartBill remains available as an existing upstream integration;
- SAGA shadow mode performs reads from approved fixtures only and makes zero canonical writes.

No schema migration is required for this foundation.

## Official contract audit

Sources reviewed:

- SAGA Soft announcement: https://forum.sagasoft.ro/viewtopic.php?t=60757
- SAGA Web API documentation: https://web0.sagasoft.ro/sagac/DocumentatieAPI
- SAGA Web import documentation: https://manual.sagasoft.ro/sagac/topic-76-import-date.html

The documented SAGA Web contract uses a bearer token and fiscal-code header and documents XML import plus inventory/stock reads. The XML import format contains invoice and collection fields, but this is not proof of a complete receivables read API or a confirmed payment write-back API.

### Confirmed by documentation

- legal entity is selected by fiscal code;
- invoice XML can carry customer, invoice number, invoice date, due date, currency, exchange rate, VAT flags and invoice lines;
- invoice lines can carry item code, quantity, unit, price, VAT rate/value and totals;
- collection XML can carry date, number, amount, account, optional customer account, explanation, invoice ID/number, fiscal code and currency;
- imported XML still requires the documented SAGA import/finalization workflow.

### Not confirmed

- customer-master read endpoint;
- issued-invoice header/line read endpoint;
- outstanding-balance read endpoint;
- collections read endpoint;
- stable external collection ID returned after write;
- idempotency key for collection writes;
- correction/cancellation API for a posted collection;
- allocation of one collection across several invoices;
- non-production tenant or credentials for the Focus legal entities.

Therefore production connector and write-back remain disabled.

## Integration boundary

External contracts live only in `src/lib/integrations/saga`:

- `SagaCompanyDto`;
- `SagaCustomerDto`;
- `SagaIssuedInvoiceDto`;
- `SagaIssuedInvoiceLineDto`;
- `SagaCollectionDto`;
- `SagaSyncCursor`;
- `SagaSyncResult`.
- In shadow, facturile si incasarile sunt clasificate separat: potrivire exacta, propunere noua, conflict, inversare/storno sau potrivire insuficienta. Nicio categorie nu produce write automat.

UI code never consumes raw accounting payloads. The shadow report exposes only normalized totals, safe references and conflict reasons.

## Normalization

- monetary values use `Prisma.Decimal` and two-decimal validation;
- RON and EUR remain separate;
- dates are normalized to `YYYY-MM-DD`;
- invoice numbers use the existing receivables normalizer;
- CUI values are normalized without the optional `RO` prefix;
- unknown legal entities and currencies fail closed;
- net + VAT must equal gross;
- negative outstanding balances are rejected from automatic matching.

## Matching and reconciliation

The implemented shadow order is:

1. legal entity + stable external ID/GUID when a future approved connector can persist/retrieve it;
2. legal entity + normalized invoice series/number + currency + issue date;
3. weaker signals remain `PROBABLE_MATCH` and require review.

The implementation never matches solely by customer name, value or due date.

Report categories:

- exact match;
- probable match;
- new invoice;
- conflicting totals/customer/currency;
- cancelled/storno;
- missing external ID;
- duplicate external invoice;
- unmatched payment;
- potential duplicate payment.

A SAGA collection is not merged with a manual payment when only invoice, amount and date coincide. A strong reference or external identity is required. The foundation records no reconciliation decision in the database.

## Security and environments

- `SAGA_SHADOW_MODE=fixture` is accepted only outside Production;
- Production is fail-closed even if the route is called directly;
- secrets are server-side only and are not part of the current connector;
- no raw payload logging;
- structured logs contain only duration and aggregate counts;
- Sales and Field have no integration permission;
- COO has view/reconcile;
- Finance has view/sync/reconcile;
- SUPER_ADMIN additionally has configure through the existing all-permissions policy.

## Payment ledger behavior

Manual payment creation, partial collection, full-balance collection, correction, cancellation and client-credit behavior remain in the existing canonical service. Shadow failure never rolls back a valid local payment because shadow is not called from the payment transaction.

Until a supported write contract is approved, the accounting meaning is:

- `Inregistrata in Focus Media`;
- `Necesita reconciliere SAGA`;
- never `Confirmata in SAGA`.

## Invoice-to-campaign allocation recommendation

The current optional `FinancialReceivable.campaignId` is insufficient to prove the business cardinality: only a small subset is linked, and one invoice may cover several campaigns or locations. The next finance-design milestone should review an allocation model with invoice-line, campaign, reservation/location and allocated net/VAT/gross amounts. No allocation table is introduced here.

## Production activation gates

1. Confirm exact SAGA product/version and legal-entity databases.
2. Obtain official read contract or supported export mechanism.
3. Obtain isolated credentials and network requirements.
4. Reconcile invoice, VAT, outstanding and collection totals per entity/currency.
5. Prove manual-payment duplicate prevention.
6. Approve schema for external IDs/cursors only if required.
7. Approve rollback and operational ownership.
8. Keep write-back disabled until an official idempotent write contract is proven.
