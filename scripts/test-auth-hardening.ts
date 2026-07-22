import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { generateTotpForStep, verifyTotpCode } from "../src/lib/mfa";
import { mutationRequestError, rateLimitSubject } from "../src/lib/request-security";
import { rateLimitKey } from "../src/lib/security-rate-limit";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
assert.equal(generateTotpForStep(rfcSecret, BigInt(1)), "287082", "RFC 6238 SHA-1 vector must match the six-digit suffix");
const time = new Date(59_000);
const acceptedStep = verifyTotpCode(rfcSecret, "287082", time);
assert.equal(acceptedStep, BigInt(1), "Current TOTP must be accepted");
assert.equal(verifyTotpCode(rfcSecret, "287082", time, acceptedStep), null, "A successful TOTP cannot be replayed");
assert.equal(verifyTotpCode(rfcSecret, "999999", time), null, "An invalid TOTP must be rejected");

const sameOrigin = new NextRequest("https://locatii.focusmedia.ro/api/test", { method: "POST", headers: { origin: "https://locatii.focusmedia.ro", "sec-fetch-site": "same-origin" } });
const crossOrigin = new NextRequest("https://locatii.focusmedia.ro/api/test", { method: "POST", headers: { origin: "https://evil.invalid", "sec-fetch-site": "cross-site" } });
const serverClient = new NextRequest("https://locatii.focusmedia.ro/api/test", { method: "POST" });
assert.equal(mutationRequestError(sameOrigin), null, "Same-origin mutation must be accepted");
assert.equal(mutationRequestError(serverClient), null, "Legitimate server clients without browser Origin remain compatible");
assert.equal(mutationRequestError(crossOrigin)?.status, 403, "Cross-site browser mutation must be rejected");

const rateKey = rateLimitKey("login", "sensitive-value");
assert.equal(rateKey.length, 64);
assert(!rateKey.includes("sensitive-value"), "Rate-limit storage key must not expose its identifier");
assert.equal(rateLimitSubject("User@Example.com"), rateLimitSubject(" user@example.com "), "Subject limits must normalize account identifiers");

const authSource = read("src/lib/auth.ts");
assert(!authSource.includes("ADMIN_PASSWORD"), "Runtime login must not retain bootstrap password access");
assert(!authSource.includes("legacyAdminMatches"), "Legacy bootstrap path must be removed");
assert(read("src/app/api/offer-requests/route.ts").includes("public_offer_honeypot_triggered"), "Public offer route must have honeypot protection");
assert(read("src/app/api/auth/login/route.ts").includes("consumeRateLimit"), "Login must use the distributed limiter");
assert(read("src/app/api/auth/login/route.ts").includes("auth.login.account"), "Login must limit the account independently from IP");
assert(read("src/app/api/auth/mfa/verify-login/route.ts").includes("auth.mfa.verify.challenge"), "MFA must limit a challenge independently from IP");
assert(read("src/lib/mfa.ts").includes("aes-256-gcm"), "TOTP secrets must be encrypted at rest");
assert(!read("src/lib/mfa.ts").includes("console.log"), "MFA service must not log secrets or codes");

console.log(JSON.stringify({ passed: ["TOTP vector and replay", "Origin/CSRF", "hashed rate-limit keys", "bootstrap removal", "offer abuse", "MFA secret encryption"] }, null, 2));
