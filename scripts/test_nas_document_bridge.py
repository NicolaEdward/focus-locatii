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
import tempfile
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

SPEC = importlib.util.spec_from_file_location("nas_bridge", Path(__file__).with_name("nas_document_bridge.py"))
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class Receiver:
    def __init__(self, statuses=None, redirect=False):
        self.requests = []
        self.statuses = list(statuses or [200])
        self.redirect = redirect
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                owner.requests.append({"path": self.path, "body": body, "authorization": self.headers.get("Authorization")})
                status_code = owner.statuses.pop(0) if owner.statuses else 200
                self.send_response(status_code)
                if owner.redirect:
                    self.send_header("Location", "/redirected")
                self.send_header("Content-Type", "application/json")
                if status_code == 429:
                    self.send_header("Retry-After", "120")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

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

    def test_metadata_only_private_state_no_binary_or_token(self):
        file = self.root / "contract.pdf"
        original = b"%PDF-1.7\nRaw private binary " + self.token.encode() + b"\x00\xff\n"
        file.write_bytes(original)
        before = file.stat()
        with Receiver() as receiver:
            result = self.scan(receiver)
            self.assertTrue(result["scanComplete"])
            self.assertEqual(len(receiver.requests), 1)
            raw = receiver.requests[0]["body"]
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
            body = json.loads(receiver.requests[0]["body"])
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
            self.assertEqual(receiver.requests[0]["body"], attempts[0])
            self.assertNotEqual(json.loads(receiver.requests[0]["body"])["documents"][0]["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())
            self.scan(receiver)
            self.assertNotEqual(receiver.requests[1]["body"], attempts[0])
            self.assertEqual(json.loads(receiver.requests[1]["body"])["documents"][0]["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())

    def test_batches_and_network_error_are_not_swallowed_as_file_errors(self):
        for index in range(52):
            (self.root / f"contract-{index:02}.pdf").write_bytes(pdf_bytes((f"Invoice {index}",)))
        attempts = []
        def failed(_endpoint, payload, _token):
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
            self.assertEqual(receiver.requests[0]["body"], attempts[0])
            self.assertEqual([len(json.loads(r["body"])["documents"]) for r in receiver.requests], [50, 2])
            self.assertTrue(json.loads(receiver.requests[-1]["body"])["scanComplete"])
            self.assertEqual(len(json.loads(self.state.read_text())["sent"]), 52)

    def test_http_retry_and_redirect_no_credential_forward(self):
        payload = bridge.payload_for("source", "scan", [], True)
        with Receiver([503, 200]) as receiver:
            delays = []
            bridge.post_payload(receiver.origin + "/receive", payload, self.token, sleeper=delays.append)
            self.assertEqual(len(receiver.requests), 2)
            self.assertEqual(receiver.requests[0]["body"], receiver.requests[1]["body"])
            self.assertEqual(len(delays), 1)
        with Receiver([302], redirect=True) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "INGEST_HTTP_302"):
                bridge.post_payload(receiver.origin + "/receive", payload, self.token)
            self.assertEqual(len(receiver.requests), 1)
        with Receiver([429]) as receiver:
            with self.assertRaisesRegex(bridge.BridgeError, "RETRY_LATER"):
                bridge.post_payload(receiver.origin + "/receive", payload, self.token, sleeper=lambda _: self.fail("long Retry-After must not sleep"))

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
