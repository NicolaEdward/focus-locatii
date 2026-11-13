# Read-only NAS document bridge

The bridge runs on the NAS, Linux, or WSL with the contract/invoice folders mounted read-only. The application keeps a source reference, relative file path, SHA256, version metadata and, only after explicit consent, a bounded text preview. It never receives or stores the PDF binary through this bridge.

This is a connection mechanism, not evidence that the real NAS was accessed or that any real contract was audited. No network share is discovered or mounted automatically. The operator must select the actual folders and provide the NAS reader account with access only to those folders.

## Configure the application and reader

1. A COO/SUPER_ADMIN creates the source at `/admin/document-audit`. Set the NAS HTTPS/SMB/network reference, including a logical reference such as `file://nas/`, and the allowed relative prefixes, for example `contracts` and `invoices`. A source reference does not make the NAS public and is not fetched by Vercel. Local `file:///C:/...` references without a network host are refused.
2. Issue a dedicated ingest token for that source. Configure it as the reader service's `NAS_INGEST_TOKEN` secret. It must not be pasted into ChatGPT, shell arguments, logs, a URL or a committed file. The application stores only its hash and can revoke it independently.
3. Run the reader as an unprivileged user with read-only NAS access and a private writable state directory outside the source folders. The Python script requires POSIX `dir_fd`, `fwalk`, `O_NOFOLLOW` and `flock`; on Windows use WSL or a Linux container with read-only share mounts.

```sh
python3 scripts/nas_document_bridge.py \
  --app-url https://locatii.focusmedia.ro \
  --source-id SOURCE_ID \
  --contract-root contracts=/mnt/nas/contracts \
  --invoice-root invoices=/mnt/nas/invoices \
  --state /var/lib/focus-nas-bridge/source-state.json
```

The token is inherited from the service environment; there is intentionally no token argument. NAS/service environment settings or a restricted OS service environment file can supply it. Protect the local state directory and credential configuration from other users.

For an existing Windows share such as `\\nas\Documente`, keep that NAS/share reference private and mount only the approved subfolders read-only inside WSL or a Linux container. Map the mounted paths to `--contract-root contracts=/mnt/nas/contracts` and `--invoice-root invoices=/mnt/nas/invoices`. The bridge intentionally requires POSIX safe-open primitives and does not run as native Windows Python. On a Linux NAS, a container can receive bind mounts with `:ro` and a separate private writable state volume; it does not need NAS write privileges. No NAS public forwarding or Vercel-to-LAN connection is required. The share must be mounted by an authorized operator; this repository contains no real NAS path inventory or credentials.

`--root alias=/path` supports a folder whose document type is unknown. A contract/invoice root is an operator-supplied classification hint, never verified business evidence. Aliases must be unique and must match the source's allowed prefixes.

## Optional text extraction

The default mode is `metadata_only`: it hashes and indexes PDF references without reading text into the application. Enable text indexing for the source in the application and add `--include-text` to the reader only after the owner approves it. Use a separate state file when changing reader configuration.

`pdftotext` from the maintained Poppler distribution is optional. With text enabled:

- No installed extractor produces `extraction_unavailable`.
- A blank extraction produces `needs_ocr`; the bridge does not invent the text or business fields of a scanned PDF.
- Extracted text is capped at 16 KiB UTF-8 and 64 nonempty page snippets per document. `textTruncated` explicitly marks a partial preview. There is no claim that the complete contract was interpreted.
- Extraction uses a private temporary copy of the exact bytes being hashed, mode 0600 in a mode-0700 directory. The optional parser has a 35-second deadline, 30 CPU seconds and a 512 MiB address-space limit. The temporary PDF is removed after extraction, including parser failures.
- Every document carries `verification: unverified` and `facts: []`. The backend must not turn a file name, text preview or incoming document type into approved commercial facts. Original-document review and evidence references remain necessary.

The backend discards text when source-level text indexing is disabled. It preserves existing human reviews on an identical version; enrichment can create a new extraction version requiring review according to the application's policy.

## Scope and limits

The initial supported document format is PDF, maximum 20 MiB per file. Symlinks, hidden files/directories, traversal paths and system-wide root directories are excluded. Source files are opened through anchored directory handles with no symlink following. A file changing during hashing/extraction is skipped, rather than sending text for a different hash.

DOC/DOCX, spreadsheets and image documents are not uploaded. If they appear in the selected scope, or a PDF is oversized, unreadable, empty or unstable, the scan is marked incomplete. The source can therefore remain stale instead of reporting a complete archive. OCR/extraction-unavailable PDF records themselves can still be indexed; a completed enumeration does not mean their content has been verified.

Requests contain at most 50 document references and are limited to 2 MiB. There are no arbitrary downloads or outbound URLs supplied by a document. The receiving application origin must be public HTTPS, without embedded credentials, path, query or fragment. Certificate validation is enabled, private/link-local address targets are rejected, and redirects are refused so authorization is not forwarded to another target. `--allow-local-test` permits only explicit loopback HTTP fixtures.

The scan uses individually consistent file bytes, not a transactional snapshot of the entire NAS. `scanComplete` means the supported enumeration completed without unresolved read/scope errors. It is not proof that all documents were valid, that every contract had a readable text layer or that the folder was immutable throughout the scan.

## Resume, scheduling and reporting

The mode-0600 state file stores one exact pending request, its scan ID and the acknowledged path/hash map. The optional pending request can contain private text previews; the state is confidential even though it contains no token or PDF binary. Only one process can use a state file at a time.

On timeout or a temporary server error, the same persisted request key and payload are retried. The receiver must enforce payload-bound idempotency. Do not delete an uncertain pending state and blindly create a different intention.

When recovering a lost final acknowledgement, a successful run reports `resumedAcknowledgement: true`: that confirms the prior scan, not a fresh scan of files changed since then. The next invocation starts a new scan. Each new scan visits the supported archive again; backend versioning avoids duplicate immutable versions and can identify previously indexed files now missing. An incomplete scan must never cause automatic missing-file removal or business corrections.

Run the command periodically with the NAS scheduler or an OS service after the initial read-only test. A 15-minute cadence is an example, not a schedule installed by this code. Keep the same private state path so retries recover the same intention. The stdout result contains counts and fixed status/error codes only. Exit 0 means enumeration complete, 2 means an incomplete scan, and 1 means a failed operation with a recoverable state where possible.

## Local verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_nas_document_bridge.py
```

The tests use temporary synthetic files and a loopback receiver. They cover no binary/token transfer, real hashes, read-only source bytes, private state, 50-document batches, exact replay after response loss, symlinks/traversal, nonregular files, oversized/empty/unsupported documents, missing extraction/OCR/truncation, redirect refusal and safe HTTP retry. Where Poppler is available, a generated two-page synthetic PDF verifies actual page extraction. No real NAS, model provider or production application is contacted.
