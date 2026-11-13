import type { UserRole } from "@/lib/rbac";

// This only evaluates the configured policy. Enabling enforcement is a separate
// rollout decision, after enrollment and recovery have been verified.
export function mfaEnrollmentRequired(role: UserRole, now = new Date()) {
  if (process.env.MFA_ENFORCEMENT_MODE !== "required") return false;
  const requiredRoles = new Set((process.env.MFA_REQUIRED_ROLES || "SUPER_ADMIN,COO,D_CEO").split(",").map((value) => value.trim()));
  if (!requiredRoles.has(role)) return false;
  const graceUntil = process.env.MFA_GRACE_UNTIL ? new Date(process.env.MFA_GRACE_UNTIL) : null;
  return !graceUntil || Number.isNaN(graceUntil.getTime()) || graceUntil <= now;
}
