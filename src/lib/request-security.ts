import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { securityHash } from "@/lib/security-secrets";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function mutationRequestError(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (fetchSite === "cross-site") return forbiddenOrigin();
  if (!origin) {
    if (!fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") return null;
    return forbiddenOrigin();
  }

  try {
    const originUrl = new URL(origin);
    if (trustedOrigins(request).has(originUrl.origin)) return null;
  } catch {
    // Invalid origins are rejected below.
  }
  return forbiddenOrigin();
}

export function requestIpHash(request: NextRequest) {
  return securityHash("ip", clientIp(request));
}

export function rateLimitIdentity(request: NextRequest, secondary?: string | null) {
  return securityHash("rate-limit", `${clientIp(request)}:${String(secondary || "").trim().toLowerCase()}`);
}

export function rateLimitSubject(value: string) {
  return securityHash("rate-limit-subject", value.trim().toLowerCase());
}

export function safeUserAgent(request: NextRequest) {
  return String(request.headers.get("user-agent") || "unknown").slice(0, 500);
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

function trustedOrigins(request: NextRequest) {
  const values = new Set<string>([request.nextUrl.origin]);
  for (const candidate of [process.env.NEXT_PUBLIC_BASE_URL, ...(process.env.AUTH_TRUSTED_ORIGINS || "").split(",")]) {
    if (!candidate?.trim()) continue;
    try {
      values.add(new URL(candidate.trim()).origin);
    } catch {
      // Misconfigured optional origins are ignored; the current host remains trusted.
    }
  }
  return values;
}

function forbiddenOrigin() {
  return NextResponse.json({ error: "Origine nepermisa." }, { status: 403 });
}
