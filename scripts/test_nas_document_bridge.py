#!/usr/bin/env python3
"""Local synthetic tests. No NAS or external service is contacted."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

SPEC = importlib.util.spec_from_file_location("nas_bridge", Path(__file__).with_name("nas_document_bridge.py"))
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class Receiver:
    def __init__(self, statuses=None, redirect=False, receipt_transform=None, response_body=None,
                 content_type="application/json", lost_ack=False, corrupt_after_begin=False):
        self.requests = []
        self.statuses = list(statuses or [200])
        self.redirect = redirect
        self.response_body = response_body
        self.receipts = {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                owner.requests.append({"path": self.path, "body": body, "authorization": self.headers.get("Authorization")})
                status_code = owner.statuses.pop(0) if owner.statuses else 200
                payload = json.loads(body)
                source_id = self.path.split("/")[-2]
                payload_hash = hashlib.sha256(bridge.canonical(payload)).hexdigest()
                prior = owner.receipts.get(payload_hash)
                receipt = dict(prior) if prior else {
                    "sourceId": source_id, "scanId": payload["scanId"], "observedAt": payload["observedAt"],
                    "payloadHash": payload_hash, "batchAccepted": True, "newDocuments": len(payload["documents"]),
                    "newVersions": len(payload["documents"]), "unchanged": 0, "staleIgnored": 0, "missingFiles": 0,
                    "scanCompletionAccepted": payload["scanComplete"], "binariesStored": False, "verifiedFactsImported": 0,
                    "replayed": prior is not None,
                }
                receipt["replayed"] = prior is not None
                if 200 <= status_code < 300:
                    owner.receipts[payload_hash] = dict(receipt)
                if lost_ack and len(owner.requests) == 1:
                    self.close_connection = True
                    return
                corrupt = not corrupt_after_begin or payload["documents"] or payload["scanComplete"]
                if receipt_transform and corrupt:
                    receipt = receipt_transform(receipt)
                self.send_response(status_code)
                if owner.redirect:
                    self.send_header("Location", "/redirected")
                self.send_header("Content-Type", content_type if corrupt else "application/json")
                if status_code == 429:
                    self.send_header("Retry-After", "120")
                self.end_headers()
                self.wfile.write(owner.response_body if corrupt and owner.response_body is not None else bridge.canonical(receipt))

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_address[1])

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def pdf_bytes(lines=("Synthetic invoice",)):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", None]
    pages, page_ids = [], []
    for index, text in enumerate(lines):
        page_id = 3 + index * 2
        content_id = page_id + 1
        page_ids.append(page_id)
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content = f"BT /F1 12 Tf 30 100 Td ({escaped}) Tj ET".encode("ascii")
        pages.extend([
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents {content_id} 0 R >>".encode(),
            b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        ])
    objects[1] = ("<< /Type /Pages /Count " + str(len(lines)) + " /Kids [" + " ".join(str(i) + " 0 R" for i in page_ids) + "] >>").encode()
    objects.extend(pages)
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(str(index).encode() + b" 0 obj\n" + value + b"\nendobj\n")
    start = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.extend(f"{offset:010} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(output)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="focus-nas-tests-")
        self.folder = Path(self.temporary.name)
        self.root = self.folder / "contracts"
        self.root.mkdir()
        self.state = self.folder / "private" / "state.json"
        self.roots = [{"alias": "contracts", "directory": str(self.root), "documentType": "contract"}]
        self.token = "synthetic-nas-token-never-persisted-2026"

    def tearDown(self):
        self.temporary.cleanup()

    def scan(self, receiver, **options):
        return bridge.run_scan(receiver.origin, "synthetic-source", self.roots, self.state, self.token,
                               allow_local_test=True, **options)

    def test_path_and_origin_policy(self):
        for value in ("../outside.pdf", "/outside.pdf", "a/../b.pdf", "a\\b.pdf", "a//b.pdf", "a/./b.pdf", "a/secret\n.pdf", "a/.hidden.pdf", "a/file?.pdf", "a/file#.pdf", "a/file%2e.pdf", "a/a:b.pdf", "a/x.pdf "):
            with self.assertRaises(bridge.BridgeError):
                bridge.canonical_path(value)
        self.assertEqual(bridge.canonical_path("contracts/Contract A.pdf"), "contracts/Contract A.pdf")
        public = lambda *_a, **_k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        local = lambda *_a, **_k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        self.assertEqual(bridge.endpoint_for("https://app.example", "safe", resolver=public)[1], "https://app.example/api/document-sources/safe/ingest")
        for value in ("http://app.example", "https://u:secret@app.example", "https://app.example/x", "https://app.example?token=secret", "https://app.example#secret", "https://app.example:5001"):
            with self.assertRaises(bridge.BridgeError):
                bridge.endpoint_for(value, "safe", resolver=public)
        with self.assertRaises(bridge.BridgeError):
            bridge.endpoint_for("https://app.example", "safe", resolver=local)
        with self.assertRaises(bridge.BridgeError):
            bridge.endpoint_for("http://127.0.0.1:9000", "safe")
        with self.assertRaises(bridge.BridgeError):
            bridge.endpoint_for("https://app.example", "../../wrong", resolver=public)

    def test_source_ancestor_replaced_after_validation_cannot_escape_scope(self):
        parent = self.folder / "approved-parent"
        approved = parent / "contracts"
        approved.mkdir(parents=True)
        outside = self.folder / "outside-parent"
        (outside / "contracts").mkdir(parents=True)
        (outside / "contracts" / "outside.pdf").write_bytes(pdf_bytes(("Outside approved root",)))
        roots = [{"alias": "contracts", "directory": str(approved), "documentType": "contract"}]
        original = bridge.verified_directory
        replaced = False
        def validate_then_replace(value):
            nonlocal replaced
            verified = original(value)
            if Path(value) == approved and not replaced:
                parent.rename(self.folder / "original-approved-parent")
                parent.symlink_to(outside, target_is_directory=True)
                replaced = True
            return verified
        with Receiver() as receiver, mock.patch.object(bridge, "verified_directory", side_effect=validate_then_replace):
            with self.assertRaisesRegex(bridge.BridgeError, "ROOT_DIRECTORY_CHANGED_OR_UNAVAILABLE"):
                bridge.run_scan(receiver.origin, "synthetic-source", roots, self.state, self.token, allow_local_test=True)
            self.assertTrue(replaced)
            self.assertTrue(receiver.requests)
            self.assertTrue(all(not json.loads(item["body"])["documents"] for item in receiver.requests))

    def test_metadata_only_private_state_no_binary_or_token(self):
        file = self.root / "contract.pdf"
        original = b"%PDF-1.7\nRaw private binary " + self.token.encode() + b"\x00\xff\n"
        file.write_bytes(original)
        before = file.stat()
        with Receiver() as receiver:
            result = self.scan(receiver)
            self.assertTrue(result["scanComplete"])
            self.assertEqual(len(receiver.requests), 2)
            self.assertEqual(json.loads(receiver.requests[0]["body"])["documents"], [])
            self.assertFalse(json.loads(receiver.requests[0]["body"])["scanComplete"])
            raw = receiver.requests[-1]["body"]
            self.assertNotIn(original, raw)
            self.assertNotIn(self.token.encode(), raw)
            self.assertNotIn(str(self.root).encode(), raw)
            self.assertEqual(receiver.requests[0]["authorization"], "Bearer " + self.token)
            self.assertEqual(receiver.requests[0]["path"], "/api/document-sources/synthetic-source/ingest")
            body = json.loads(raw)
            document = body["documents"][0]
            self.assertEqual(document["sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(document["path"], "contracts/contract.pdf")
            self.assertEqual(document["documentType"], "contract")
            self.assertEqual(document["extractionStatus"], "metadata_only")
            self.assertEqual(document["verification"], "unverified")
            self.assertEqual(document["facts"], [])
            self.assertEqual(document["pages"], [])
            self.assertTrue(body["scanComplete"])
        self.assertEqual(file.read_bytes(), original)
        self.assertEqual(file.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(self.token, self.state.read_text())
        self.assertNotIn("%PDF", self.state.read_text())
        self.assertIsNone(json.loads(self.state.read_text())["pending"])

    def test_symlinks_hidden_and_state_inside_root_are_refused(self):
        outside = self.folder / "outside"
        outside.mkdir()
        (outside / "secret.pdf").write_bytes(pdf_bytes())
        (self.root / "good.PDF").write_bytes(pdf_bytes())
        (self.root / ".hidden.pdf").write_bytes(pdf_bytes())
        (self.root / "escape.pdf").symlink_to(outside / "secret.pdf")
        (self.root / "escape-folder").symlink_to(outside, target_is_directory=True)
        with Receiver() as receiver:
            result = self.scan(receiver)
            self.assertEqual(result["indexedDocuments"], 1)
            self.assertEqual(result["skippedSymlinks"], 2)
            self.assertEqual([d["path"] for p in receiver.requests for d in json.loads(p["body"])["documents"]], ["contracts/good.PDF"])
            with self.assertRaisesRegex(bridge.BridgeError, "STATE_MUST_BE_OUTSIDE"):
                bridge.run_scan(receiver.origin, "synthetic-source", self.roots, self.root / "state.json", self.token, allow_local_test=True)
        symlink_root = self.folder / "link-root"
        symlink_root.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(bridge.BridgeError, "SYMLINK"):
            bridge.configured_root("unsafe=" + str(symlink_root), "unknown")

    def test_oversize_nonregular_or_unsupported_does_not_claim_complete(self):
        with (self.root / "too-large.pdf").open("wb") as stream:
            stream.write(b"%PDF-1.7")
            stream.truncate(bridge.MAX_FILE_BYTES + 1)
        (self.root / "spreadsheet.xlsx").write_bytes(b"not uploaded")
        os.mkfifo(self.root / "named-pipe.pdf")
        (self.root / "empty.pdf").write_bytes(b"")
        with Receiver() as receiver:
            result = self.scan(receiver)
            self.assertFalse(result["scanComplete"])
            self.assertEqual(result["skippedUnreadableOrChanged"], 3)
            self.assertEqual(result["skippedUnsupportedDocuments"], 1)
            body = json.loads(receiver.requests[-1]["body"])
            self.assertEqual(body["documents"], [])
            self.assertFalse(body["scanComplete"])

    def test_changed_file_is_not_a_mixed_hash_text_record(self):
        file = self.root / "changing.pdf"
        file.write_bytes(pdf_bytes(("Old original",)))
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        def change(data, include_text):
            file.write_bytes(pdf_bytes(("Changed while parsing",)))
            return "text_available", [{"page": 1, "text": "old snapshot"}], False
        try:
            with self.assertRaisesRegex(bridge.BridgeError, "SOURCE_FILE_CHANGED"):
                bridge.read_document(descriptor, file.name, "contracts/changing.pdf", "contract", True, extractor=change)
        finally:
            os.close(descriptor)

    def test_interrupted_upload_retries_exact_intention_without_rescan_claim(self):
        file = self.root / "contract.pdf"
        file.write_bytes(pdf_bytes())
        attempts = []
        def failed(endpoint, payload, token):
            if not payload["documents"] and not payload["scanComplete"]:
                return bridge.post_payload(endpoint, payload, token)
            attempts.append(bridge.canonical(payload))
            raise bridge.BridgeError("INGEST_TRANSPORT_FAILED_RETRY_SAME_STATE")
        with Receiver() as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "SAME_STATE"):
                self.scan(receiver, sender=failed)
            pending = json.loads(self.state.read_text())["pending"]
            self.assertEqual(attempts[0], bridge.canonical(pending))
            file.write_bytes(pdf_bytes(("A later actual version",)))
            resumed = self.scan(receiver)
            self.assertTrue(resumed["resumedAcknowledgement"])
            self.assertEqual(receiver.requests[1]["body"], attempts[0])
            self.assertNotEqual(json.loads(receiver.requests[1]["body"])["documents"][0]["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())
            self.scan(receiver)
            self.assertNotEqual(receiver.requests[-1]["body"], attempts[0])
            self.assertEqual(json.loads(receiver.requests[-1]["body"])["documents"][0]["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())

    def test_batches_and_network_error_are_not_swallowed_as_file_errors(self):
        for index in range(52):
            (self.root / f"contract-{index:02}.pdf").write_bytes(pdf_bytes((f"Invoice {index}",)))
        attempts = []
        def failed(_endpoint, payload, _token):
            if not payload["documents"] and not payload["scanComplete"]:
                return bridge.post_payload(_endpoint, payload, _token)
            attempts.append(bridge.canonical(payload))
            raise bridge.BridgeError("INGEST_TRANSPORT_FAILED_RETRY_SAME_STATE")
        with Receiver() as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "SAME_STATE"):
                self.scan(receiver, sender=failed)
            pending = json.loads(self.state.read_text())["pending"]
            self.assertEqual(len(pending["documents"]), 50)
            self.assertFalse(pending["scanComplete"])
            result = self.scan(receiver)
            self.assertTrue(result["scanComplete"])
            self.assertEqual(receiver.requests[1]["body"], attempts[0])
            self.assertEqual([len(json.loads(r["body"])["documents"]) for r in receiver.requests], [0, 50, 0, 2])
            self.assertTrue(json.loads(receiver.requests[-1]["body"])["scanComplete"])
            self.assertEqual(len(json.loads(self.state.read_text())["sent"]), 52)

    def test_http_retry_and_redirect_no_credential_forward(self):
        payload = bridge.payload_for("source", "scan", [], True)
        with Receiver([503, 200]) as receiver:
            delays = []
            bridge.post_payload(receiver.origin + "/api/document-sources/source/ingest", payload, self.token, sleeper=delays.append)
            self.assertEqual(len(receiver.requests), 2)
            self.assertEqual(receiver.requests[0]["body"], receiver.requests[1]["body"])
            self.assertEqual(len(delays), 1)
        with Receiver([302], redirect=True) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "INGEST_HTTP_302"):
                bridge.post_payload(receiver.origin + "/api/document-sources/source/ingest", payload, self.token)
            self.assertEqual(len(receiver.requests), 1)
        with Receiver([429]) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "RETRY_LATER"):
                bridge.post_payload(receiver.origin + "/api/document-sources/source/ingest", payload, self.token, sleeper=lambda _: self.fail("long Retry-After must not sleep"))

    def test_invalid_success_receipts_never_acknowledge_pending(self):
        (self.root / "contract.pdf").write_bytes(pdf_bytes())
        cases = [
            {"response_body": b"<html>proxy login private body</html>", "content_type": "text/html"},
            {"response_body": b'{"ok":true}'},
            {"response_body": b"not JSON: private response content"},
            {"response_body": b'{"sourceId":"first","sourceId":"duplicate"}'},
            {"receipt_transform": lambda value: {**value, "sourceId": "wrong-source"}},
            {"receipt_transform": lambda value: {**value, "scanId": "wrong-scan"}},
            {"receipt_transform": lambda value: {**value, "observedAt": "2000-01-01T00:00:00.000Z"}},
            {"receipt_transform": lambda value: {**value, "payloadHash": "0" * 64}},
            {"receipt_transform": lambda value: {**value, "scanCompletionAccepted": False}},
            {"receipt_transform": lambda value: {**value, "batchAccepted": False}},
            {"receipt_transform": lambda value: {**value, "newVersions": 0, "staleIgnored": 1}},
            {"receipt_transform": lambda value: {**value, "newDocuments": True}},
            {"receipt_transform": lambda value: {**value, "unchanged": -1}},
            {"receipt_transform": lambda value: {**value, "newVersions": 2}},
            {"receipt_transform": lambda value: {**value, "binariesStored": True}},
            {"receipt_transform": lambda value: {**value, "verifiedFactsImported": 1}},
            {"response_body": b"x" * 65537},
        ]
        for index, options in enumerate(cases):
            with self.subTest(case=index), Receiver(corrupt_after_begin=True, **options) as receiver:
                self.state = self.folder / "private" / f"bad-receipt-{index}.json"
                with self.assertRaises(bridge.BridgeError) as caught:
                    self.scan(receiver)
                self.assertNotIn("private", str(caught.exception))
                self.assertNotIn(self.token, str(caught.exception))
                pending_state = json.loads(self.state.read_text())
                self.assertFalse(pending_state["completed"])
                self.assertEqual(pending_state["sent"], {})
                self.assertEqual(len(pending_state["pending"]["documents"]), 1)
                self.assertTrue(pending_state["scanBegun"])
                self.assertEqual(len(receiver.requests), 2)

    def test_partial_receipt_cannot_claim_completion_and_409_preserves_intention(self):
        (self.root / "unsupported.xlsx").write_bytes(b"unsupported source keeps scan incomplete")
        with Receiver(receipt_transform=lambda value: {**value, "scanCompletionAccepted": True}) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "SCAN_COMPLETION_NOT_ACCEPTED"):
                self.scan(receiver)
            state = json.loads(self.state.read_text())
            self.assertFalse(state["pending"]["scanComplete"])
            self.assertFalse(state["completed"])
        self.state = self.folder / "private" / "lease-conflict.json"
        with Receiver([409]) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "INGEST_HTTP_409"):
                self.scan(receiver)
            original = json.loads(self.state.read_text())["pending"]
            self.assertEqual(len(receiver.requests), 1)
            # An operator retry retains the exact intention; it does not invent a scan.
            with self.assertRaisesRegex(bridge.BridgeError, "INGEST_HTTP_409"):
                receiver.statuses = [409]
                self.scan(receiver)
            self.assertEqual(json.loads(self.state.read_text())["pending"], original)
            self.assertEqual(receiver.requests[0]["body"], receiver.requests[1]["body"])

    def test_lost_committed_ack_retries_same_body_and_validates_replay_receipt(self):
        (self.root / "contract.pdf").write_bytes(pdf_bytes())
        with Receiver(lost_ack=True) as receiver:
            result = self.scan(receiver, sender=lambda endpoint, payload, token: bridge.post_payload(endpoint, payload, token, sleeper=lambda _delay: None))
            self.assertTrue(result["scanComplete"])
            self.assertEqual(len(receiver.requests), 3)
            self.assertEqual(receiver.requests[0]["body"], receiver.requests[1]["body"])
            self.assertEqual(len(receiver.receipts), 2)
            self.assertTrue(json.loads(self.state.read_text())["completed"])
            self.assertIsNone(json.loads(self.state.read_text())["pending"])

    def test_begin_receipt_is_required_before_reading_and_resumes_exactly(self):
        (self.root / "contract.pdf").write_bytes(pdf_bytes())
        with Receiver(response_body=b'{"ok":true}') as receiver:
            with mock.patch.object(bridge.os, "fwalk", side_effect=AssertionError("No source enumeration before valid begin receipt")):
                with self.assertRaisesRegex(bridge.BridgeError, "RECEIPT_INVALID"):
                    self.scan(receiver)
            state = json.loads(self.state.read_text())
            self.assertFalse(state["scanBegun"])
            self.assertEqual(state["pending"]["documents"], [])
            self.assertFalse(state["pending"]["scanComplete"])
            pending = bridge.canonical(state["pending"])
            scan_id = state["scanId"]
            receiver.response_body = None
            result = self.scan(receiver)
            self.assertTrue(result["scanComplete"])
            self.assertEqual(receiver.requests[1]["body"], pending)
            self.assertEqual(json.loads(receiver.requests[-1]["body"])["scanId"], scan_id)
            self.assertTrue(json.loads(self.state.read_text())["scanBegun"])

    def test_heartbeats_flush_within_scan_and_legacy_pending_requires_recovery(self):
        (self.root / "contract.pdf").write_bytes(pdf_bytes())
        monotonic = [0]
        timestamp = [0]
        def clock():
            monotonic[0] += 121
            return monotonic[0]
        def observed():
            timestamp[0] += 1
            return f"2026-11-13T00:00:{timestamp[0]:02d}.000Z"
        with Receiver() as receiver:
            with mock.patch.object(bridge, "time", SimpleNamespace(monotonic=clock)), mock.patch.object(bridge, "utc_now", side_effect=observed):
                self.assertTrue(self.scan(receiver)["scanComplete"])
            bodies = [json.loads(request["body"]) for request in receiver.requests]
            self.assertGreaterEqual(len([body for body in bodies if not body["documents"] and not body["scanComplete"]]), 2)
            self.assertEqual(len({body["scanId"] for body in bodies}), 1)
            self.assertEqual(sum(len(body["documents"]) for body in bodies), 1)
            state = json.loads(self.state.read_text())
            state.pop("scanBegun")
            state["completed"] = False
            bridge.save_state(self.state, state)
            count_before = len(receiver.requests)
            with self.assertRaisesRegex(bridge.BridgeError, "LEGACY_STATE_REQUIRES_OPERATOR_RECOVERY"):
                self.scan(receiver)
            self.assertEqual(len(receiver.requests), count_before)

    def test_recovered_old_begin_ack_revalidates_lease_before_source_read(self):
        (self.root / "contract.pdf").write_bytes(pdf_bytes())
        with Receiver() as receiver:
            def lose_ack(endpoint, payload, token):
                bridge.post_payload(endpoint, payload, token)
                raise bridge.BridgeError("LOST_BEGIN_ACK")
            with mock.patch.object(bridge, "utc_now", return_value="2026-11-13T00:00:01.000Z"):
                with self.assertRaisesRegex(bridge.BridgeError, "LOST_BEGIN_ACK"):
                    self.scan(receiver, sender=lose_ack)
            original = json.loads(self.state.read_text())["pending"]
            # The old begin receipt still replays, but the lease has expired.
            receiver.statuses = [200, 409]
            with mock.patch.object(bridge, "utc_now", return_value="2026-11-13T00:00:02.000Z"), mock.patch.object(bridge.os, "fwalk", side_effect=AssertionError("Expired lease must stop before source enumeration")):
                with self.assertRaisesRegex(bridge.BridgeError, "INGEST_HTTP_409"):
                    self.scan(receiver)
            self.assertEqual(receiver.requests[0]["body"], receiver.requests[1]["body"])
            self.assertNotEqual(receiver.requests[1]["body"], receiver.requests[2]["body"])
            state = json.loads(self.state.read_text())
            self.assertFalse(state["completed"])
            self.assertEqual(state["scanId"], original["scanId"])
            self.assertEqual(state["pending"]["documents"], [])

    def test_ocr_missing_extractor_and_optional_text_are_not_verified_facts(self):
        sample = pdf_bytes(("First synthetic page", "Second synthetic page"))
        self.assertEqual(bridge.extract_preview(sample, False), ("metadata_only", [], False))
        self.assertEqual(bridge.extract_preview(b"not PDF", True), ("unsupported", [], False))
        with mock.patch.object(bridge.shutil, "which", return_value=None):
            self.assertEqual(bridge.extract_preview(sample, True), ("extraction_unavailable", [], False))
        tool = self.folder / "fake-pdftotext"
        tool.write_text("#!/usr/bin/python3\nprint(' \\f ')\n")
        tool.chmod(0o700)
        with mock.patch.object(bridge.shutil, "which", return_value=str(tool)):
            self.assertEqual(bridge.extract_preview(sample, True), ("needs_ocr", [], False))
        tool.write_text("#!/usr/bin/python3\nimport sys\nsys.stdout.write('A' * 30000)\n")
        with mock.patch.object(bridge.shutil, "which", return_value=str(tool)):
            status_code, pages, truncated = bridge.extract_preview(sample, True)
            self.assertEqual(status_code, "text_available")
            self.assertTrue(truncated)
            self.assertLessEqual(sum(len(p["text"].encode()) for p in pages), bridge.MAX_TEXT_BYTES)
        actual = bridge.shutil.which("pdftotext")
        if actual:
            status_code, pages, truncated = bridge.extract_preview(sample, True)
            self.assertEqual(status_code, "text_available")
            self.assertFalse(truncated)
            self.assertEqual([p["page"] for p in pages], [1, 2])
            self.assertIn("First synthetic page", pages[0]["text"])

    def test_native_parser_does_not_inherit_bridge_or_parent_secrets(self):
        tool = self.folder / "private-environment-pdftotext"
        tool.write_text("#!/usr/bin/python3\nimport os\nassert not {'NAS_INGEST_TOKEN', 'DATABASE_URL', 'AUTH_SECRET', 'EXTRA_SYNTHETIC_KEY'}.intersection(os.environ)\nprint('SAFE_PARSER_ENVIRONMENT')\n")
        tool.chmod(0o700)
        with mock.patch.dict(os.environ, {"NAS_INGEST_TOKEN": self.token, "DATABASE_URL": "synthetic-private-value", "AUTH_SECRET": "synthetic-private-auth", "EXTRA_SYNTHETIC_KEY": "synthetic-private-key"}), mock.patch.object(bridge.shutil, "which", return_value=str(tool)):
            status_code, pages, truncated = bridge.extract_preview(pdf_bytes(), True)
        self.assertEqual(status_code, "text_available")
        self.assertFalse(truncated)
        self.assertIn("SAFE_PARSER_ENVIRONMENT", pages[0]["text"])

    def test_cli_logs_only_safe_counts_and_never_source_binary_or_token(self):
        file = self.root / "contract.pdf"
        file.write_bytes(pdf_bytes())
        with Receiver() as receiver, mock.patch.dict(os.environ, {"NAS_INGEST_TOKEN": self.token}):
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                result = bridge.main(["--app-url", receiver.origin, "--source-id", "synthetic-source", "--contract-root", "contracts=" + str(self.root), "--state", str(self.state), "--allow-local-test"])
            self.assertEqual(result, 0)
            self.assertTrue(json.loads(stream.getvalue())["ok"])
            for private in (self.token, str(self.root), "contract.pdf", "%PDF"):
                self.assertNotIn(private, stream.getvalue())
            with self.assertRaisesRegex(bridge.BridgeError, "STATE_CONFIGURATION_CHANGED"):
                bridge.run_scan(receiver.origin, "other-source", self.roots, self.state, self.token, allow_local_test=True)

    @unittest.skipUnless(os.environ.get("NAS_BRIDGE_BACKEND_INTEGRATION") == "true", "Optional local synthetic Prisma/real-route integration")
    def test_real_backend_receipts_unicode_versions_and_lost_final_ack(self):
        # The optional harness wraps the actual Next route in a local HTTP
        # server. Credentials travel only over child-process pipes in memory.
        fixture = r'''
import http from "node:http";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
const identity = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(identity.hostname) || decodeURIComponent(identity.pathname.slice(1)) !== "focus_preview_nas_document_audit" || process.env.APP_ENV !== "ci" || process.env.ALLOW_SYNTHETIC_SEED !== "true" || process.env.PREVIEW_DATASET_ID !== "focus-media-synthetic-v1" || process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("LOCAL_SYNTHETIC_DATABASE_REQUIRED");
const { prisma } = await import("./src/lib/prisma.ts");
const service = await import("./src/lib/document-source-service.ts");
const route = await import("./src/app/api/document-sources/[id]/ingest/route.ts");
const { NextRequest } = await import("next/server.js");
const { clearRateLimit } = await import("./src/lib/security-rate-limit.ts");
const { rateLimitIdentity } = await import("./src/lib/request-security.ts");
const tag = "nas-python-http-" + randomUUID();
let user, source, server, requests = 0, dropped = false, rateIdentity;
try {
  user = await prisma.user.create({ data: { name: tag, email: tag + "@example.invalid", role: "COO", passwordHash: "synthetic-no-login" } });
  const actor = { id: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion, iat: 1, exp: 4000000000 };
  source = await service.createDocumentSource({ label: tag, allowedPathPrefixes: ["contracts"], baseReference: "file://synthetic-nas/contracts/", indexTextEnabled: true }, actor);
  const key = await service.issueDocumentIngestKey({ sourceId: source.id, expectedVersion: 0 }, actor);
  server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 2097152) throw new Error("BODY_LIMIT"); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const request = new NextRequest("http://127.0.0.1" + incoming.url, { method: "POST", headers: { authorization: incoming.headers.authorization || "", "content-type": "application/json", "x-real-ip": tag }, body });
      rateIdentity = rateLimitIdentity(request);
      const response = await route.POST(request, { params: Promise.resolve({ id: source.id }) });
      requests++;
      if (response.ok && JSON.parse(body.toString("utf8")).scanComplete && !dropped) { dropped = true; outgoing.destroy(); return; }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500, { "content-type": "application/json" }); outgoing.end('{"error":"FIXTURE_FAILED"}'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.stdout.write(JSON.stringify({ kind: "ready", origin: "http://127.0.0.1:" + server.address().port, sourceId: source.id, token: key.ingestKey }) + "\n");
  for await (const line of readline.createInterface({ input: process.stdin })) {
    if (line === "close") break;
    if (line === "inspect") {
      const documents = await prisma.sourceDocument.findMany({ where: { sourceId: source.id } });
      const versions = await prisma.sourceDocumentVersion.count({ where: { documentId: { in: documents.map((document) => document.id) } } });
      const batches = await prisma.documentIngestBatch.count({ where: { sourceId: source.id } });
      const current = await prisma.documentAuditSource.findUniqueOrThrow({ where: { id: source.id } });
      process.stdout.write(JSON.stringify({ kind: "inspection", requests, versions, batches, documentCount: documents.length, completed: Boolean(current.lastCompletedScanAt), leaseCleared: current.activeScanId === null, paths: documents.map((document) => document.relativePath) }) + "\n");
    }
  }
} finally {
  process.stdin.destroy();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  if (source) {
    const docs = await prisma.sourceDocument.findMany({ where: { sourceId: source.id }, select: { id: true } });
    await prisma.sourceDocumentVersion.deleteMany({ where: { documentId: { in: docs.map((doc) => doc.id) } } });
    await prisma.sourceDocument.deleteMany({ where: { sourceId: source.id } });
    await prisma.documentIngestBatch.deleteMany({ where: { sourceId: source.id } });
    await prisma.documentAuditSource.delete({ where: { id: source.id } });
  }
  if (rateIdentity) await clearRateLimit("document-source.ingest", rateIdentity);
  if (user) { await prisma.auditLog.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); }
  await prisma.$disconnect();
}
'''
        process = subprocess.Popen(["node", "--env-file=.env.implementation.local", "--import", "tsx", "--input-type=module", "-e", fixture], cwd=Path(__file__).resolve().parent.parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def message(kind):
            import select
            if not select.select([process.stdout], [], [], 30)[0]:
                raise AssertionError("Synthetic backend fixture response timed out")
            line = process.stdout.readline()
            try:
                value = json.loads(line)
            except (ValueError, TypeError):
                raise AssertionError("Synthetic backend fixture did not return its protocol message") from None
            if value.get("kind") != kind:
                raise AssertionError("Synthetic backend fixture returned an unexpected message")
            return value
        try:
            ready = message("ready")
            path = self.root / "Contract Ștefan 💡.pdf"
            path.write_bytes(pdf_bytes(("First synthetic original",)))
            result = bridge.run_scan(ready["origin"], ready["sourceId"], self.roots, self.state, ready["token"], allow_local_test=True)
            self.assertTrue(result["scanComplete"])
            process.stdin.write("inspect\n"); process.stdin.flush()
            first = message("inspection")
            self.assertEqual((first["documentCount"], first["versions"], first["batches"], first["requests"]), (1, 1, 2, 3))
            self.assertTrue(first["completed"] and first["leaseCleared"])
            self.assertEqual(first["paths"], ["contracts/Contract Ștefan 💡.pdf"])
            path.write_bytes(pdf_bytes(("Updated synthetic original",)))
            self.assertTrue(bridge.run_scan(ready["origin"], ready["sourceId"], self.roots, self.state, ready["token"], allow_local_test=True)["scanComplete"])
            process.stdin.write("inspect\n"); process.stdin.flush()
            second = message("inspection")
            self.assertEqual((second["documentCount"], second["versions"], second["batches"]), (1, 2, 4))
            self.assertTrue(second["completed"] and second["leaseCleared"])
            self.assertIsNone(json.loads(self.state.read_text())["pending"])
        finally:
            if process.poll() is None:
                try:
                    process.stdin.write("close\n"); process.stdin.flush()
                    process.stdin.close()
                    process.wait(timeout=20)
                except (OSError, subprocess.TimeoutExpired):
                    process.terminate()
                    process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
        self.assertEqual(process.returncode, 0, "Synthetic backend fixture must clean up successfully")


if __name__ == "__main__":
    unittest.main(verbosity=2)
