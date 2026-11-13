# Authentication remediation

This change closes audit findings SEC-AUTH-002 through SEC-AUTH-006. It does not enable mandatory MFA or change production environment values.

## Login and required enrollment

When `MFA_ENFORCEMENT_MODE=required` applies to a role after `MFA_GRACE_UNTIL`, a user without MFA receives a ten-minute opaque enrollment token after a valid password. The token is stored hashed and authorizes only `/api/auth/mfa/enroll-required` and `/api/auth/mfa/confirm-required`. It cannot be used as an application cookie or access business routes. The application session is created only after proof of the new TOTP secret; recovery codes are displayed once before continuing.

Login and enrollment challenges bind the issuing credential `tokenVersion` and role. Verification and enrollment serialize on the user row. A password reset, role/active change or MFA reset invalidates pending MFA tokens and sessions. A session minted from stale credential state is also rejected. Pre-binding challenges intentionally expire logically at rollout: affected users restart login, without a password or MFA reset.

Existing password-only sessions do not bypass required MFA. They return to login and follow the enrollment or normal MFA flow. A role's grace period still permits normal login until its configured deadline. Preview helpers refuse `VERCEL_ENV=production`, and also refuse an unknown deployment environment when `NODE_ENV=production`.

## Administrative recovery

MFA recovery retains the same protected-target policy as user administration: only SUPER_ADMIN can modify SUPER_ADMIN or D_CEO, and an administrator cannot reset their own MFA through the user registry. Authorized reset requires a reason and explicit identity-verification acknowledgement. The UI disables protected targets and duplicate submission. Removing the credential, incrementing its version, invalidating pending challenges, revoking sessions and recording the recovery audit event commit atomically. Recovery must follow an independent trusted identity check; the acknowledgement records human responsibility rather than claiming that software verified an external identity.

Enrollment/verification, security updates and session creation use fail-closed transactional audit events. All authorized mutation guards also persist a request intent before the domain write. If the audit store is unavailable, the guard returns `503 AUDIT_UNAVAILABLE` before the business command runs. No authentication secrets or recovery codes are included in those events.

## Field notifications

Inbox access uses a dedicated guard that includes the Field operations permission. It does not broaden `requireAdmin`. The notification service continues to filter Field recipients to the authenticated user and refuses changes to other users' notifications.

## Verification and rollout

Run `pnpm run test:auth-remediation` only with the existing synthetic environment guard, a dedicated Preview/CI database and no real email provider. The suite exercises real Prisma persistence and route handlers: enrollment isolation, credential-reset and role invalidation, legacy challenges, concurrent recovery-code consumption, protected MFA resets, Field ownership and audit-store failure. `test:auth-hardening:preview` remains a regression suite for invite, recovery and session behavior.

Before enabling mandatory MFA, enroll the privileged users, save recovery codes securely, test the enrollment and administrative recovery paths on an isolated account, then configure a future grace deadline. This code change does not declare that production enrollment, recovery drill, email delivery or enforcement rollout has been approved or completed.
