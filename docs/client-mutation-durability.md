# Client mutation durability

Client upsert, edit/owner change, primary-contact creation and account merge now record their outcome in `AuditLog` inside the same Prisma transaction as the domain changes. The routes do not append a second success event after commit. Failure to persist the outcome rolls back the complete command, including contact primary flags and merge relinks.

The transaction locks and revalidates the active actor, credential version, role and registered session, then locks affected client rows in deterministic order. `ReadCommitted` ensures the ownership check after a waiting row lock reads the committed owner. A seller cannot update a foreign or unassigned portfolio record. Merge remains restricted to COO/SUPER_ADMIN and rejects already-merged source accounts. The existing response shapes remain unchanged; rejected stale sessions use 401 and rejected portfolio writes use 403.

The archive dependency check runs through the transaction client. Client creation with an optional primary contact is atomic, and the owner must resolve to an active commercial user. No production data repair or merge is performed by this change.

Run the real-MySQL regression only in an isolated synthetic Preview/CI database:

```sh
node scripts/release/run-with-env.cjs .env.implementation.local node_modules/.bin/tsx scripts/test-client-atomic-mutations.ts
```

The suite injects audit persistence failures after domain SQL and verifies rollback of client creation, primary-contact selection, owner transfer and merge relinks. It also forces a concurrent ownership transfer while a seller request waits for the client lock, proving the stale portfolio request is rejected.
