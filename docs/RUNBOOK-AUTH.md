# Runbook: Sign-in / Onboarding

## How staff get in

- **Sign In** — email + password.
- **Create Account** (login page tab) — self-service, **no email verification**. Posts to
  `POST /api/auth/register`, which enforces the staff allowlist
  (`lib/auth/allowlist.ts`, default `@cfacbentonco.com`), creates an already
  confirmed account with the chosen password (min 10 chars), and signs the user in.
  **Admin addresses (`ADMIN_EMAILS` + built-ins) are refused here** — create those in
  Supabase → Authentication → Users → Add user (Auto Confirm User) instead. An existing
  *confirmed* account is never overwritten (409); a never-confirmed leftover from the
  old Sign Up tab is adopted (password set + confirmed).
- **Admin invite** — Admin → People → Invite (Resend-backed; needs a verified sender domain).

**Trade-off to know:** because no email is verified, anyone who knows an allowed address
that has not registered yet could register it first. Server-enforced MFA (enrolled at
first sign-in) and the allowlist limit the blast radius; register new staff promptly.

## If nobody can create an account (2 AM checklist)

| Symptom | Cause |
|---|---|
| 500 "Server auth is not configured." | `SUPABASE_SERVICE_ROLE_KEY` missing |
| 403 "isn't permitted to sign up" | address off-domain, or `ALLOWED_EMAIL_DOMAINS` misconfigured |
| 409 "An account already exists" | confirmed account exists — use Sign In, or have an admin reset the password in Supabase → Authentication → Users |
| 429 "Too many requests" | per-IP/global limiter (`lib/auth/ratelimit.ts`, 5 per IP / 60 global per 15 min, per instance) |

Watch `app_events` for `auth.register.failed` (the `status` column carries the cause)
and `auth.register.created` (audit trail for every account created).

"Forgot password?" no longer exists — the app sends **no** self-service emails. Reset a
password in Supabase → Authentication → Users → (user) → Send/Update password, or delete
the user so they can re-register via Create Account. (Admin → People → Invite is the only
remaining email feature and is admin-initiated.)

## Allowlist enforcement (server-side)

The allowlist is enforced at three independent points — a non-allowed email cannot get
a usable session even with valid credentials:

1. `POST /api/auth/register` — before any account is created.
2. `POST /api/auth/login` — valid off-domain credentials are signed out and get a generic 401.
3. `lib/auth/requestUser.ts` (`getRequestAuth`) — every authenticated API request; an
   off-domain session is treated as unauthenticated regardless of how it was created.

## Operator settings (Supabase dashboard)

- **Authentication → Sign In / Up → "Allow new users to sign up" should be OFF.**
  The app provisions accounts through the service-role admin API (register + admin
  invite), which is unaffected by this toggle. Leaving it on allows direct anon-API
  signups that bypass the app (and the allowlist) entirely.
