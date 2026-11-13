# Encrypted application-table recovery

`scripts/release/database-backup.cjs` creates an AES-256-GCM encrypted backup of supported application tables. It preserves the signed receipt v1 and sorted-row SHA256 checksum format. It complements provider backups and point-in-time recovery; it does not replace infrastructure recovery.

Use a dedicated 32-byte random base64 `BACKUP_ENCRYPTION_KEY`, held separately from the archive and recoverable by the authorized recovery operator. Existing output/receipt paths are never overwritten or removed. Backup files use mode 0600.

The backup uses an InnoDB read-only consistent snapshot. It rejects views, triggers, routines, events, non-InnoDB tables, generated/invisible columns, spatial values and foreign-schema references. Schema changes detected during export invalidate the backup. These cases require a provider-native backup. The account must have sufficient metadata visibility for all schema objects; a restricted account cannot prove absent objects merely because it cannot see them. Avoid DDL during a backup.

The restore target must:

- Run with APP_ENV `ci`, `test`, `preview` or `staging`, without VERCEL_ENV `production`.
- Have an anchored `focus_preview_*`, `focus_restore_*` or `focus_test_*` database name and matching `RESTORE_DATABASE_CONFIRM`.
- Differ from the source database name/fingerprint and configured `PRODUCTION_DATABASE_URL`, `PROD_DATABASE_URL` and `LIVE_DATABASE_URL` identities.
- Be empty. Creation requires explicit `CREATE_ISOLATED_RESTORE_DATABASE=true`.
- Use loopback, or an explicitly listed hostname in comma-separated `RESTORE_ALLOWED_HOSTS`. Remote MySQL requires TLS verification and the optional provider CA in `BACKUP_MYSQL_CA_FILE`.

Restore decrypts into a mode-0600 temporary file inside a mode-0700 directory. GCM authentication and a complete structural/checksum preflight succeed before any database connection is opened. The authenticated records are then streamed to the isolated target with prepared inserts. The temporary plaintext is removed in `finally`, including authentication, parsing and database failures. A process crash or forced kill can leave its private temporary directory for an authorized operator to remove; do not use a shared or unencrypted temporary volume for sensitive recovery data.

Memory is bounded by the record size (maximum 64 MiB), small row buffers, fixed-size row-hash sorting batches and a 32-file merge fan-in. Large tables spill hashes to private temporary files. Free temporary disk must cover the decrypted archive and sorting runs. The encrypted archive and plaintext archive are never loaded wholesale into memory.

Dates and timestamps use UTC strings, including microseconds; BIGINT/DECIMAL stay strings; binary values use base64; JSON stays JSON text. Prepared inserts and `NO_AUTO_VALUE_ON_ZERO` preserve NUL/quotes/backslashes and explicit zero IDs. Restored table checksums must match before an OK receipt is returned. A database error can leave the isolated target partially restored because MySQL DDL auto-commits: discard or investigate that target before retrying. It is never a successful verification and existing nonempty targets are refused.

Run `test:backup-hardening` only through the existing isolated test environment loader. Its fixture creates its own loopback `focus_preview_*` databases and drops only those fixtures. It checks 17,006 synthetic rows, a consistent snapshot during a concurrent insert, exact value fidelity, external checksum sorting, private-file cleanup, no database connection on bad authentication or malformed authenticated data, guard failures, unsupported objects, output retention and receipt compatibility. `scripts/test-backup-restore.cjs` also verifies the full application schema in an isolated clone.
