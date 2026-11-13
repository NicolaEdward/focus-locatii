import crypto from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

export function databaseFingerprint(value = process.env.DATABASE_URL): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return crypto.createHash("sha256").update(`${u.protocol}//${u.hostname}:${u.port || "default"}/${decodeURIComponent(u.pathname.slice(1))}`).digest("hex").slice(0, 12);
  } catch { return null; }
}

export type VerifiedRestoreReceipt = {
  version: 1; action: "restore_verification"; ok: true; verifiedAt: string;
  sourceFingerprint: string; targetFingerprint: string; encryptedSha256: string;
  durationMs: number; tableCount: number;
};

function signedBody(input: unknown): Record<string, unknown> {
  const secret = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || "", "base64");
  if (secret.length !== 32) throw new Error("Verificarea backupului necesita configurarea cheii dedicate de recuperare.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Chitanta de restaurare nu este valida.");
  const { signature, ...body } = input as Record<string, unknown>;
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new Error("Semnatura chitantei lipseste.");
  const expected = crypto.createHmac("sha256", Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), Buffer.from("focus-backup-receipt-v1"), 32))).update(canonical(body)).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Semnatura chitantei nu corespunde.");
  return body;
}

export function verifyRestoreReceipt(input: unknown, source = databaseFingerprint()): VerifiedRestoreReceipt {
  const body = signedBody(input);
  if (body.version !== 1 || body.action !== "restore_verification" || body.ok !== true || body.sourceFingerprint !== source || body.targetFingerprint === source) throw new Error("Restaurarea trebuie verificata separat si trebuie sa corespunda acestei baze de date.");
  if (typeof body.verifiedAt !== "string" || !Number.isFinite(Date.parse(body.verifiedAt)) || Date.parse(body.verifiedAt) > Date.now() + 300000) throw new Error("Data verificarii nu este valida.");
  if (typeof body.encryptedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.encryptedSha256) || typeof body.targetFingerprint !== "string" || !/^[a-f0-9]{12}$/.test(body.targetFingerprint)) throw new Error("Identitatea backupului nu este valida.");
  if (!body.tables || typeof body.tables !== "object" || Array.isArray(body.tables) || !Object.keys(body.tables).length) throw new Error("Chitanta nu contine verificarea tabelelor.");
  for (const v of Object.values(body.tables)) {
    if (!v || typeof v !== "object" || !("count" in v) || !Number.isSafeInteger(v.count) || Number(v.count) < 0 || !("hash" in v) || typeof v.hash !== "string" || !/^[a-f0-9]{64}$/.test(v.hash)) throw new Error("Checksum-ul unui tabel nu este valid.");
  }
  if (typeof body.durationMs !== "number" || !Number.isSafeInteger(body.durationMs) || body.durationMs < 0) throw new Error("Durata restaurarii nu este valida.");
  return { version: 1, action: "restore_verification", ok: true, verifiedAt: body.verifiedAt, sourceFingerprint: body.sourceFingerprint as string, targetFingerprint: body.targetFingerprint, encryptedSha256: body.encryptedSha256, durationMs: body.durationMs, tableCount: Object.keys(body.tables).length };
}

export function verifyBackupReceipt(input: unknown, source = databaseFingerprint()) {
  const body = signedBody(input);
  if (body.version !== 1 || body.action !== "backup" || body.ok !== true || body.sourceFingerprint !== source) throw new Error("Chitanta nu corespunde unui backup al acestei baze.");
  if (typeof body.createdAt !== "string" || !Number.isFinite(Date.parse(body.createdAt)) || Date.parse(body.createdAt) > Date.now() + 300000) throw new Error("Data backupului nu este valida.");
  if (typeof body.encryptedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.encryptedSha256) || !body.tables || typeof body.tables !== "object" || Array.isArray(body.tables) || !Object.keys(body.tables).length) throw new Error("Manifestul backupului nu este valid.");
  for (const row of Object.values(body.tables)) {
    if (!row || typeof row !== "object" || !("count" in row) || !Number.isSafeInteger(row.count) || Number(row.count) < 0 || !("hash" in row) || typeof row.hash !== "string" || !/^[a-f0-9]{64}$/.test(row.hash)) throw new Error("Checksum invalid.");
  }
  return { version: 1, action: "backup", createdAt: body.createdAt, sourceFingerprint: body.sourceFingerprint as string, encryptedSha256: body.encryptedSha256, tableCount: Object.keys(body.tables).length };
}
