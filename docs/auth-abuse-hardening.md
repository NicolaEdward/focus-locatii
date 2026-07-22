# Identity and abuse hardening

## Threat model

The protected surfaces are login, MFA verification, password recovery, invitations, account/session management and the public offer request. Primary threats are distributed credential stuffing, session theft, reset/invite replay, cross-site mutations, public form spam, IDOR on sessions and recovery lockout.

## Architecture

- Existing HMAC session cookies and scrypt password hashes remain canonical.
- New sessions have a server-side revocation record. Old signed cookies remain compatible for their original 12-hour lifetime.
- MySQL is the distributed rate-limit store. It is shared by all Vercel instances and adds no provider subscription. Vercel WAF remains a recommended outer layer for volumetric abuse.
- TOTP uses RFC 6238, SHA-1, six digits, a 30-second step and a maximum drift of one step. A successful time step cannot be replayed.
- TOTP secrets are encrypted with AES-256-GCM. Set a dedicated `AUTH_MFA_ENCRYPTION_KEY`; the `AUTH_SECRET` derivation is compatibility fallback only.
- Recovery codes are shown once and stored only as keyed hashes.
- Invite and reset tokens are random, stored only as hashes, expire and are consumed atomically once.
- Auth email uses the existing Resend configuration and additionally requires `AUTH_EMAIL_DELIVERY_ENABLED=true`. Preview suppresses real delivery.
- Public offers use origin checks, distributed IP/contact limits and a honeypot. No CAPTCHA vendor is required in the first rollout.

## Distributed limits

| Surface | IP limit | Account/object limit |
| --- | ---: | ---: |
| Login | 8 / 15 min | 20 / account / 15 min |
| MFA verify | 20 / 10 min | 10 / challenge / 10 min |
| Password reset request | 12 / hour | 4 / account / hour |
| Password reset confirm | 8 / hour | one-time token |
| Invite accept | 8 / hour | one-time token |
| Public offer request | 8 / 15 min | 4 / contact / hour |
| Admin invite/create/reset | 10-20 / actor / hour | RBAC and audit |

Identifiers are HMAC-hashed before storage. Successful login clears its IP and account counters. Expired rows can be purged as data hygiene; correctness does not depend on that purge.

## MFA rollout

1. Deploy schema and code with `MFA_ENFORCEMENT_MODE=off`.
2. COO and SUPER_ADMIN enroll from `/admin/securitate` and store recovery codes.
3. Verify at least two recoverable SUPER_ADMIN accounts and admin password reset.
4. Set `MFA_ENFORCEMENT_MODE=required`, `MFA_REQUIRED_ROLES=SUPER_ADMIN,COO` and a future `MFA_GRACE_UNTIL`.
5. After grace, monitor `mfa_login_failed`, lockouts and 401/403.

Finance can be added to `MFA_REQUIRED_ROLES` only after its accounts enroll.

## Bootstrap removal and break glass

Runtime bootstrap from `ADMIN_EMAIL`/`ADMIN_PASSWORD` is removed. Do not remove the environment variables until the read-only audit confirms an active SUPER_ADMIN with a successful login. Break glass is the existing SUPER_ADMIN admin reset, protected by RBAC and audit; it is not an environment-password bypass.

## Rollback

Set `MFA_ENFORCEMENT_MODE=off` first if enrollment causes lockout, then roll back the Vercel deployment. The additive tables may remain; the previous application ignores them. Do not drop them during an incident.
