import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { databaseConnectionUrl } from "../src/lib/database-connection-policy";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-test-ca-"));
let generated: string | undefined;
try {
  const remote = new URL(databaseConnectionUrl("mysql://synthetic:unused@db.example.invalid/test?sslaccept=accept_invalid_certs", "")!);
  assert.equal(remote.searchParams.get("sslaccept"), "strict");
  assert.equal(new URL(databaseConnectionUrl("mysql://synthetic:unused@localhost.evil.invalid/test", "")!).searchParams.get("sslaccept"), "strict");
  assert.equal(new URL(databaseConnectionUrl("mysql://root:unused@127.0.0.1/test", "")!).searchParams.has("sslaccept"), false);
  assert.throws(() => databaseConnectionUrl("mysql://u:p@db.invalid/test", "PRIVATE KEY"), /DATABASE_CA_INVALID/);
  assert.throws(() => databaseConnectionUrl("invalid", ""), /DATABASE_CONFIGURATION_INVALID/);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Synthetic Database CA", "-addext", "basicConstraints=critical,CA:TRUE", "-days", "1", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "ca.pem")], { stdio: "ignore" });
  const pem = fs.readFileSync(path.join(dir, "ca.pem"), "utf8");
  const secured = new URL(databaseConnectionUrl("mysql://u:p@db.invalid/test?sslaccept=accept_invalid_certs", pem)!);
  generated = secured.searchParams.get("sslcert")!;
  assert.equal(secured.searchParams.get("sslaccept"), "strict");
  assert.equal(fs.readFileSync(generated, "utf8"), pem);
  assert.equal(fs.statSync(generated).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(generated)).mode & 0o777, 0o700);
  assert.equal(new URL(databaseConnectionUrl("mysql://u:p@db.invalid/test", pem)!).searchParams.get("sslcert"), generated);
  console.log("Database TLS policy passed: legacy bypass overridden, exact loopback exception, invalid CA refusal and private provider-CA file");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  if (generated) fs.rmSync(path.dirname(generated), { recursive: true, force: true });
}
