# Deprecation Register

| Surface | Status | Current consumer | Exit criterion | Data policy |
| --- | --- | --- | --- | --- |
| Legacy CRM routes `/api/admin/crm/leads/*` | deprecated/read-only or blocked writes | historical compatibility | zero runtime calls for an agreed observation period | preserve historical rows |
| Legacy CRM models | historical read-only | audit/history only | separate reviewed migration | no hard delete in stabilization |
| `/api/admin/reservations/sync` | retired (410) | none expected | zero consumers/log calls | no sync reactivation |
| Full legacy `/api/reservations` list | compatibility, heavy | lazy legacy workspace/detail | new workspace feature parity and zero initial use | keep writes canonical |
| `blockedFrom` / `blockedUntil` scalars | read compatibility | canonical availability adapter | all legacy values mapped/reviewed | no new scalar writes |
| Free-form legacy location status | read compatibility | public/admin adapters | lifecycle migration complete | preserve unknown values for review |
| OperationTask global read path | pilot/disabled | controlled operational service only | assignment pilot, RBAC and cutover approval | do not auto-backfill 288 rows |
| ImportBatch | retained audit-compatible model | inventory/import audit | clear adoption or separate removal proof | no opportunistic deletion |
| SmartBill dashboard/report UI | removed from primary navigation | none | complete | backend integration remains |
| Legacy finance summary/manual endpoints | compatibility/restricted | legacy integration checks | canonical workspace coverage + zero calls | never overwrite payment ledger |
| Archived receivable snapshots | historical | reconciliation report | finance-approved archival policy | preserve 64 classified differences |
| Legacy dashboard services | deprecated where unreferenced | none expected | code search + runtime zero-call proof | delete code only, not records |

Deprecation is not deletion. A contract step requires dependency proof, staging migration, count/checksum verification and rollback evidence.
