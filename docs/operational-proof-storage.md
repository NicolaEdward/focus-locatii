# Operational Proof Storage

## Scope

This storage path is only for `operational_proof_photo` documents. Permanent location photos, production sketches and client documents keep their existing storage behavior.

## Data flow

1. The authenticated completion API enforces reservation/task RBAC.
2. The full multipart request is limited to 4 MiB, below the Vercel Function 4.5 MB request limit.
3. JPG, PNG and WebP files are checked by declared MIME, magic bytes, structural dimensions and a 40 megapixel ceiling.
4. The server uploads the bytes to a private Vercel Blob store using an environment-scoped, UUID-based immutable key.
5. `ClientDocument` stores only provider, key, SHA-256 checksum, ETag, size, MIME, timestamps, uploader, expiry and relational metadata. New writes keep `storageUrl` null.
6. The authenticated proof endpoint rechecks task/reservation access and streams the private object with `no-store`. It never returns or redirects to a Blob URL.
7. Existing Base64 rows remain available as an authenticated dual-read fallback.
8. The daily cron deletes the object before marking metadata deleted. Interrupted deletes remain retryable and the job is idempotent.

## Environment isolation

- Preview store: `focus-operational-proofs-preview`, private, `fra1`, connected only to Vercel Preview.
- Production must use a different private store connected only to Production.
- Cloud runtime should prefer Vercel OIDC (`BLOB_STORE_ID` + rotating `VERCEL_OIDC_TOKEN`).
- `BLOB_READ_WRITE_TOKEN` is reserved for approved local/backfill operations and must never be committed.
- `OPERATIONAL_PROOF_STORAGE_ENABLED=true` is required. Uploads fail closed if the private store is not configured.

## Backfill

`pnpm run backfill:operational-proof-storage` is dry-run by default. Apply requires `--apply` and `OPERATIONAL_PROOF_BACKFILL_ENABLED=true`. Production additionally requires the exact explicit approval variable defined in the script.

The backfill:

- processes only active, unexpired legacy operational proofs without a storage key;
- validates and hashes the legacy bytes;
- uploads to the private store;
- reads the object back without cache and verifies byte count and SHA-256;
- writes metadata only after verification;
- keeps the legacy Base64 payload for rollback;
- is idempotent through the nullable storage-key condition and conditional DB update.

## Cutover gates

Production new writes require all of:

- additive schema applied;
- separate private Production Blob store connected;
- storage flag enabled only after credentials exist;
- upload, download, delete, RBAC/IDOR and cleanup smoke passing;
- sensitive DB counts unchanged by smoke;
- previous deployment identified for rollback.

Full backfill and legacy Base64 removal are separate changes. Base64 must not be removed until every object is verified, backup/restore is tested and explicit approval is recorded.

## Rollback

Before Base64 cleanup, application rollback is code-only: restore the previous Vercel deployment. The additive columns can remain safely unused. Migrated rows still contain Base64, so the previous reader continues to work. If a new object write occurred after cutover, rolling back to code that cannot read object storage would hide that new proof; therefore Production cutover requires a backward-compatible release sequence and must not be combined with legacy cleanup.
