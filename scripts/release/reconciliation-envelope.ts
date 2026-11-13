import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const EXPORT_EVENT = "reconciliation_export_envelope";
export const MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024;
const CHUNK_CHARS = 2400;
type Environment = Record<string, string | undefined>;
export class ExportFailure extends Error { constructor(readonly code: string) { super(code); } }
function fail(code: string): never { throw new ExportFailure(code); }

export function assertExportTarget(env: Environment) {
  if (env.ALLOW_PRODUCTION_RECONCILIATION_EXPORT !== "true") fail("EXPORT_NOT_ENABLED");
  let url: URL;
  try { url = new URL(env.DATABASE_URL || ""); } catch { return fail("EXPORT_TARGET_INVALID"); }
  if (url.protocol !== "mysql:" || !url.hostname || !url.pathname.slice(1)) fail("EXPORT_TARGET_INVALID");
  const endpoint = `${url.protocol}//${url.hostname}:${url.port || "default"}/${decodeURIComponent(url.pathname.slice(1))}`;
  const fingerprint = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
  if (!/^[a-f0-9]{12}$/.test(env.RECONCILIATION_DATABASE_FINGERPRINT || "") || env.RECONCILIATION_DATABASE_FINGERPRINT !== fingerprint) fail("EXPORT_TARGET_NOT_APPROVED");
  return fingerprint;
}

function publicKey(value: string | undefined) {
  try {
    if (!value || value.length > 16_384 || value.includes("PRIVATE KEY")) fail("EXPORT_PUBLIC_KEY_INVALID");
    const key = crypto.createPublicKey(value.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength || 0) < 3072) fail("EXPORT_PUBLIC_KEY_INVALID");
    return key;
  } catch { return fail("EXPORT_PUBLIC_KEY_INVALID"); }
}

export function validateExportPublicKey(value: string | undefined) { publicKey(value); }

export function encryptExport(payload: unknown, pem: string, databaseFingerprint: string) {
  const recipient = publicKey(pem);
  const bytes = Buffer.from(JSON.stringify(payload));
  if (bytes.length > MAX_PLAINTEXT_BYTES) fail("EXPORT_PAYLOAD_LIMIT");
  const zipped = gzipSync(bytes);
  if (zipped.length > MAX_CIPHERTEXT_BYTES) fail("EXPORT_PAYLOAD_LIMIT");
  const aad = {
    version: 1, runId: crypto.randomUUID(), databaseFingerprint,
    keyFingerprint: crypto.createHash("sha256").update(recipient.export({ type: "spki", format: "der" })).digest("hex"),
    generatedAt: new Date().toISOString(), algorithm: "RSA-OAEP-SHA256+A256GCM", compression: "gzip"
  };
  const key = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  const ciphertext = Buffer.concat([cipher.update(zipped), cipher.final()]);
  const encoded = ciphertext.toString("base64");
  const chunks = Math.ceil(encoded.length / CHUNK_CHARS);
  const header = {
    event: EXPORT_EVENT, type: "begin", ...aad, chunks,
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    wrappedKey: crypto.publicEncrypt({ key: recipient, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key).toString("base64"),
    ciphertextSha256: crypto.createHash("sha256").update(ciphertext).digest("hex")
  };
  key.fill(0);
  const lines = [JSON.stringify(header)];
  for (let index = 0; index < chunks; index++) lines.push(JSON.stringify({ event: EXPORT_EVENT, type: "chunk", runId: aad.runId, index, data: encoded.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) }));
  lines.push(JSON.stringify({ event: EXPORT_EVENT, type: "end", runId: aad.runId, chunks, ciphertextSha256: header.ciphertextSha256 }));
  if (lines.some(line => Buffer.byteLength(line) >= 3000)) fail("EXPORT_LINE_LIMIT");
  return lines;
}

export function decryptExport(lines: string[], privatePem: string, selectedRunId?: string) {
  try {
    const records = lines.flatMap(line => {
      if (!line.trim()) return [];
      let record: any;
      try { record = JSON.parse(line); } catch { return []; }
      return record?.event === EXPORT_EVENT ? [record] : [];
    });
    const headers = records.filter(r => r.type === "begin" && (!selectedRunId || r.runId === selectedRunId));
    if (headers.length !== 1) fail("EXPORT_ENVELOPE_AMBIGUOUS");
    const h = headers[0];
    if (h.version !== 1 || h.algorithm !== "RSA-OAEP-SHA256+A256GCM" || h.compression !== "gzip" || !Number.isSafeInteger(h.chunks) || h.chunks < 1 || h.chunks > 10_000) fail("EXPORT_ENVELOPE_INVALID");
    const parts = records.filter(r => r.type === "chunk" && r.runId === h.runId).sort((a,b) => a.index - b.index);
    const endings = records.filter(r => r.type === "end" && r.runId === h.runId);
    if (endings.length !== 1 || endings[0].chunks !== h.chunks || endings[0].ciphertextSha256 !== h.ciphertextSha256 || parts.length !== h.chunks) fail("EXPORT_ENVELOPE_INCOMPLETE");
    if (parts.some((p, index) => p.index !== index || typeof p.data !== "string" || p.data.length > CHUNK_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))) fail("EXPORT_ENVELOPE_INVALID");
    const ciphertext = Buffer.from(parts.map(p=>p.data).join(""), "base64");
    if (ciphertext.length > MAX_CIPHERTEXT_BYTES || crypto.createHash("sha256").update(ciphertext).digest("hex") !== h.ciphertextSha256) fail("EXPORT_ENVELOPE_INVALID");
    const recipient = crypto.createPrivateKey(privatePem);
    const recipientPublic = crypto.createPublicKey(recipient);
    if (crypto.createHash("sha256").update(recipientPublic.export({type:"spki",format:"der"})).digest("hex") !== h.keyFingerprint) fail("EXPORT_RECIPIENT_MISMATCH");
    const key = crypto.privateDecrypt({key:recipient,oaepHash:"sha256",padding:crypto.constants.RSA_PKCS1_OAEP_PADDING}, Buffer.from(h.wrappedKey,"base64"));
    const iv = Buffer.from(h.iv, "base64"), tag = Buffer.from(h.tag, "base64");
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) fail("EXPORT_ENVELOPE_INVALID");
    const {version,runId,databaseFingerprint,keyFingerprint,generatedAt,algorithm,compression} = h;
    const decipher = crypto.createDecipheriv("aes-256-gcm",key,iv);
    decipher.setAAD(Buffer.from(JSON.stringify({version,runId,databaseFingerprint,keyFingerprint,generatedAt,algorithm,compression})));
    decipher.setAuthTag(tag);
    const zipped = Buffer.concat([decipher.update(ciphertext),decipher.final()]); key.fill(0);
    return JSON.parse(gunzipSync(zipped,{maxOutputLength:MAX_PLAINTEXT_BYTES}).toString("utf8"));
  } catch (error) { if (error instanceof ExportFailure) throw error; return fail("EXPORT_DECRYPTION_FAILED"); }
}
