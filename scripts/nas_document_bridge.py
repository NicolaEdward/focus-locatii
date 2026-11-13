#!/usr/bin/env python3
"""Read-only PDF indexer. Sends references and optional text previews, never PDFs.

Run on the NAS or a POSIX host with read-only mounts. Authentication is supplied
only through NAS_INGEST_TOKEN. The local state is private and resumable.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import socket
import ssl
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TEXT_BYTES = 16 * 1024
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_BATCH_DOCS = 50
MAX_FILES = 20_000
MAX_STATE_BYTES = 32 * 1024 * 1024
OTHER_DOCUMENT_SUFFIXES = {".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}


class BridgeError(Exception):
    """Only fixed non-sensitive error codes are allowed to reach the CLI."""


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_path(value):
    value = str(value)
    parts = value.split("/")
    if (not value or len(value.encode("utf-16-le")) // 2 > 1024 or value != value.strip()
            or re.search(r"[\\\x00-\x1f\x7f?#]", value) or re.search(r"%(?:2e|2f|5c|00)", value, re.IGNORECASE)
            or value.startswith("/") or any(p in ("", ".", "..") or p.startswith(".") or ":" in p for p in parts)):
        raise BridgeError("DOCUMENT_PATH_REJECTED")
    return str(PurePosixPath(value))


def verified_directory(value):
    path = Path(value).expanduser().absolute()
    if path == Path(path.anchor):
        raise BridgeError("ROOT_FILESYSTEM_SCOPE_REJECTED")
    if ".." in path.parts:
        raise BridgeError("ROOT_TRAVERSAL_REJECTED")
    current = Path(path.anchor)
    try:
        for part in path.parts[1:]:
            current = current / part
            if stat.S_ISLNK(os.lstat(current).st_mode):
                raise BridgeError("ROOT_SYMLINK_REJECTED")
        if not path.is_dir():
            raise BridgeError("ROOT_DIRECTORY_REQUIRED")
    except OSError:
        raise BridgeError("ROOT_DIRECTORY_UNAVAILABLE") from None
    return path


def configured_root(value, document_type):
    alias, separator, folder = value.partition("=")
    if not separator or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", alias):
        raise BridgeError("ROOT_MUST_BE_ALIAS_EQUALS_DIRECTORY")
    return {"alias": alias, "directory": str(verified_directory(folder)), "documentType": document_type}


def endpoint_for(app_url, source_id, allow_local_test=False, resolver=socket.getaddrinfo):
    try:
        parsed = urllib.parse.urlsplit(app_url)
        port = parsed.port
    except (ValueError, TypeError):
        raise BridgeError("APP_URL_INVALID") from None
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,191}", source_id):
        raise BridgeError("SOURCE_ID_INVALID")
    if (parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path not in ("", "/") or not parsed.hostname):
        raise BridgeError("APP_URL_ORIGIN_ONLY_NO_CREDENTIALS")
    host = parsed.hostname.lower()
    local = allow_local_test and host in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise BridgeError("HTTPS_APP_URL_REQUIRED")
    if not local and port not in (None, 443):
        raise BridgeError("PUBLIC_HTTPS_PORT_REQUIRED")
    try:
        addresses = {ipaddress.ip_address(row[4][0]) for row in resolver(host, port or (80 if parsed.scheme == "http" else 443), type=socket.SOCK_STREAM)}
    except (OSError, ValueError):
        raise BridgeError("APP_HOST_RESOLUTION_FAILED") from None
    if not addresses or any(not (address.is_loopback if local else address.is_global) for address in addresses):
        raise BridgeError("APP_HOST_ADDRESS_REJECTED")
    origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    return origin, origin + "/api/document-sources/" + source_id + "/ingest"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def post_payload(endpoint, payload, token, attempts=3, opener=None, sleeper=time.sleep):
    body = canonical(payload)
    if len(body) > MAX_BODY_BYTES:
        raise BridgeError("INGEST_BODY_LIMIT_EXCEEDED")
    opener = opener or urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    for attempt in range(attempts):
        request = urllib.request.Request(endpoint, data=body, method="POST", headers={
            "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json",
            "User-Agent": "FocusMedia-NAS-Readonly-Bridge/1",
        })
        delay = min(2, 0.5 * (2 ** attempt))
        try:
            with opener.open(request, timeout=30) as response:
                if not 200 <= response.status < 300:
                    raise BridgeError("INGEST_HTTP_" + str(response.status))
                if len(response.read(65537)) > 65536:
                    raise BridgeError("INGEST_RESPONSE_TOO_LARGE_VERIFY_BEFORE_RETRY")
                return response.status
        except urllib.error.HTTPError as error:
            code = error.code
            retryable = code in (408, 429, 500, 502, 503, 504)
            if code == 429:
                raw_delay = error.headers.get("Retry-After", "")
                if raw_delay.isdecimal():
                    if int(raw_delay) > 30:
                        error.close()
                        raise BridgeError("INGEST_RATE_LIMITED_RETRY_LATER") from None
                    delay = max(delay, int(raw_delay))
            error.close()
            if not retryable or attempt + 1 == attempts:
                raise BridgeError("INGEST_HTTP_" + str(code)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 == attempts:
                raise BridgeError("INGEST_TRANSPORT_FAILED_RETRY_SAME_STATE") from None
        sleeper(delay)
    raise BridgeError("INGEST_TRANSPORT_FAILED_RETRY_SAME_STATE")


def _parser_limits():
    # The bridge is a single-threaded POSIX CLI. Limit the optional native parser
    # in its child, in addition to the source file and captured output limits.
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))


def extract_preview(data, include_text=False):
    if not data.startswith(b"%PDF-"):
        return "unsupported", [], False
    if not include_text:
        return "metadata_only", [], False
    binary = shutil.which("pdftotext")
    if not binary:
        return "extraction_unavailable", [], False
    with tempfile.TemporaryDirectory(prefix="focus-nas-private-") as folder:
        os.chmod(folder, 0o700)
        file = Path(folder) / "source.pdf"
        descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        try:
            process = subprocess.Popen([binary, "-enc", "UTF-8", "-layout", str(file), "-"],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       stdin=subprocess.DEVNULL, close_fds=True, preexec_fn=_parser_limits)
        except OSError:
            return "extraction_unavailable", [], False
        output = bytearray()
        truncated = False
        deadline = time.monotonic() + 35
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return "extraction_unavailable", [], False
                    for key, _events in selector.select(min(remaining, 1)):
                        chunk = os.read(key.fileobj.fileno(), 4096)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        output.extend(chunk)
                        if len(output) > MAX_TEXT_BYTES:
                            truncated = True
                            break
                    if truncated:
                        break
            if not truncated and process.wait(timeout=max(0.1, deadline - time.monotonic())) != 0:
                return "extraction_unavailable", [], False
        except (OSError, subprocess.SubprocessError):
            return "extraction_unavailable", [], False
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdout:
                process.stdout.close()
        text = bytes(output[:MAX_TEXT_BYTES]).decode("utf-8", errors="ignore")
        pages = []
        for index, piece in enumerate(text.split("\f"), 1):
            if index > 10000:
                truncated = True
                break
            piece = "".join(c for c in piece if ord(c) >= 32 or c in "\n\r\t").strip()
            if piece:
                if len(pages) == 64:
                    truncated = True
                    break
                pages.append({"page": index, "text": piece})
        return ("text_available", pages, truncated) if pages else ("needs_ocr", [], truncated)


def _identity(value):
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def read_document(directory_fd, filename, relative_path, document_type, include_text=False, extractor=extract_preview):
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "fwalk"):
        raise BridgeError("POSIX_NOFOLLOW_REQUIRED_USE_NAS_LINUX_OR_WSL")
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=directory_fd)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise BridgeError("SOURCE_NOT_REGULAR_FILE")
        if before.st_size > MAX_FILE_BYTES:
            raise BridgeError("SOURCE_FILE_TOO_LARGE")
        if before.st_size == 0:
            raise BridgeError("SOURCE_FILE_EMPTY")
        if len(filename.encode("utf-16-le")) // 2 > 255:
            raise BridgeError("DOCUMENT_PATH_REJECTED")
        chunks, size = [], 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, MAX_FILE_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise BridgeError("SOURCE_FILE_TOO_LARGE")
        data = b"".join(chunks)
        if _identity(before) != _identity(os.fstat(descriptor)) or size != before.st_size:
            raise BridgeError("SOURCE_FILE_CHANGED")
        extraction_status, pages, truncated = extractor(data, include_text)
        after = os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
        if _identity(before) != _identity(after) or _identity(before) != _identity(os.fstat(descriptor)):
            raise BridgeError("SOURCE_FILE_CHANGED")
        if sum(len(page["text"].encode("utf-8")) for page in pages) > MAX_TEXT_BYTES:
            raise BridgeError("EXTRACTED_TEXT_LIMIT_EXCEEDED")
        return {
            "path": canonical_path(relative_path), "displayName": filename, "documentType": document_type,
            "sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": size,
            "modifiedAt": dt.datetime.fromtimestamp(before.st_mtime, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "extractionStatus": extraction_status, "textTruncated": truncated, "pages": pages,
            "facts": [], "verification": "unverified",
        }
    finally:
        os.close(descriptor)


def _safe_state_path(value, roots):
    path = Path(value).expanduser().absolute()
    if any(path == Path(root["directory"]) or Path(root["directory"]) in path.parents for root in roots):
        raise BridgeError("STATE_MUST_BE_OUTSIDE_SOURCE_ROOTS")
    if path.is_symlink() or path.with_name(path.name + ".lock").is_symlink():
        raise BridgeError("STATE_SYMLINK_REJECTED")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.resolve() != path.parent:
        raise BridgeError("STATE_PARENT_SYMLINK_REJECTED")
    return path


def save_state(path, value):
    data = canonical(value)
    if len(data) > MAX_STATE_BYTES:
        raise BridgeError("STATE_LIMIT_EXCEEDED")
    descriptor, temporary = tempfile.mkstemp(prefix=".nas-state-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if path.is_symlink():
            raise BridgeError("STATE_SYMLINK_REJECTED")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def payload_for(source_id, scan_id, documents, complete=False, observed_at=None):
    body = {"scanId": scan_id, "scanComplete": complete, "observedAt": observed_at or utc_now(), "documents": documents}
    body["requestKey"] = "nas:" + hashlib.sha256(canonical({"sourceId": source_id, **body})).hexdigest()
    if len(canonical(body)) > MAX_BODY_BYTES:
        raise BridgeError("INGEST_BODY_LIMIT_EXCEEDED")
    return body


def run_scan(app_url, source_id, roots, state_file, token, include_text=False, allow_local_test=False, sender=post_payload):
    if not roots or len(roots) > 20 or len({root["alias"] for root in roots}) != len(roots):
        raise BridgeError("ONE_TO_TWENTY_UNIQUE_ROOT_ALIASES_REQUIRED")
    if not token or len(token) > 4096 or any(c.isspace() or ord(c) < 33 for c in token):
        raise BridgeError("NAS_INGEST_TOKEN_REQUIRED_IN_ENVIRONMENT")
    roots = [{**root, "directory": str(verified_directory(root["directory"]))} for root in roots]
    origin, endpoint = endpoint_for(app_url, source_id, allow_local_test)
    state_path = _safe_state_path(state_file, roots)
    configuration = hashlib.sha256(canonical({"origin": origin, "sourceId": source_id, "roots": roots, "includeText": include_text})).hexdigest()
    lock_fd = os.open(str(state_path) + ".lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
            raise BridgeError("STATE_LOCK_NOT_REGULAR")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BridgeError("STATE_ALREADY_IN_USE") from None
        state = None
        if state_path.exists():
            descriptor = os.open(state_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode):
                    raise BridgeError("STATE_NOT_REGULAR")
                data = stream.read(MAX_STATE_BYTES + 1)
                if len(data) > MAX_STATE_BYTES:
                    raise BridgeError("STATE_LIMIT_EXCEEDED")
                state = json.loads(data)
            if state.get("version") != 1 or state.get("configuration") != configuration:
                raise BridgeError("STATE_CONFIGURATION_CHANGED_USE_ANOTHER_STATE_FILE")
        if not state or state.get("completed"):
            state = {"version": 1, "configuration": configuration, "scanId": str(uuid.uuid4()), "completed": False, "sent": {}, "pending": None}
            save_state(state_path, state)

        def send_pending():
            pending = state.get("pending")
            if not pending:
                return
            expected = payload_for(source_id, state["scanId"], pending["documents"], pending["scanComplete"], pending["observedAt"])
            if canonical(expected) != canonical(pending):
                raise BridgeError("PENDING_STATE_HASH_MISMATCH")
            # Every retry uses the same persisted intent and bytes. The server
            # must enforce requestKey/payload equality before acknowledging.
            endpoint_for(app_url, source_id, allow_local_test)
            sender(endpoint, pending, token)
            for document in pending["documents"]:
                state["sent"][document["path"]] = document["sha256"]
            if pending["scanComplete"]:
                state["completed"] = True
            state["pending"] = None
            save_state(state_path, state)

        send_pending()
        if state["completed"]:
            return {"ok": True, "scanComplete": True, "resumedAcknowledgement": True, "indexedDocuments": len(state["sent"])}
        counts = {"pdfFilesSeen": 0, "indexedDocuments": 0, "alreadyAcknowledged": 0, "skippedSymlinks": 0,
                  "skippedUnsupportedDocuments": 0, "skippedUnreadableOrChanged": 0, "extractionUnavailable": 0, "needsOcr": 0}
        batch, seen_paths = [], set()

        def flush(complete=False):
            nonlocal batch
            state["pending"] = payload_for(source_id, state["scanId"], batch, complete)
            save_state(state_path, state)
            send_pending()
            batch = []

        for root in roots:
            root_fd = os.open(root["directory"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                def walk_error(_error):
                    counts["skippedUnreadableOrChanged"] += 1
                for relative_dir, directories, files, directory_fd in os.fwalk(".", topdown=True, follow_symlinks=False, dir_fd=root_fd, onerror=walk_error):
                    allowed = []
                    for directory in sorted(directories):
                        try:
                            info = os.stat(directory, dir_fd=directory_fd, follow_symlinks=False)
                            if stat.S_ISLNK(info.st_mode):
                                counts["skippedSymlinks"] += 1
                            elif not directory.startswith(".") and stat.S_ISDIR(info.st_mode):
                                allowed.append(directory)
                        except OSError:
                            counts["skippedUnreadableOrChanged"] += 1
                    directories[:] = allowed
                    for filename in sorted(files):
                        if len(batch) == MAX_BATCH_DOCS:
                            flush()
                        if filename.startswith("."):
                            continue
                        try:
                            info = os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
                            if stat.S_ISLNK(info.st_mode):
                                counts["skippedSymlinks"] += 1
                                continue
                            suffix = Path(filename).suffix.lower()
                            if suffix != ".pdf":
                                if suffix in OTHER_DOCUMENT_SUFFIXES:
                                    counts["skippedUnsupportedDocuments"] += 1
                                continue
                            counts["pdfFilesSeen"] += 1
                            if counts["pdfFilesSeen"] > MAX_FILES:
                                raise BridgeError("SCAN_FILE_LIMIT_EXCEEDED")
                            relative = PurePosixPath(relative_dir)
                            logical_path = canonical_path(str(PurePosixPath(root["alias"]) / relative / filename))
                            if logical_path in seen_paths:
                                raise BridgeError("CANONICAL_PATH_COLLISION")
                            seen_paths.add(logical_path)
                            document = read_document(directory_fd, filename, logical_path, root["documentType"], include_text)
                            if state["sent"].get(logical_path) == document["sha256"]:
                                counts["alreadyAcknowledged"] += 1
                                continue
                            batch.append(document)
                            counts["indexedDocuments"] += 1
                            if document["extractionStatus"] == "extraction_unavailable":
                                counts["extractionUnavailable"] += 1
                            if document["extractionStatus"] == "needs_ocr":
                                counts["needsOcr"] += 1
                        except BridgeError as error:
                            if str(error) not in ("SOURCE_NOT_REGULAR_FILE", "SOURCE_FILE_TOO_LARGE", "SOURCE_FILE_EMPTY", "SOURCE_FILE_CHANGED", "DOCUMENT_PATH_REJECTED", "EXTRACTED_TEXT_LIMIT_EXCEEDED"):
                                raise
                            counts["skippedUnreadableOrChanged"] += 1
                        except OSError:
                            counts["skippedUnreadableOrChanged"] += 1
            finally:
                os.close(root_fd)
        complete = counts["skippedUnreadableOrChanged"] == 0 and counts["skippedUnsupportedDocuments"] == 0
        flush(complete)
        return {"ok": complete, "scanComplete": complete, **counts}
    finally:
        os.close(lock_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", required=True, help="HTTPS application origin; no credentials or query")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--root", action="append", default=[], help="alias=/read-only/path, document type unknown")
    parser.add_argument("--contract-root", action="append", default=[], help="alias=/read-only/contracts")
    parser.add_argument("--invoice-root", action="append", default=[], help="alias=/read-only/invoices")
    parser.add_argument("--state", required=True, help="Private local state file OUTSIDE source roots")
    parser.add_argument("--include-text", action="store_true", help="Opt in to bounded unverified text previews")
    parser.add_argument("--allow-local-test", action="store_true", help="Allow only loopback HTTP test receivers")
    args = parser.parse_args(argv)
    try:
        roots = [configured_root(value, kind) for values, kind in ((args.root, "unknown"), (args.contract_root, "contract"), (args.invoice_root, "invoice")) for value in values]
        result = run_scan(args.app_url, args.source_id, roots, args.state, os.environ.get("NAS_INGEST_TOKEN", ""), args.include_text, args.allow_local_test)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["ok"] else 2
    except BridgeError as error:
        print(json.dumps({"ok": False, "errorCode": str(error)}))
        return 1
    except Exception:
        print(json.dumps({"ok": False, "errorCode": "NAS_BRIDGE_FAILED"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
