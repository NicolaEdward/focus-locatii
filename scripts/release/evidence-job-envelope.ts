import crypto from "node:crypto";

const aad = Buffer.from("focus-evidence-reconciliation-job-v1");
export const MAX_JOB_BYTES = 24 * 1024 * 1024;
export const evidenceJobHash = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");

/** The encrypted file may enter a private build; its key never enters Git or logs. */
export function encryptEvidenceJob(payload: Buffer, key: Buffer) {
  if (key.length !== 32 || payload.length > MAX_JOB_BYTES) throw Error("EVIDENCE_JOB_LIMIT");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptEvidenceJob(raw: unknown, keyValue: string | undefined, expectedHash: string | undefined) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("EVIDENCE_JOB_ENVELOPE_INVALID");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || Object.keys(value).sort().join() !== "ciphertext,iv,tag,version" ||
      ![value.iv, value.tag, value.ciphertext].every(item => typeof item === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(item))) throw Error("EVIDENCE_JOB_ENVELOPE_INVALID");
  if (!keyValue || !/^[A-Za-z0-9+/]{43}=$/.test(keyValue) || !/^[a-f0-9]{64}$/.test(expectedHash || "")) throw Error("EVIDENCE_JOB_KEY_OR_HASH_REQUIRED");
  const key = Buffer.from(keyValue, "base64"), iv = Buffer.from(value.iv as string, "base64"), tag = Buffer.from(value.tag as string, "base64");
  const ciphertext = Buffer.from(value.ciphertext as string, "base64");
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_JOB_BYTES) throw Error("EVIDENCE_JOB_ENVELOPE_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad); decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  key.fill(0);
  if (plaintext.length > MAX_JOB_BYTES || evidenceJobHash(plaintext) !== expectedHash) throw Error("EVIDENCE_JOB_HASH_MISMATCH");
  return JSON.parse(plaintext.toString("utf8"));
}
