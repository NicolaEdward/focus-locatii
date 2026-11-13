# Contract and invoice evidence kept on the NAS

## Delivered boundary and actual status

This module is a working connection, review and reconciliation mechanism. It does **not** establish that the real NAS was connected, its files were opened, or any actual business records matched the originals. Existing `file://nas/…` references identify a private network share; a reference alone does not grant this cloud runtime access to that LAN. No real contract, invoice, reservation or payment was changed by developing this module.

The owner can configure the source at `/admin/document-audit`. The supported initial scope is OOH contracts and fiscal invoices in PDF format. The module does not infer DOOH capacity, playback or proof-of-play.

Original PDF files remain on the NAS. The database stores a source/reference, relative path, SHA-256, observed file metadata, immutable extraction versions, append-only human reviews and report snapshots. It has no PDF/binary column and the ingest format accepts no file payload. Bounded text snippets (maximum 16 KiB per document) are disabled by default and require both source-level consent and bridge `--include-text`. Text may contain personal/commercial information, so enabling it is a meaningful owner decision.

## Connect without exposing the NAS

Follow [NAS_READONLY_BRIDGE.md](NAS_READONLY_BRIDGE.md) for the POSIX bridge, readonly mounts, WSL/container deployment, private state, extraction and scheduling. Register a logical reference such as `file://nas/`, `smb://nas/Documente` or a network path; use approved aliases such as `contracts` and `invoices`. Vercel stores these references but never fetches them. The cloud server does not perform arbitrary URL requests, resolve document URLs, scan the LAN or read server-local paths.

A COO/SUPER_ADMIN issues an ingest key in the workspace. Its secret is shown once, never returned in subsequent reads, and stored only as SHA-256. Install it in the private environment of the bridge, not ChatGPT, URLs, command arguments or git. Rotation/revocation, pausing/configuring the source, disabling its issuer, changing issuer role or changing issuer credential version revokes the delegation. The bridge may only index metadata/unverified snippets for its source and approved prefixes. It cannot submit verified commercial facts or modify a reservation/invoice.

The key's local state is confidential; optional pending payloads can contain text snippets. Use a reader account restricted to the approved NAS folders. No NAS password is required by Vercel, and no public port forwarding is needed.

## Access and evidence review

Unmapped archive documents default to COO/SUPER_ADMIN/D_CEO read access; D_CEO is read-only. Sales and finance roles do not receive all NAS paths, contracts or facts merely because they can view availability or a financial report. Source administration, fact review and reconciliation commands require COO/SUPER_ADMIN and recheck current role, token version and registered-session revocation. Ingest checks the current issuer and source delegation inside the transaction.

1. Review the latest source scan and document state. A missing document retains its history; it does not cancel a reservation or erase a receivable.
2. Open the original through the organization's NAS tools. Check SHA-256/version, page, contracting entity, annexes, cancellations and amendments. Extracted snippets are untrusted data, not instructions or approved facts. Image-only PDFs remain `needs_ocr`; an absent extractor remains `extraction_unavailable`.
3. Use the ordinary fact form to enter the explicitly stated location code, inclusive start/end days, monthly rent per code and currency, or the fiscal invoice identity/issuer/gross amount. Optional client CUI strengthens identity matching. Add the exact page and supporting quote. An advanced JSON editor supports multiple rows but has the same server validation.
4. Explicitly attest original review and save a verified or rejected review with a note. Hash/current-version and expected-review-version gates prevent stale tabs from approving a replaced file. Reviews are append-only. Identical file/extraction versions keep their existing review; a changed file or changed extraction/reference requires a new review.
5. Recalculate the report. Findings show evidence, current versus proposed values and a link to the existing record UI. No report result bypasses reservation availability, authorization or financial validation. Corrections use the application's established commands/forms after the owner confirms the applicable evidence and business rule.

Source configuration changes revoke the bridge key and invalidate completed-scan freshness. Pausing/reactivating is available in the UI; configuration replacement is also supported by the typed admin command. Keep predecessor sources paused if a new configuration is registered, so duplicate archives are not treated as independent evidence.

## Deterministic comparison and limits

- Reservation facts match exact inventory codes. A supplied reservation ID is authoritative only for association, not for changing data. Without one, a unique contract number, exact interval or unique overlapping interval can identify the candidate. Ambiguous matches require a person.
- Period, BOOKED status, explicit currency, monthly rent per code, contract number and client tax ID are compared where supported. Legacy row `amount` is the fallback for absent `monthlyRentShare`, matching the existing application's monthly-price model. A total contract amount is never divided automatically and currency is never converted.
- Other effective BOOKED/active HOLD rows overlapping the verified period are flagged. Different verified contractual facts overlapping on a code are flagged conservatively; the application does not decide which amendment supersedes another. Exact duplicate evidence with identical explicit commercial values does not create a conflicting-terms finding.
- Invoice identity includes the legal issuer. A unique canonical receivable is preferred to historical repeated imports. Original gross invoiced value is compared with original invoice evidence in the same currency. A credit note/storno needs adjustment review and does not replace original gross value. Invoice evidence never proves payment.
- A report covers at most 5,000 references and 5,000 verified facts, storing at most 200 finding details. Reaching a scope limit, missing references, unreviewed documents or incomplete/stale scans prevents a complete-scope conclusion. All returned counts identify their actual reviewed scope. Reports do not establish that the entire company's archive has been supplied.
- Changes after a report in indexed evidence/reviews, reservations, inventory, clients or invoices mark its summary as requiring recalculation. The report remains an immutable as-of snapshot. External/manual hard deletion cannot be proven from updated timestamps; scheduled full recomputation still remains necessary.

