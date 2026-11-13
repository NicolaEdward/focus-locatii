# Static OOH operating model and verification baseline

Reviewed: 2026-11-13. Scope: physical/static OOH, not digital capacity or playback.

## Public product references

These references supply workflow ideas, not an independent ranking, a guarantee
about another vendor, or proof that this application implements their features.
No customer data was sent to these sites.

| Official reference | Verified statement relevant to this project | Resulting design criterion |
| --- | --- | --- |
| [Broadsign Direct: Access the Proposal Builder](https://docs.broadsign.com/broadsign-direct/access-proposal-builder.html) | The builder can be opened from inventory and other commercial entry points; selected static faces enter the builder automatically. | Selecting sites must carry the same IDs and flight dates into the saved offer. No second manual selection or disabled next step. |
| [Broadsign Direct: Availability Check](https://docs.broadsign.com/broadsign-direct/availability-check.html) | Availability is checked for the proposal's requested dates, including at hold and booking actions. | An offer is a dated proposal, not an allocation. Recheck the authoritative inventory inside every allocation transaction and amendment. Show the precise conflicting face. |
| [AdQuick: Media Owners](https://www.adquick.com/media-owners) | The vendor describes inventory, availability, holds, contracts and proof of posting in one system. | A physical face needs a connected commercial and delivery history, with source documents and photos attached to the campaign. Separate those facts from unverified assumptions. |
| [AdQuick: Sales Cloud](https://www.adquick.com/sales-cloud) | The vendor describes customer-specific pricing, packages, holds, renewals and customer onboarding. | Keep catalog tariffs separate from negotiated offer lines; record approvals. Make renewal and onboarding actionable parts of the workflow. |

Retrieved official pages and search results were read directly. No claims about
these vendors' actual service quality, Romanian fiscal compliance or observed
business results were tested.

## Product boundaries for Focus Media

The daily sales path is opportunity → client/campaign association → dated site
selection → priced offer → approval → temporary hold → authorized contract
booking. Operations then track preparation, installation, evidence and removal.
Finance tracks the contract billing schedule, externally issued fiscal invoices,
documented adjustments, bank receipts and explicit allocations. All pages should
refer to those same identifiers and dates.

New employees need a role-specific explanation of this path, their own next
actions, clear permissions and short links into real work. Technical AI tokens,
pilot experiment settings, schema tools and fiscal policy setup belong to the
responsible administrators. An unfinished integration must display its actual
setup state, not a decorative button or a success counter.

Signed originals remain the authority for correcting historic commercial facts.
A missing contract number in the application does not prove the contract is
missing. An unconfigured or unreachable NAS source cannot establish that the
database matches signed contracts. No software-only release can remove that
evidence requirement.

## Release stories and acceptance evidence

Use synthetic local or staging records for every write below. Production checks
are read-only until a separately reviewed evidence correction is executed.

| Story | Minimum checks | Required result |
| --- | --- | --- |
| First-day seller | Invite/activate account, enroll security, open guide, create first next action, reopen guide. | Role-specific instructions, valid links, own-only progress and portfolio; no manager token or policy form in the daily flow. |
| First-time prospect | Record opportunity, prepare client/campaign before winning, preserve CRM identity and assigned seller. | No premature WON/BOOKED transition, no duplicate company on retry; the new draft campaign accepts an explicit proposed currency. |
| Build offer from inventory | Choose dates and faces, continue to offer, inspect carried context, negotiate one line and save. | Exact face IDs/dates retained; catalog rate unchanged; list and negotiated rates have provenance; no silent conversion or invented policy. |
| Conflict and approval | Make a competing hold after preparing an offer; submit/replay approval with another actor or changed payload. | Conflict names the affected face; no partial bookings; approval is limited to the reviewed version and authorized action. |
| Renewal and amendment | Change rent from a midmonth effective date, inspect the old and new rate intervals, generate the billing plan. | Inclusive day boundaries, historical price preserved, weighted monthly amount; no overlapping or uncovered rate intervals. |
| Stale editor | Two colleagues open the same rental; one saves, then the other saves the old form. | Explicit conflict and reload/review path, no lost update. |
| Campaign operations | Book an eligible campaign, assign installation, complete with evidence, inspect the linked campaign. | Same reservation and location; permissions enforced; photo evidence does not substitute for a signed contract. |
| Financial closure | Generate contract schedule, associate fiscal invoice and costs, allocate an actual bank receipt, inspect balances. | Net/VAT/gross remain distinct; one receipt effect after retry; money is separated by legal entity and currency. |
| Contract comparison | Filter active rentals with missing or conflicting source facts; inspect an unconfigured NAS state and a reviewed indexed document. | Unknown stays unknown; each discrepancy has its source, responsible person and next action; no automatic guessed corrections. |
| Mobile and scale | Walk the same paths at 390, 768 and desktop widths; search beyond the initial quote page; load older revisions. | Accessible controls, no blocked primary action or unreachable dropdown; full history remains reachable. |
| Failure and authorization | Network interruption, empty list, long company name, foreign seller ID, stale token and unavailable evidence source. | Loading/error/empty/unknown are distinct; no foreign private data, misleading zero or blind mutation replay. |

Each browser story must observe the request, API response, persisted data and
rendered result. A static source assertion or screenshot alone does not prove a
transaction worked. A passing synthetic suite does not prove that the actual
signed originals were reconciled or a native ChatGPT scheduled run was created.

## Additional defect found during this upgrade

The previous billing-plan generator joined BOOKED reservations but not their
`RentalPriceSegment` history. It priced the entire reservation using the latest
monthly rate. This conflicts with an effective-date amendment even if the
amendment itself correctly preserves historical segments.

The segment-aware implementation must validate full inclusive coverage, reject
gaps/overlaps or ambiguous currencies, calculate the exact rate shares before
monthly rounding and preserve committed fiscal positions. Regeneration may
update an uncommitted future draft; it must refuse an historical mismatch
atomically rather than rewrite an issued position.

Relevant verification: `scripts/test-segmented-billing.cjs` covers mathematical
boundaries and contract-share rounding; `scripts/test-segmented-billing-plan.ts`
checks the actual MySQL join, idempotence, future draft refresh and rollback after
an historical conflict. Their results must be recorded in the final release
report, not assumed merely because the scripts exist.
