export const ONBOARDING_LOGIN_HREF = "/admin/login?next=%2Fadmin%2Fonboarding";

/** Root login accepts one exact local destination; it never accepts a callback URL. */
export function onboardingLoginTarget(value: unknown): "/admin/onboarding" | undefined {
  return value === "/admin/onboarding" ? "/admin/onboarding" : undefined;
}

/** OAuth continuation is supplied only by the already validated consent page. */
export function safeLoginContinuation(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\\\r\n]/.test(value)) return undefined;
  if (onboardingLoginTarget(value)) return value;
  return value.startsWith("/oauth/authorize?") ? value : undefined;
}
