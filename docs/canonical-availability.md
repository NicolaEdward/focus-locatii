# Canonical availability

## Decision source

`src/lib/availability.ts` owns the pure, inclusive-date availability decision.
`src/lib/availability-service.ts` batches the database reads needed by that decision.
Reservation writes reuse the same service inside the existing location row lock and
transaction in `src/lib/reservations.ts`.

The decision evaluates, in order:

1. location lifecycle (`ACTIVE`, `INACTIVE`, `MAINTENANCE`, `ARCHIVED`);
2. active `LocationAvailabilityOverride` records;
3. legacy `blockedFrom` / `blockedUntil` fields for read compatibility;
4. effective `BOOKED`, `HOLD`, and `RESERVED` reservations;
5. legacy availability fields only where structured reservation data is absent.

`HOLD` and `RESERVED` stop blocking as soon as their effective expiry is reached.
Persisted status cleanup remains data hygiene and is not required for correctness.

## Date semantics

All commercial periods are inclusive. Two periods that share a calendar day
overlap. A free window starts on the day after a blocking interval and ends on the
day before the next blocking interval.

## Consumers

| Consumer | Previous state | Canonical path |
| --- | --- | --- |
| Reservation create/update/group/status | Partial | row lock + canonical transaction recheck |
| Legacy reservation sync | Partial/disabled | row lock + canonical transaction recheck when explicitly enabled |
| Conflict preview | Duplicate | batch decision service |
| Selector and availability export | Rich but duplicate | batch decision service |
| Public list/detail | Partial | canonical public adapter; public DTO unchanged |
| Admin location list/detail | Partial | canonical public-status adapter with private admin inputs |
| Availability timeline | Partial | canonical admin summary plus existing timeline rows |
| COO inventory/HOLD summary | Duplicate | canonical decision per batch-loaded location |
| Campaign/rental writes | Working | existing reservation service, now canonical |

## Privacy adapters

The internal decision contains coded reasons, blocking intervals, lifecycle context,
and override metadata. Public serializers expose only the existing public status,
label, and safe explanation. They remove override records, reservation details,
internal reasons, real coordinates, financial fields, and user/client metadata.

## Compatibility

Legacy block and availability fields are read-only compatibility inputs. New code
must not create a second availability calculation around them. Once production data
has been audited and migrated in a separate reviewed milestone, these compatibility
branches can be deprecated.
