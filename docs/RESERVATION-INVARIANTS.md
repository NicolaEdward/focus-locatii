# Reservation write contract

Implemented audit scope: SEC-AUTH-001, OPS-001 through OPS-009, FIN-008 and FIN-009. The availability DTO uses `dateSemantics: INCLUSIVE_CALENDAR_DAYS`.

- Start and end are both occupied calendar days, consistent with `docs/WORKFLOWS.md` and inclusive billing prorata. A booking ending on 10 January conflicts with one starting on 10 January; 11 January is free. No historical periods are rewritten.
- The server creates contract groups. Free-form create/PATCH cannot join, remove or replace group membership. Every member is authorized before a group is returned or mutated. Mixed-owner legacy groups fail closed for a seller and remain accessible to authorized management; no automatic reassignment is performed.
- A seller cannot link an existing BOOKED record to a foreign client/campaign. Missing or foreign ownership produces the same opaque 403; ambiguous legacy links require management review. COO/Admin must explicitly select the accountable seller when creating a reservation or campaign; only SALES_AGENT/SALES_DIRECTOR default to themselves.
- Reservation transactions use MySQL READ COMMITTED. Writers lock all old and proposed location rows in deterministic order, then reservation rows, re-read ownership/membership/location and validate the entire proposed group against itself and external blockers. A moved row or membership change during the wait causes an explicit reload error; failed writes are not blindly replayed.
- BOOKED creation and confirmation require SALES_DIRECTOR, COO or SUPER_ADMIN and a positive usable monthly price for every location. There is no implicit free-booking exception. An agent can edit its authorized existing BOOKED record under existing route permissions, but cannot confirm a new one.
- Omitted BOOKED commercial terms inherit the live campaign. An existing BOOKED record retains explicit terms during unrelated edits. Explicit payment-term changes calculate the corresponding days. Contract totals are allocated as integer cents with the deterministic remainder assigned to the first rows, preserving the total exactly.
- Campaign archival checks current and future effective blockers under the campaign lock. Completed historical reservations remain BOOKED and are retained. New BOOKED writes lock and validate the campaign in the same transaction.
- An offer-request claim locks the request, reads its latest owner and writes once. The second seller is refused with 403. Omitted metadata is retained; explicit null clears nullable follow-up, estimate and notes.
- Core reservation, expiry, offer and archive writes persist their COMMITTED audit entry inside the business transaction. Audit insertion failure rolls back the write.
- Digital operational classification is shared through `location-medium.ts`. This does not create digital capacity, slot inventory or proof-of-play.

## Approved AI HOLD hook

`createApprovedAgentHold(tx, input, humanApprover)` accepts only locations, dates, approved client/campaign/owner, expiry and request key. It creates HOLD only, validates ownership/live context/availability and records audit in the supplied transaction. The outer gateway must use `reservationWriteTransactionOptions` and atomically validate and consume a payload-bound, unexpired human approval and persist the command receipt. It must not call this helper with model-provided arbitrary reservation columns. The unique external identifiers make an identical HOLD retry return the original rows; a mismatched reuse fails.

## Verification and rollout

`test:reservation-remediation` exercises the deterministic concurrent-update interleaving, mixed-group refusal and rollback, group-to-one collision, inclusive boundary, direct booking role/price, campaign inheritance, cent conservation, competing claims, null clearing, historical archive, audit failure rollback and approved HOLD replay on an isolated local synthetic database. The script requires loopback MySQL, a `focus_preview_*` database and non-production APP_ENV.

Also run `test:reservation-integrity`, `test:availability`, `test:status-availability`, `test:reservation-lifecycle`, `test:reservation-route-safety`, `test:reservation-workflow-cleanup`, `test:inventory-reservations-scale` and TypeScript.

Before production rollout, review a read-only minimized inventory of existing mixed-owner groups, overlapping active periods and missing prices. Resolution of those historical records, any gratuitous-booking exception and any change to the documented inclusive date rule require explicit business decisions. This change does not repair historical data, change the database default isolation level or deploy anything.
