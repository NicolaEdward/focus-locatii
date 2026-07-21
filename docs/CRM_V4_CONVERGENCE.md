# CRM v4 convergence

## Canonical contract

CRM v4 uses `CrmCompany`, `CrmCompanyContact`, `CrmProspect`, `CrmOpportunity`,
`CrmNextAction` and append-only `CrmEvent` records. Commands are transactional,
idempotent and protected by optimistic versions.

Forecast follows product decision B:

- `opportunity`, `quoted` -> Pipeline;
- `negotiation` -> Posibil;
- `contracting` -> Angajament;
- `won` -> Castigat;
- `lost`, `on_hold`, `inactive` -> Exclus.

Every total contains the full current opportunity value. CRM does not store or
request a manual probability and never computes weighted value.

## Registry boundary

CRM companies and opportunities are not `ClientAccount` or `Campaign` records.
Winning an opportunity appends `OPPORTUNITY_WON`; it does not create a client,
campaign, reservation, HOLD, BOOKED record, invoice or financial document.

The salesperson can start an explicit handoff from the won opportunity:

1. preview duplicate matches by normalized company name and CUI;
2. confirm or explicitly create the canonical client through the Clients API;
3. append an idempotent client handoff event;
4. review and explicitly create the campaign through the Campaigns API;
5. append an idempotent campaign handoff event.

COO has read-only CRM access. Sales agents are scoped to their own records;
global roles follow the existing RBAC policy. Handoff targets are checked for
ownership and company identity at API level.

## Legacy retirement

The old `CrmWorkspace`, `crm-service.ts` and `crm.ts` consumers are removed.
Legacy `/api/admin/crm/leads/*`, `/agenda` and `/duplicates` routes remain as
authenticated tombstones. They return HTTP 410, advertise the v4 replacement
and emit `crm_legacy_route_called` without PII.

Legacy `CrmLead`, `CrmContact` and `CrmActivity` models and rows remain in the
database for historical read/audit and backup. No current workflow writes or
reassigns those records. Their physical removal requires a separate reviewed
migration after the sunset monitoring period.
