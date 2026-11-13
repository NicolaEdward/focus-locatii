import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { encryptEvidenceJob, evidenceJobHash, MAX_JOB_BYTES } from "./evidence-job-envelope";

// Local-only packaging. The input is a private, reviewed manifest with source
// paths. The original source bytes are embedded and reparsed by each executor.
if (process.env.VERCEL || process.env.VERCEL_ENV === "production") throw Error("EVIDENCE_PACKAGING_LOCAL_ONLY");
const [manifestPath, encryptedPath, keyPath] = process.argv.slice(2);
if (!manifestPath || !encryptedPath || !keyPath) throw Error("EVIDENCE_PACKAGING_ARGUMENTS");
const input = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(input.sources) || input.sources.length > 8) throw Error("EVIDENCE_SOURCE_LIMIT");
const sources = input.sources.map((source: { sha256: string; fileName: string; companyCode: string; path: string }) => {
  const stat = fs.lstatSync(source.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw Error("EVIDENCE_SOURCE_LIMIT");
  const bytes = fs.readFileSync(source.path);
  if (evidenceJobHash(bytes) !== source.sha256 || path.basename(source.fileName) !== source.fileName) throw Error("EVIDENCE_SOURCE_HASH_MISMATCH");
  return { sha256: source.sha256, fileName: source.fileName, companyCode: source.companyCode, bytesBase64: bytes.toString("base64") };
});
const plaintext = Buffer.from(JSON.stringify({ ...input, sources }));
if (plaintext.length > MAX_JOB_BYTES) throw Error("EVIDENCE_JOB_LIMIT");
const key = crypto.randomBytes(32), manifestHash = evidenceJobHash(plaintext);
fs.mkdirSync(path.dirname(encryptedPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(encryptedPath, JSON.stringify(encryptEvidenceJob(plaintext, key)), { mode: 0o600, flag: "wx" });
fs.writeFileSync(keyPath, JSON.stringify({ key: key.toString("base64"), manifestHash }), { mode: 0o600, flag: "wx" });
key.fill(0);
console.log(JSON.stringify({ event: "evidence_job_packaged", manifestHash, sources: sources.length, operations: input.operations?.length }));
