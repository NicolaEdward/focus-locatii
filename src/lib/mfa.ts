import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authActionTokenHash, findUsableAuthActionToken, issueAuthActionToken } from "@/lib/auth-action-tokens";
import { authSecret, securityHash } from "@/lib/security-secrets";
import type { UserRole } from "@/lib/rbac";
import { verifyPassword } from "@/lib/auth";
import { recordTransactionalAudit } from "@/lib/transactional-audit";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

export async function getMfaStatus(userId: string) {
  const credential = await prisma.authMfaCredential.findUnique({
    where: { userId },
    select: {
      enabledAt: true,
      recoveryCodes: { where: { usedAt: null }, select: { id: true } }
    }
  });
  return {
    enrolled: Boolean(credential?.enabledAt),
    enabledAt: credential?.enabledAt?.toISOString() || null,
    recoveryCodesRemaining: credential?.recoveryCodes.length || 0
  };
}

const mfaUserSelect = { id: true, email: true, name: true, role: true, tokenVersion: true, active: true } as const;
type MfaUser = Prisma.UserGetPayload<{ select: typeof mfaUserSelect }>;
type MfaChallengeType = "MFA_LOGIN" | "MFA_ENROLLMENT";

export class MfaAuthenticationChangedError extends Error {
  constructor() {
    super("Autentificarea a expirat sau datele contului s-au schimbat. Reia autentificarea.");
    this.name = "MfaAuthenticationChangedError";
  }
}

function invalidChallenge(): never {
  throw new MfaAuthenticationChangedError();
}