## Repeatable report and ChatGPT integration

`GET /api/cron/document-audit` requires the configured `CRON_SECRET` bearer value and never returns document paths, excerpts or findings. It selects a still-active/current COO/SUPER_ADMIN issuer from an active source with a live delegation, rechecks the delegation, and runs the same readonly-business reconciliation. With no authorized source it returns an explicit no-source/revoked state rather than an empty successful audit. A report younger than five minutes is reused to bound scheduler retries; the summary still marks later changes as stale.

The implementation supplies this handler but does **not** install a production schedule by itself. Add a daily Vercel cron entry, for example `{"path":"/api/cron/document-audit","schedule":"30 4 * * *"}`, only as part of the integrated deployment. The NAS reader's OS/NAS schedule is separate and must run before the report to keep the source scan fresh. There is no claim that a continuous NAS connection or background task is already active.

`getDocumentAuditSummary(actor)` retains the normal web-session checks for UI/API readers. The distinct server-only `getDocumentAuditSummaryForAssistant(authorization)` validates a real personal OAuth bearer, `documents.read` and current management role before and after the bounded read. It permits natural source-session expiry only through an explicitly consented valid offline grant; a revoked/deleted source session, changed role/tokenVersion or revoked grant still denies access. The MCP tool does not strip session identifiers or accept a caller-controlled expiry bypass. It exposes configuration/freshness, aggregate pending/OCR/missing counts, latest report counts/as-of and limitations. It does not expose source credentials, NAS paths, client CUI, excerpts or raw document facts. Its `unconfigured`, `sync_required`, `stale`, `audit_required` and `review_required` states distinguish unknown coverage from a verified zero-difference result. The connector must not translate `within_reviewed_scope` into a claim about all company contracts. Summary queries share one MySQL RepeatableRead snapshot; a real concurrent-insert regression pauses a count query under a table lock and verifies that the current read stays consistent while the next read sees the committed document.

## Transactions, retry and retention

All source/key changes, ingest batches, reviews and report snapshots include a transactional audit event. Audit failure rolls back that command. Each batch uses a unique request key bound to canonical payload SHA-256: the same intention replays its result; a changed payload with the same key is refused. Forbidden paths or invalid members roll back the entire batch. Older observations cannot move a document pointer or completed-scan marker backwards. Only an accepted complete scan marks previously indexed, unseen files missing.

Every scan must first acquire its source lease with an empty nonfinal batch, before the bridge reads the archive. A source accepts one scan ID at a time, with a 15-minute lease renewed by accepted batches; the bridge flushes/heartbeats within 120 seconds. Exact receipt replay does not renew a lease or change documents. A completed, abandoned or superseded scan ID cannot be reopened; after lease expiry or key/configuration changes, an operator starts a fresh scan ID/state after retaining uncertain old intentions for review. A delayed partial batch at or before a later completed-scan watermark is recorded as not accepted and cannot resurrect missing evidence. Equal timestamps are allowed inside the same active scan only when a repeated document has identical file/extraction hashes. The same timestamp cannot begin a different scan after completion.

The bridge validates the bounded JSON receipt against source ID, scan ID, observation time, canonical payload hash, accepted counters and final-completion state. A bare HTTP200, HTML/login page, wrong receipt, ignored/stale observation or conflict is not an acknowledgement: the exact pending intention stays on disk. This prevents an interrupted reader or unexpected proxy response from claiming a completed archive.

Old file versions/reviews/reports are intentionally retained; this module offers no destructive cleanup. Set a retention/legal policy before adding deletion or source disposal. Source configuration and delegation are new tables without foreign keys to legacy production tables, avoiding changes to existing data/FK collations. The migration creates only the six new tables and their mutual foreign keys.

## Local verification

Use a new local synthetic database. The TypeScript suite refuses any host except loopback and checks the explicit expected database (`focus_preview_nas_document_audit` by default; `DOCUMENT_AUDIT_TEST_DATABASE` can name another freshly isolated synthetic database). The standard synthetic environment guards remain mandatory:

```sh
node --env-file=.env.implementation.local --import tsx scripts/test-document-source-audit.ts
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_nas_document_bridge.py
npx tsc --noEmit --incremental false --pretty false
```

The real-MySQL suite checks ACL, revoked/stale users, hash-only keys, consent, atomic batch rejection, payload replay, immutable versions/reviews, missing/older scans, OCR uncertainty, explicit OOH and fiscal differences, contradictory contracts/booking overlap, private summary output, scheduled reporting and byte-for-byte unchanged business rows. Bridge tests use synthetic files/loopback HTTP, including real `pdftotext` on a generated PDF where installed. Neither suite connects to the real NAS or a model provider.
