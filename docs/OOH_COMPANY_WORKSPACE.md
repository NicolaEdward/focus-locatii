# OOH company workspace

This is the current product and implementation map for the static OOH business.
DOOH is outside the enabled workspace. The June planning documents are historical
snapshots, not a statement that the newer workflows are missing.

## Working model

| Area | Entry point | Responsibility |
| --- | --- | --- |
| Daily work | `/admin/dashboard` | Seller actions, expiries, renewals and available physical supports; executive overview for management. |
| Opportunities | `/admin/crm` | Company identity, ownership, next contact and preparation of a commercial draft before winning. |
| Inventory planning | `/admin/selectie-locatii` | Search, map, dated availability and a persistent selection carried into the offer. |
| Offers | `/admin/commercial-quotes` | Negotiated line prices, immutable versions, approvals, dated holds and private PDF printing. |
| Client records | `/admin/clienti` | Contacts, documents, campaigns, invoice balances and explicit responsibility. |
| Campaign delivery | `/admin/campanii` | Commercial conditions, confirmed rentals, documentation and redecoration requests. |
| Contract control | `/admin/control-contractual` | Differences between application records and verified, current source documents. |
| Operations | `/admin/operational` | Assigned work, physical execution dates, completion and task-specific photographs. |
| Finance | `/admin/financiar/*` | Billing plans, externally issued invoices, bank reconciliation and explicit campaign allocations. |
| Employee guide | `/admin/onboarding` | Six practical, role-specific steps and each employee's saved learning progress. |
| Commercial rules | `/admin/commercial-settings` | Explicitly approved tax, currency, validity and approval rules. |
| Administration | Header administration menu | Accounts, sources, security, integrations and AI controls for permitted roles. |

Legacy links remain authorized and route to a functioning destination. The old
combined client/campaign component has been retired. Ordinary sellers do not
enter AI experiment administration to configure commercial offers.

## Commercial path

1. Record the opportunity and assign its seller. Preparing an offer may create
   or associate the actual client and draft campaign; it does not mark a sale
   won, confirm revenue or occupy inventory. Duplicate identity and foreign
   portfolio conflicts require explicit resolution.
2. Choose the company, proposed currency and commercial conditions. No new
   confirmed transaction may invent EUR, a 30-day term or monthly billing.
3. Select the physical supports for the requested inclusive calendar dates.
   Selection, negotiated prices and revision identity survive the map round trip.
4. Save an immutable offer version. Keep catalog and proposed prices separate;
   never edit the general tariff merely to represent one customer's negotiation.
5. Obtain an authorized, version-bound approval. Recheck ownership, policy,
   commercial conditions and inventory before an effect. An offer itself is not
   a reservation. Provider delivery remains unavailable until actually configured.
6. Create the approved temporary hold and confirm the rental through the
   authorized booking command. Preserve the exact approved per-location prices.
7. Record an amendment with its effective date, documentary reference and exact
   per-location amounts. Reject stale edits, invalid price histories and mixed
   currency histories that the billing model cannot represent safely.
8. Plan and complete physical work. A changed installation date does not change
   the contractual rental period. Completion, photographs and audit commit
   together. Field users receive task data rather than commercial records.
9. Calculate the billing plan from validated effective price intervals. Do not
   rewrite issued or paid financial history to make a plan appear consistent.
10. Associate actual fiscal invoices and bank receipts. Campaign values follow
    explicit invoice allocations. Unknown receipt attribution, missing currency
    and incomplete evidence must stay visible rather than becoming zero.

## Employee onboarding

Managers invite individual accounts and assign the actual role and portfolio.
An accepted invitation continues to the employee guide after authentication.
The guide covers security and five practical steps relevant to sales, finance,
field work or management. Progress is personal, versioned and audited; it grants
no permission and certifies no transaction. Training uses an existing real record
under supervision or isolated synthetic records, never fictional production cash.

## Evidence and business boundaries

- A missing contract reference does not prove that the signed contract is absent.
- An unconfigured, stale, partial or unreachable archive cannot certify that all
  actual rentals match the database. Only reviewed source facts establish a match.
- A photograph of installation does not establish contractual terms.
- A financial export's paid label does not establish a bank receipt or its date.
- Partial cash on a shared invoice is not assigned to campaigns using an invented
  percentage. Unsupported attribution is shown as requiring review.
- Printing saves an authorized, immutable offer version. Draft, expired,
  historical, rejected and internally approved documents have distinct labels.
- Configuring code does not demonstrate real email delivery, NAS connectivity,
  backup recovery, fiscal ERP issuance or a scheduled native ChatGPT run.

## Verification and release

`pnpm run test:remediation` protects the established security and operational
baseline. The additional focused scripts in `package.json` cover commercial
preparation and negotiation, policy concurrency, amendments, segmented billing,
financial attribution, contractual evidence, private PDF output, employee
activation, failure redaction and mobile proof uploads. The release workflow
runs them before real browser journeys and role/viewport captures.

Browser verification uses genuine synthetic authentication and checks the
request, response, persisted result and rendered state under the production CSP.
Test writes require an explicitly isolated local synthetic database. A production
release is staged without assigning the live domain, checked, then promoted.
Schema changes and historical data correction are separate operations; this
workspace upgrade does not justify guessed corrections of existing records.

The official product references and acceptance matrix are recorded in
[`OOH_PLATFORM_BENCHMARKS.md`](OOH_PLATFORM_BENCHMARKS.md).