async function lockMfaUser(tx: Prisma.TransactionClient, userId: string, expectedVersion?: number) {
  // Serialize enrollment/verification with password, role and MFA-reset writes.
  await tx.$queryRaw`SELECT id FROM portfolio_users WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: mfaUserSelect });
  if (!user?.active || expectedVersion !== undefined && user.tokenVersion !== expectedVersion) invalidChallenge();
  return user;
}

function challengeMatchesUser(metadata: Prisma.JsonValue | null, user: MfaUser) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return metadata.credentialVersion === user.tokenVersion && metadata.role === user.role;
}

async function readBoundChallenge(tx: Prisma.TransactionClient, type: MfaChallengeType, token: string, user: MfaUser, now: Date) {
  const challenge = await tx.authActionToken.findFirst({
    where: { type, userId: user.id, tokenHash: authActionTokenHash(type, token), usedAt: null, expiresAt: { gt: now } }
  });
  // Tokens issued before credential-version binding are deliberately rejected.
  if (!challenge || !challengeMatchesUser(challenge.metadata, user)) invalidChallenge();
  return challenge;
}

async function issueMfaChallenge(type: MfaChallengeType, userId: string, expectedVersion?: number) {
  const user = await prisma.user.findFirst({ where: { id: userId, active: true }, select: mfaUserSelect });
  if (!user || expectedVersion !== undefined && user.tokenVersion !== expectedVersion) invalidChallenge();
  return issueAuthActionToken({
    type, userId, ttlSeconds: type === "MFA_LOGIN" ? 5 * 60 : 10 * 60,
    metadata: { credentialVersion: user.tokenVersion, role: user.role }
  });
}

async function prepareEnrollment(tx: Prisma.TransactionClient, user: MfaUser) {
  const existing = await tx.authMfaCredential.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (existing?.enabledAt) throw new Error("MFA este deja activat pentru acest cont.");
  const secret = base32Encode(crypto.randomBytes(20));
  const encrypted = encryptSecret(secret);
  const credential = await tx.authMfaCredential.upsert({
    where: { userId: user.id },
    update: { ...encrypted, enabledAt: null, lastUsedStep: null },
    create: { userId: user.id, ...encrypted }
  });
  await tx.authRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
  await recordTransactionalAudit(tx, { actor: user, action: "auth.mfa.enroll.started", entityType: "user", entityId: user.id });
  const issuer = "Focus Media OOH";
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
  return { secret, uri };
}

async function completeEnrollment(tx: Prisma.TransactionClient, user: MfaUser, code: string, now: Date) {
  const credential = await tx.authMfaCredential.findUnique({ where: { userId: user.id } });
  if (!credential) throw new Error("Porneste mai intai configurarea MFA.");
  if (credential.enabledAt) throw new Error("MFA este deja activat.");
  const step = verifyTotpCode(decryptSecret(credential), code, now, credential.lastUsedStep);
  if (step == null) throw new Error("Codul de verificare nu este valid.");
  const enabled = await tx.authMfaCredential.updateMany({
    where: { id: credential.id, enabledAt: null }, data: { enabledAt: now, lastUsedStep: step }
  });
  if (enabled.count !== 1) throw new Error("Configurarea MFA a fost deja folosita. Reia autentificarea.");
  const recoveryCodes = generateRecoveryCodes();
  await tx.authRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
  await tx.authRecoveryCode.createMany({
    data: recoveryCodes.map((recoveryCode) => ({ credentialId: credential.id, codeHash: recoveryCodeHash(recoveryCode) }))
  });
  await recordTransactionalAudit(tx, { actor: user, action: "auth.mfa.enroll.completed", entityType: "user", entityId: user.id, metadata: { issuedCount: recoveryCodes.length } });
  return recoveryCodes;
}

export async function beginMfaEnrollment(user: { id: string; email: string; tokenVersion?: number }, currentPassword: string) {
  // Verify the password again under the user lock to avoid a password-reset race.
  return prisma.$transaction(async (tx) => {
    const current = await lockMfaUser(tx, user.id, user.tokenVersion);
    const passwordOwner = await tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!passwordOwner || !(await verifyPassword(currentPassword, passwordOwner.passwordHash))) {
      throw new Error("Parola curenta nu este corecta.");
    }
    return prepareEnrollment(tx, current);
  });
}

export async function confirmMfaEnrollment(userId: string, code: string, now = new Date(), expectedVersion?: number) {
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, userId, expectedVersion);
    return completeEnrollment(tx, user, code, now);
  });
}

export async function issueMfaLoginChallenge(userId: string, expectedVersion?: number) {
  return issueMfaChallenge("MFA_LOGIN", userId, expectedVersion);
}

// This opaque token authorizes only enrollment. It is never an application session.
export async function issueMfaEnrollmentChallenge(userId: string, expectedVersion?: number) {
  return issueMfaChallenge("MFA_ENROLLMENT", userId, expectedVersion);
}

export async function beginRequiredMfaEnrollment(enrollmentToken: string) {
  const preliminary = await findUsableAuthActionToken("MFA_ENROLLMENT", enrollmentToken);
  if (!preliminary?.userId) invalidChallenge();
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, preliminary.userId!);
    await readBoundChallenge(tx, "MFA_ENROLLMENT", enrollmentToken, user, new Date());
    return { user, enrollment: await prepareEnrollment(tx, user) };
  });
}

export async function confirmRequiredMfaEnrollment(enrollmentToken: string, code: string, now = new Date()) {
  const preliminary = await findUsableAuthActionToken("MFA_ENROLLMENT", enrollmentToken);
  if (!preliminary?.userId) invalidChallenge();
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, preliminary.userId!);
    const challenge = await readBoundChallenge(tx, "MFA_ENROLLMENT", enrollmentToken, user, now);
    const recoveryCodes = await completeEnrollment(tx, user, code, now);
    const consumed = await tx.authActionToken.updateMany({ where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumed.count !== 1) invalidChallenge();
    return { user, recoveryCodes };
  });
}

export async function verifyMfaLoginChallenge(challengeToken: string, code: string, now = new Date()) {
  if (code.length > 128) throw new Error("Codul MFA nu este valid.");
  const preliminary = await findUsableAuthActionToken("MFA_LOGIN", challengeToken);
  if (!preliminary?.userId) invalidChallenge();
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, preliminary.userId!);
    const challenge = await readBoundChallenge(tx, "MFA_LOGIN", challengeToken, user, now);
    const credential = await tx.authMfaCredential.findUnique({ where: { userId: user.id } });
    if (!credential?.enabledAt) throw new Error("MFA nu este configurat pentru acest cont.");
    const normalizedRecovery = normalizeRecoveryCode(code);
    if (/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(normalizedRecovery)) {
      const consumed = await tx.authRecoveryCode.updateMany({
        where: { credentialId: credential.id, codeHash: recoveryCodeHash(normalizedRecovery), usedAt: null }, data: { usedAt: now }
      });
      if (consumed.count !== 1) throw new Error("Codul de recuperare nu este valid sau a fost deja utilizat.");
    } else {
      const step = verifyTotpCode(decryptSecret(credential), code, now, credential.lastUsedStep);
      if (step == null) throw new Error("Codul de autentificare nu este valid.");
      const consumed = await tx.authMfaCredential.updateMany({
        where: { id: credential.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] }, data: { lastUsedStep: step }
      });
      if (consumed.count !== 1) throw new Error("Codul a fost deja utilizat.");
    }
    const consumedChallenge = await tx.authActionToken.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now }
    });
    // Throw inside the transaction so recovery/TOTP consumption rolls back too.
    if (consumedChallenge.count !== 1) invalidChallenge();
    await recordTransactionalAudit(tx, { actor: user, action: "auth.mfa.challenge.verified", entityType: "user", entityId: user.id, metadata: { method: /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(normalizedRecovery) ? "recovery" : "totp" } });
    return { id: user.id, email: user.email, name: user.name, role: user.role as UserRole, tokenVersion: user.tokenVersion };
  });
}

export { mfaEnrollmentRequired } from "@/lib/mfa-policy";

export function generateTotpForStep(secret: string, step: bigint) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return binary.toString().padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(secret: string, input: string, now = new Date(), lastUsedStep?: bigint | null) {
  const normalized = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const currentStep = BigInt(Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS));
  for (const offset of [BigInt(-1), BigInt(0), BigInt(1)]) {
    const step = currentStep + offset;
    if (lastUsedStep != null && step <= lastUsedStep) continue;
    if (timingSafeCodeEqual(generateTotpForStep(secret, step), normalized)) return step;
  }
  return null;
}

function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    secretCiphertext: ciphertext.toString("base64url"),
    secretIv: iv.toString("base64url"),
    secretTag: cipher.getAuthTag().toString("base64url")
  };
}

function decryptSecret(credential: { secretCiphertext: string; secretIv: string; secretTag: string }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(credential.secretIv, "base64url"));
  decipher.setAuthTag(Buffer.from(credential.secretTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(credential.secretCiphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  return crypto.createHash("sha256").update(process.env.AUTH_MFA_ENCRYPTION_KEY || `${authSecret()}:mfa-encryption`).digest();
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString("hex");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

function recoveryCodeHash(code: string) {
  return securityHash("mfa-recovery", normalizeRecoveryCode(code));
}

function normalizeRecoveryCode(code: string) {
  return code.trim().toLowerCase().replace(/\s/g, "");
}

function timingSafeCodeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base32Encode(value: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function base32Decode(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Secret TOTP invalid.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
