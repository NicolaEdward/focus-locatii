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
- Core reservation, expiry, offer and archive writes persist their COMMITTED audit entry inside the business transaction. Audit insertion failure rolls back the write. Command-center exception/resolution notes use a narrow group command that preserves each row's own notes and changes no commercial or ownership fields. Operational note-only updates do not force a historical missing-price correction.
- Digital operational classification is shared through `location-medium.ts`. This does not create digital capacity, slot inventory or proof-of-play.

## Approved AI HOLD hook

`createApprovedAgentHold(tx, input, humanApprover)` accepts only locations, dates, approved client/campaign/owner, expiry and request key. It creates HOLD only, validates ownership/live context/availability and records audit in the supplied transaction. The outer gateway must use `reservationWriteTransactionOptions` and atomically validate and consume a payload-bound, unexpired human approval and persist the command receipt. It must not call this helper with model-provided arbitrary reservation columns. The unique external identifiers make an identical HOLD retry return the original rows; a mismatched reuse fails.

## Verification and rollout

`test:reservation-remediation` exercises the deterministic concurrent-update interleaving, mixed-group refusal and rollback, group-to-one collision, inclusive boundary, direct booking role/price, campaign inheritance, cent conservation, competing claims, null clearing, historical archive, audit failure rollback and approved HOLD replay on an isolated local synthetic database. The script requires loopback MySQL, a `focus_preview_*` database and non-production APP_ENV.

Also run `test:reservation-integrity`, `test:availability`, `test:status-availability`, `test:reservation-lifecycle`, `test:reservation-route-safety`, `test:reservation-workflow-cleanup`, `test:inventory-reservations-scale` and TypeScript.

Before production rollout, review a read-only minimized inventory of existing mixed-owner groups, overlapping active periods and missing prices. Resolution of those historical records, any gratuitous-booking exception and any change to the documented inclusive date rule require explicit business decisions. This change does not repair historical data, change the database default isolation level or deploy anything.

## Un singur model de capacitate pentru inventarul digital

Inventarul identificat prin taxonomia comună ca digital și orice amplasament cu profil DOOH configurat (inclusiv draft sau un profil păstrat după schimbarea tipului amplasamentului) se alocă exclusiv în spațiul DOOH. Crearea statică HOLD/RESERVED/BOOKED și modificările statice care schimbă amplasamentul, perioada ori starea blocantă sunt refuzate cu `DOOH_CAPACITY_MANAGED`. Extinderea unui HOLD istoric este tot o nouă blocare și este refuzată. Această regulă conservatoare evită conversia implicită dintre ocuparea integrală și SOV; nu interpretează o rezervare statică drept un slot.

Rândurile istorice nu sunt migrate, șterse sau împărțite automat în cote. Notele, inclusiv notele unui grup cu perioadă/stare neschimbate, rămân editabile. Anularea explicită este permisă și păstrează istoricul. Alocarea DOOH verifică în continuare rezervările statice istorice efectiv blocante, mentenanța și override-urile; un operator trebuie să reconcilieze explicit aceste angajamente înainte de a aloca o cotă suprapusă.

Toți scriitorii de capacitate blochează mai întâi `portfolio_locations`, apoi profilul DOOH. Scrierile statice blochează toate amplasamentele în ordine deterministă înainte de verificarea profilului și a disponibilității; alocarea/retragerea DOOH și editarea profilului urmează aceeași ordine. Nu se poate confirma o cotă concurent cu o nouă blocare statică pe același amplasament.

Disponibilitatea canonică pentru fluxul static întoarce `BLOCKED`, `isBookable=false`, motivul `DOOH_CAPACITY_MANAGED` și fără ferestre statice vandabile pentru inventarul digital. Cititorul intern `DOOH_LEGACY_BLOCK_CHECK`, folosit numai de serviciul de capacitate, inspectează blocajele istorice fără a trata însăși existența profilului ca rezervare. Acest scop intern nu este acceptat ca parametru al instrumentului AI sau al cererii publice.

Intervalul static folosește zile comerciale inclusive, iar DOOH folosește instanți `[start,end)` și daypart în fusul profilului. Pentru verificarea istoricului, începutul DOOH se transformă în ziua locală a profilului, iar sfârșitul exclusiv se transformă după scăderea unei milisecunde. Căutarea include întreaga ultimă zi UTC a etichetei calendaristice, păstrând și rânduri vechi salvate la prânz. Astfel o rezervare pentru 20 martie blochează toate orele locale din 20 martie, inclusiv seara; ora locală 00:00 din 21 martie poate începe un nou interval. Este o verificare conservatoare pe zi întreagă, indiferent de daypart, până la reconcilierea explicită a datelor istorice.

Testul `test:dooh-static-capacity` folosește numai MySQL local sintetic. Demonstrează prin `performance_schema.data_lock_waits` că ambii scriitori reali așteaptă pe amplasament înainte de profil, apoi verifică refuzul static și o singură alocare DOOH; acoperă BOOKED, HOLD, mutare/replanificare/grup, confirmare/extindere, note/anulare istorice, tip schimbat, zile locale și capete exclusive.
