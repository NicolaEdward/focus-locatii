import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authActionTokenHash, findUsableAuthActionToken, issueAuthActionToken } from "@/lib/auth-action-tokens";
import { authSecret, securityHash } from "@/lib/security-secrets";
import type { UserRole } from "@/lib/rbac";
import { verifyPassword } from "@/lib/auth";

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

export async function beginMfaEnrollment(user: { id: string; email: string }, currentPassword: string) {
  const passwordOwner = await prisma.user.findFirst({ where: { id: user.id, active: true }, select: { passwordHash: true } });
  if (!passwordOwner || !(await verifyPassword(currentPassword, passwordOwner.passwordHash))) {
    throw new Error("Parola curenta nu este corecta.");
  }
  const existing = await prisma.authMfaCredential.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (existing?.enabledAt) throw new Error("MFA este deja activat pentru acest cont.");

  const secret = base32Encode(crypto.randomBytes(20));
  const encrypted = encryptSecret(secret);
  await prisma.$transaction(async (tx) => {
    const credential = await tx.authMfaCredential.upsert({
      where: { userId: user.id },
      update: { ...encrypted, enabledAt: null, lastUsedStep: null },
      create: { userId: user.id, ...encrypted }
    });
    await tx.authRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
  });
  const issuer = "Focus Media OOH";
  const label = `${issuer}:${user.email}`;
  const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
  return { secret, uri };
}

export async function confirmMfaEnrollment(userId: string, code: string, now = new Date()) {
  const credential = await prisma.authMfaCredential.findUnique({ where: { userId } });
  if (!credential) throw new Error("Porneste mai intai configurarea MFA.");
  if (credential.enabledAt) throw new Error("MFA este deja activat.");
  const step = verifyTotpCode(decryptSecret(credential), code, now, credential.lastUsedStep);
  if (step == null) throw new Error("Codul de verificare nu este valid.");

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.authMfaCredential.update({
      where: { id: credential.id },
      data: { enabledAt: now, lastUsedStep: step }
    });
    await tx.authRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
    await tx.authRecoveryCode.createMany({
      data: recoveryCodes.map((recoveryCode) => ({
        credentialId: credential.id,
        codeHash: recoveryCodeHash(recoveryCode)
      }))
    });
  });
  return recoveryCodes;
}

export async function issueMfaLoginChallenge(userId: string) {
  return issueAuthActionToken({ type: "MFA_LOGIN", userId, ttlSeconds: 5 * 60 });
}

export async function verifyMfaLoginChallenge(challengeToken: string, code: string, now = new Date()) {
  const challenge = await findUsableAuthActionToken("MFA_LOGIN", challengeToken);
  if (!challenge?.userId) throw new Error("Provocarea MFA a expirat. Reia autentificarea.");
  const credential = await prisma.authMfaCredential.findUnique({ where: { userId: challenge.userId } });
  if (!credential?.enabledAt) throw new Error("MFA nu este configurat pentru acest cont.");

  const normalizedRecovery = normalizeRecoveryCode(code);
  if (/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(normalizedRecovery)) {
    const recovery = await prisma.authRecoveryCode.findUnique({ where: { codeHash: recoveryCodeHash(normalizedRecovery) } });
    if (!recovery || recovery.credentialId !== credential.id || recovery.usedAt) throw new Error("Codul de recuperare nu este valid.");
    const result = await prisma.$transaction(async (tx) => {
      const consumedRecovery = await tx.authRecoveryCode.updateMany({ where: { id: recovery.id, usedAt: null }, data: { usedAt: now } });
      const consumedChallenge = await tx.authActionToken.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      return consumedRecovery.count === 1 && consumedChallenge.count === 1;
    });
    if (!result) throw new Error("Codul a fost deja utilizat.");
  } else {
    const step = verifyTotpCode(decryptSecret(credential), code, now, credential.lastUsedStep);
    if (step == null) throw new Error("Codul de autentificare nu este valid.");
    const result = await prisma.$transaction(async (tx) => {
      const consumedCredential = await tx.authMfaCredential.updateMany({
        where: { id: credential.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
        data: { lastUsedStep: step }
      });
      const consumedChallenge = await tx.authActionToken.updateMany({
        where: { id: challenge.id, tokenHash: authActionTokenHash("MFA_LOGIN", challengeToken), usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      return consumedCredential.count === 1 && consumedChallenge.count === 1;
    });
    if (!result) throw new Error("Codul a fost deja utilizat.");
  }

  const user = await prisma.user.findFirst({
    where: { id: challenge.userId, active: true },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true }
  });
  return user ? { ...user, role: user.role as UserRole } : null;
}

export function mfaEnrollmentRequired(role: UserRole, now = new Date()) {
  if (process.env.MFA_ENFORCEMENT_MODE !== "required") return false;
  const requiredRoles = new Set((process.env.MFA_REQUIRED_ROLES || "SUPER_ADMIN,COO,D_CEO").split(",").map((value) => value.trim()));
  if (!requiredRoles.has(role)) return false;
  const graceUntil = process.env.MFA_GRACE_UNTIL ? new Date(process.env.MFA_GRACE_UNTIL) : null;
  return !graceUntil || Number.isNaN(graceUntil.getTime()) || graceUntil <= now;
}

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
