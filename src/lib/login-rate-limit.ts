import type { NextRequest } from "next/server";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const globalRateLimit = globalThis as typeof globalThis & {
  focusLoginAttempts?: Map<string, { count: number; resetAt: number }>;
};
const attempts = globalRateLimit.focusLoginAttempts || new Map<string, { count: number; resetAt: number }>();
globalRateLimit.focusLoginAttempts = attempts;

export function loginRateLimit(request: NextRequest) {
  const key = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  return {
    allowed: current.count < MAX_ATTEMPTS,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

export function recordLoginFailure(request: NextRequest) {
  const key = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const now = Date.now();
  const current = attempts.get(key);
  attempts.set(key, current && current.resetAt > now
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: now + WINDOW_MS });
}

export function clearLoginFailures(request: NextRequest) {
  const key = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  attempts.delete(key);
}
