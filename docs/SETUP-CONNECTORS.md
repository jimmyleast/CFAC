# Connector Setup — what Jimmy registers (the data-pulling unlock)

Each connector needs a vendor-side app registration that only an account owner can do. Do these once; paste the resulting IDs/secrets into Railway (server-side env, never the browser bundle — these are NOT `NEXT_PUBLIC_`). The platform's broker handles the rest. Start with #1 (Microsoft) — it unlocks the spreadsheets, email intake, and staff SSO from a single registration.

> Security: every value below is a server-only secret. Add to Railway as a normal variable (not `NEXT_PUBLIC_*`). Rotate on a schedule. Never commit.

---

## 1. Microsoft Entra ID — the wedge (SharePoint sheets + email + SSO)

This single app registration unlocks the 12 reporting spreadsheets, the encrypted-email intake mailbox, and (later) staff single-sign-on. **You need Global Administrator (or Application Administrator) on the CFAC M365 tenant.**

**A. Register the app**
1. Go to **entra.microsoft.com** → **Identity → Applications → App registrations → + New registration**.
2. Name: `CFAC Data Platform`.
3. Supported account types: **Single tenant** (Accounts in this org directory only).
4. Redirect URI: **Web** → `https://cfac-production.up.railway.app/api/connect/microsoft/callback` (we'll confirm the exact path when the broker ships).
5. **Register.** Copy the **Application (client) ID** and **Directory (tenant) ID** → these become `MS_CLIENT_ID` and `MS_TENANT_ID`.

**B. Add a certificate (preferred) or secret**
- Simplest to start: **Certificates & secrets → + New client secret** → 24-month expiry → copy the **Value** immediately → `MS_CLIENT_SECRET`. (We'll move to a certificate before any PHI — more secure, per the architecture doc.)

**C. Grant least-privilege application permissions**
1. **API permissions → + Add a permission → Microsoft Graph → Application permissions**.
2. Add: **`Sites.Selected`** (NOT `Sites.Read.All` — least privilege), **`Mail.Read`** (for the intake mailbox).
3. **Grant admin consent for CFAC** (the button at the top). All three should show green "Granted."

**D. Grant the app access to ONLY the reporting SharePoint site**
- `Sites.Selected` gives zero access until you grant a specific site. Tell me the SharePoint **site URL** that holds the 12 spreadsheets and the **shared mailbox address** for hotline intake — I'll script the per-site grant (a one-time Graph call) so the app can read only that site + that mailbox.

**E. Encrypted email — confirm the type first**
- Forward me (or describe) **one real ASP hotline email's protection**: is it "Microsoft Purview / Office 365 Message Encryption", or S/MIME, or a third-party secure-email gateway? This decides whether we use a decrypt-on-receipt mail rule (simplest) or a different path. **Do not send the email contents — just the encryption type / a screenshot of the protection banner.**

→ Railway env from this step: `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`.

---

## 2. QuickBooks Online — finance (non-PHI)

**You need the QuickBooks account (Dir of Finance owns it).**
1. Go to **developer.intuit.com** → sign in → **Dashboard → Create an app → QuickBooks Online and Payments**.
2. Name: `CFAC Data Platform`. Scope: **`com.intuit.quickbooks.accounting`** (read).
3. **Keys & OAuth**: under the **Production** (or Development to test) tab, copy **Client ID** and **Client Secret**.
4. **Redirect URIs**: add `https://cfac-production.up.railway.app/api/connect/quickbooks/callback`.
5. Note your **Company/Realm ID** (shown in QuickBooks → Settings → Account; we capture it during the OAuth connect).

→ Railway env: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`. (QuickBooks has **no HIPAA BAA** → finance data only, never PHI.)

---

## 3. Bloomerang / Qgiv — donors & donations (non-PHI)

**You need the Bloomerang account (Dir of Development) and Qgiv (Event Coordinator).**

**Bloomerang:**
1. **bloomerang.co** → **Settings → API Keys** (admin) → **Generate API Key** (private). Copy it.
2. (Or OAuth: Settings → Integrations → create an OAuth app for a redirect-based connect — API key is simpler to start.)

**Qgiv** (covers Qgiv + Text2Give — same vendor):
1. **secure.qgiv.com** → your account → **Integrations / API** → copy the **API Token** for the relevant form/org.

→ Railway env: `BLOOMERANG_API_KEY`, `QGIV_API_TOKEN`. (BAA status unconfirmed — treat as low-sensitivity donor data; verify before anything sensitive.)

---

## Order of operations
1. **#1 Microsoft first** — biggest unlock (sheets + email + SSO). Send me the **SharePoint site URL**, the **intake mailbox address**, and the **email-encryption type**.
2. #2 QuickBooks + #3 Bloomerang/Qgiv whenever convenient — they prove the connect-button pattern with zero PHI risk.
3. I wire each into the broker as its credentials land. Nothing here touches client PHI — that stays gated behind the Supabase HIPAA add-on + BAAs (see `INTEGRATION-ARCHITECTURE.md` §5).

When you've done #1 (or just have the three values), paste the **IDs only** here (keep secrets for Railway) and tell me, and I'll light up the first real data pull.

---

## Operator runbook — the connector encryption key is WRITE-ONCE

Every connector credential is sealed with one key (AES-256-GCM). When no `CONNECTOR_ENC_KEY` env is set, that key auto-provisions into the DB as `platform_secrets.connector_enc` (zero-config soft launch). **Changing or deleting that row orphans every sealed credential, permanently** — the ciphertext can never be decrypted again. So a DB trigger makes the row write-once: any `UPDATE`/`DELETE` of it fails.

**If you see SQLSTATE `WO001` / `"connector_enc is write-once"` in the Postgres logs or a query error — STOP.** It means something tried to mutate or delete the master key. This is the guard working, not a bug to route around. Do **not** disable the trigger and do **not** retry the write; doing so destroys all stored connector credentials with no recovery.

Legitimate changes:
- **Harden off the DB key (recommended before PHI):** set `CONNECTOR_ENC_KEY` in Railway (env always wins over the DB row). No DB write needed — the write-once row is simply ignored. See `PHI-INFRA-CHECKLIST.md` §3.
- **Rotate the key:** insert a NEW versioned row (e.g. `connector_enc_v2`) and run a re-encrypt step that re-wraps existing ciphertext under it — never mutate `connector_enc` in place. (Re-encrypt tooling is a future task; the guard intentionally blocks in-place rotation until it exists.)

Migration: `supabase/migrations/20260607070000_platform_secrets_immutable.sql`. To verify the guard on a fresh DB, paste `supabase/migrations/20260607070000_platform_secrets_immutable.test.sql` into the SQL editor — it asserts the row is immutable and rolls back, leaving no data behind.
