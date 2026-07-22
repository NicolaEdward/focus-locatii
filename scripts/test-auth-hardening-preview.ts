import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { issueAuthActionToken, findUsableAuthActionToken } from "../src/lib/auth-action-tokens";
import { beginMfaEnrollment, confirmMfaEnrollment, generateTotpForStep, issueMfaLoginChallenge, verifyMfaLoginChallenge } from "../src/lib/mfa";
import { consumeRateLimit } from "../src/lib/security-rate-limit";
import { hashPassword } from "../src/lib/auth";
import { createAuthSessionRecord, revokeAuthSession } from "../src/lib/auth-sessions";
import { acceptUserInvite, createUserInvite, requestPasswordReset, resetPasswordWithToken } from "../src/lib/auth-workflows";

async function main() {
  assert.equal(process.env.APP_ENV, "preview", "Integration test only runs in Preview");
  assert.equal(process.env.ALLOW_SYNTHETIC_SEED, "true", "Synthetic Preview gate is required");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `auth-${suffix}@example.invalid`, name: "Synthetic Auth Test", role: "SALES_AGENT", passwordHash: await hashPassword("Synthetic-Auth-Test-123!") } });
  let invitedUserId: string | null = null;
  try {
    const token = await issueAuthActionToken({ type: "PASSWORD_RESET", userId: user.id, ttlSeconds: 60 });
    assert(await findUsableAuthActionToken("PASSWORD_RESET", token.token));

    const identifier = `preview-${suffix}`;
    assert((await consumeRateLimit({ scope: "test.auth", identifier, limit: 2, windowSeconds: 60 })).allowed);
    assert((await consumeRateLimit({ scope: "test.auth", identifier, limit: 2, windowSeconds: 60 })).allowed);
    assert.equal((await consumeRateLimit({ scope: "test.auth", identifier, limit: 2, windowSeconds: 60 })).allowed, false);
    const concurrentIdentifier = `preview-concurrent-${suffix}`;
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => consumeRateLimit({ scope: "test.auth", identifier: concurrentIdentifier, limit: 5, windowSeconds: 60 })));
    assert.equal(concurrent.filter((result) => result.allowed).length, 5, "Exactly the configured number of concurrent attempts must be allowed");

    const enrollment = await beginMfaEnrollment(user, "Synthetic-Auth-Test-123!");
    const step = BigInt(Math.floor(Date.now() / 1000 / 30));
    const recoveryCodes = await confirmMfaEnrollment(user.id, generateTotpForStep(enrollment.secret, step));
    assert.equal(recoveryCodes.length, 10);
    const challenge = await issueMfaLoginChallenge(user.id);
    const futureStep = step + BigInt(1);
    const authenticated = await verifyMfaLoginChallenge(challenge.token, generateTotpForStep(enrollment.secret, futureStep), new Date(Number(futureStep) * 30_000));
    assert.equal(authenticated?.id, user.id);
    const recoveryChallenge = await issueMfaLoginChallenge(user.id);
    assert.equal((await verifyMfaLoginChallenge(recoveryChallenge.token, recoveryCodes[0]))?.id, user.id);
    const replayedRecoveryChallenge = await issueMfaLoginChallenge(user.id);
    await assert.rejects(() => verifyMfaLoginChallenge(replayedRecoveryChallenge.token, recoveryCodes[0]), /nu este valid/);

    const request = new NextRequest("https://preview.focusmedia.test/api/auth/login", { method: "POST", headers: { "user-agent": "Synthetic Browser", "x-forwarded-for": "192.0.2.10" } });
    const session = await createAuthSessionRecord(user.id, request, new Date());
    assert.equal((await revokeAuthSession(user.id, session.id)).count, 1);

    const invitedEmail = `invited-${suffix}@example.invalid`;
    const invite = await createUserInvite({ email: invitedEmail, name: "Synthetic Invited User", role: "SALES_AGENT" }, { id: user.id, role: "SUPER_ADMIN" });
    assert(invite.syntheticLink);
    const inviteToken = new URL(invite.syntheticLink!).searchParams.get("token")!;
    const invited = await acceptUserInvite(inviteToken, "Synthetic-Invited-User-123!");
    invitedUserId = invited.id;
    await assert.rejects(() => acceptUserInvite(inviteToken, "Synthetic-Invited-User-456!"), /invalida|utilizata/);
    const invitedSession = await createAuthSessionRecord(invited.id, request);
    assert.equal((await revokeAuthSession(user.id, invitedSession.id)).count, 0, "A user cannot revoke another user's session");

    const reset = await requestPasswordReset(invitedEmail);
    assert(reset.syntheticLink);
    const resetToken = new URL(reset.syntheticLink!).searchParams.get("token")!;
    await resetPasswordWithToken(resetToken, "Synthetic-Reset-Password-123!");
    await assert.rejects(() => resetPasswordWithToken(resetToken, "Synthetic-Reset-Password-456!"), /invalid|utilizat/);
    const resetSession = await prisma.authSessionRecord.findUnique({ where: { id: invitedSession.id }, select: { revokedAt: true } });
    assert(resetSession?.revokedAt, "Password reset must revoke existing sessions");

    const offersBefore = await prisma.offerRequest.count();
    const { POST: postOffer } = await import("../src/app/api/offer-requests/route");
    const honeypotResponse = await postOffer(new NextRequest("https://preview.focusmedia.test/api/offer-requests", {
      method: "POST",
      headers: { origin: "https://preview.focusmedia.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ website: "spam.invalid" })
    }));
    assert.equal(honeypotResponse.status, 202);
    assert.equal(await prisma.offerRequest.count(), offersBefore, "Honeypot submission must not create an offer request");
    console.log(JSON.stringify({ passed: ["distributed limiter", "one-time token", "MFA enrollment/login/recovery", "session revoke", "invite expiry/replay", "password reset replay/session invalidation"] }, null, 2));
  } finally {
    if (invitedUserId) await prisma.user.deleteMany({ where: { id: invitedUserId } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.securityRateLimit.deleteMany({ where: { scope: "test.auth" } });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
