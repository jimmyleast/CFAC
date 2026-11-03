# Runbook: Sign-in / Onboarding

## How staff get in

- **Password Sign In** — existing accounts with a password.
- **Email Sign-In Link** (login page tab) — the primary onboarding path. Posts to
  `POST /api/auth/magic-link`, which enforces the staff-domain allowlist
  (`lib/auth/allowlist.ts`, default `@cfacbentonco.com` + admins), auto-provisions a
  confirmed account for new allowed staff, and emails the link **via Resend** (not
  Supabase's built-in mailer).
- **Admin invite** — Admin → People → Invite (also Resend-backed).

## If nobody can sign up / receive links (2 AM checklist)

The magic-link path depends on these Railway env vars — if any are missing, every new
user is locked out:

| Symptom | Cause |
|---|---|
| 500 "Server auth is not configured." | `SUPABASE_SERVICE_ROLE_KEY` missing |
| 500 "Email delivery is not configured." | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` missing |
| 503 email-disabled JSON | `ENABLE_EMAIL_SENDING=false` set (kill switch) |
| 403 "isn't permitted to sign in" | address off-domain, or `ALLOWED_EMAIL_DOMAINS` misconfigured |
| 429 "Too many requests" | per-IP/global limiter (`lib/auth/ratelimit.ts`, 5 per IP / 60 global per 15 min, per instance) |

Watch `app_events` for `auth.magic_link.failed` (the `status` column carries the cause
class above), `auth.magic_link.sent`, and `auth.magic_link.user_created` (audit trail
for every auto-provisioned account).

## Allowlist enforcement (server-side)

The allowlist is enforced at three independent points — a non-allowed email cannot get
a usable session even with valid credentials:

1. `POST /api/auth/magic-link` and `POST /api/auth/reset-password` — before any link is minted.
2. `POST /api/auth/login` — valid off-domain credentials are signed out and get a generic 401.
3. `lib/auth/requestUser.ts` (`getRequestAuth`) — every authenticated API request; an
   off-domain session is treated as unauthenticated regardless of how it was created.

## Operator settings (Supabase dashboard)

- **Authentication → Sign In / Up → "Allow new users to sign up" should be OFF.**
  The app provisions accounts through the service-role admin API (magic-link + admin
  invite), which is unaffected by this toggle. Leaving it on allows direct anon-API
  signups that bypass the app entirely.
- Legacy accounts stuck "unconfirmed" by the old Sign Up tab: the user can self-fix via
  the Email Sign-In Link tab, or an admin can confirm them under Authentication → Users.
