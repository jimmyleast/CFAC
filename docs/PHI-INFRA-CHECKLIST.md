# PHI Infrastructure Checklist — bringing case-data connectors online

The platform is **aggregate-only** today. Connectors that touch case-level PHI
(Microsoft 365 email/SharePoint client data, Collaborate, ARBEST, Guardify,
DocuSign intake, Qualtrics outcomes) are **hard-gated** in code behind
`PHI_GATE_READY` and per-provider `phiGated` flags. Do **not** flip the gate
until every box below is checked. This is the controlled on-ramp from
"aggregate dashboard" to "case-data platform."

Owner: Jimmy. Companion: `docs/INTEGRATION-ARCHITECTURE.md` §5, `docs/COMPLIANCE.md`.

---

## 1. BAAs (the legal layer) — one per subprocessor in the PHI path
A BAA must be signed/accepted with **every** vendor that stores or processes PHI:

- [ ] **Supabase** — HIPAA add-on + signed BAA (see §2). *Required — PHI database.*
- [ ] **Microsoft 365** — auto-applied via the Microsoft Products & Services DPA (accept the DPA; confirm Exchange/SharePoint/Graph in scope on the Service Trust Portal).
- [ ] **Compute host for PHI workers** (see §3) — AWS/GCP/Azure BAA, or Aptible/Fly BAA.
- [ ] **DocuSign** — HIPAA BAA (Business Pro+/enterprise tier).
- [ ] **Qualtrics** — BAA + HIPAA-configured account.
- [ ] **Collaborate (Network Ninja)** / **ARBEST (UAMS)** / **Guardify** — written authorization for automated export + any required data-sharing agreement.
- [ ] **Anthropic / OpenAI / Gemini** — BAA or zero-retention enterprise terms before ANY PHI (even redacted) reaches a model. (Today: redact-before-send; do not rely on it for raw PHI.)
- [ ] **Mark non-BAA vendors permanently non-PHI:** QuickBooks/Intuit, Asana, Railway. They must never receive PHI.

Track each provider's BAA status in the Connections portal (BAA ✓ / unverified / no BAA labels already render per provider).

## 2. Supabase HIPAA add-on (the PHI database)
- [ ] Upgrade the project to a **Team plan** and enable the **HIPAA add-on** (~$350/mo).
- [ ] Sign the **Supabase BAA** (Dashboard → Organization → Legal/Compliance).
- [ ] Turn on the HIPAA-required controls Supabase surfaces (enforce MFA — already done in-app; SSL enforcement; network restrictions; PITR backups; audit logging).
- [ ] Confirm **no PHI is in the current (non-HIPAA) project** before/while migrating — the live project has been aggregate-only by design, so this should hold. Verify `metrics`/`import_rows` contain no client identifiers.

## 3. PHI worker host (off bare Railway)
Railway has no broad HIPAA BAA → it stays the **non-PHI app tier only**.
- [ ] Stand up a **BAA-covered compute host** for the PHI-touching workers (the sync workers + email-intake parser + Collaborate normalizer): AWS/GCP/Azure under their BAA, or Aptible/Fly with a BAA.
- [ ] Move the connector **sync workers that pull PHI** to that host (the non-PHI connectors — Bloomerang/Qgiv/QuickBooks/Asana — can keep running on Railway since they carry no PHI).
- [ ] Keep `CONNECTOR_ENC_KEY` (and ideally a KMS master key) in the BAA-covered host's secret store; rotate.
- [ ] **Migrate the connector key off the DB.** For the soft launch the connector encryption key is auto-provisioned into `platform_secrets` (DB) when no env key is set — convenient, but it co-locates the key with the ciphertext. Before PHI: set `CONNECTOR_ENC_KEY` in the host secret store (it takes precedence), confirm `platform_secrets.connector_enc` is no longer the active key, and move to a KMS-held master key.
  - ⚠ **Re-seal on key change.** The env key takes precedence with no automatic re-encryption, so any *non-PHI* connector secret sealed with the auto-DB key becomes undecryptable once `CONNECTOR_ENC_KEY` is set. When adopting the env key (or rotating), **re-connect/re-enter the affected non-PHI connectors** (or run a one-time re-seal) so their stored secrets are re-encrypted under the new key.
  - **Enforced in code (not just a checklist item):** once `PHI_GATE_READY=true`, the DB-key fallback is **refused for every `phiGated` provider**. `phiKeyBlocked()` (lib/connectors/providers.ts) blocks the connect (OAuth start + callback), the API-key POST, and token re-seals on sync (each refusal emits a `connector.phi_key.blocked` audit event); `assertPhiKeyInvariant()` runs at server startup (instrumentation.ts) and **fails the boot** if PHI mode is on without `CONNECTOR_ENC_KEY`. So flipping the gate without provisioning the strong key fails closed — it cannot silently seal PHI with the co-located DB key.
  - **Runbook — if the deploy crash-loops right after you set `PHI_GATE_READY=true`:** this is the fail-closed guard, not a bug. Check the host (Railway) deploy logs for the `CONNECTOR_ENC_KEY` invariant message, set `CONNECTOR_ENC_KEY` in the **same** env group, and redeploy. Provision the key **first**, then flip the gate, to avoid the crash-loop entirely.

### Fail-closed audit: no DB-key-sealed PHI ciphertext AT REST (enforced)
`assertPhiKeyInvariant()` (above) blocks *new* DB-key seals, but it can't see ciphertext
that was **already stored** under the co-located DB fallback key before that guard
existed. A second startup assertion closes that gap: `assertNoDbKeySealedPhiCiphertext()`
(`lib/connectors/phi-key-audit.ts`, also run from `instrumentation.ts`; logic exercised in
CI by `tests/unit/phi-key-audit.test.ts`) **refuses to boot** if any PHI provider
(Microsoft 365, DocuSign, Qualtrics) holds connector ciphertext (`access_token_enc` /
`refresh_token_enc` / `api_key_enc`) that is **not** provably sealed under the strong env
key `CONNECTOR_ENC_KEY` (every populated column must decrypt under it). Such ciphertext was
necessarily sealed with the DB fallback key — a PHI-custody violation, since the key sits
in the same database as the secret. (The PHI gate has never been opened, so today there
should be **zero** PHI ciphertext at all; `runSync` already refuses to touch such a row, so
it would otherwise sit there undetected.)

Operational behavior:
- **Node-only, retry-aware.** The connections query retries with bounded backoff before
  failing closed, so a transient DB blip at boot isn't mistaken for a violation.
- **Visible.** A violation emits a durable `connector.phi_audit.violation` `app_events` row
  (provider + column names only, never secrets) before the boot-blocking throw; a clean run
  emits `connector.phi_audit.passed` (a per-boot record in `app_events` — **forensic today;
  wire an absence-monitor on it to alert when the audit silently stops running**); a query
  that can't complete after retries emits `connector.phi_audit.unavailable`.
- **No silent bypass in prod.** If `SUPABASE_SERVICE_ROLE_KEY` is unset in production, the
  audit can't reach the store, so the server **refuses to boot** rather than skipping the
  control. Outside production it skips with a loud warning.

**Operator runbook — three distinct boot-block signatures (different responses):**
| Boot-log line | Meaning | Action |
|---|---|---|
| `PHI_GATE_READY=true but CONNECTOR_ENC_KEY is not set` | New-seal invariant tripped (gate open, no env key) | Provision `CONNECTOR_ENC_KEY`, then redeploy (provision key **before** flipping the gate). |
| `[phi-key-audit] FAIL CLOSED: … PHI custody violation` | A PHI connector holds DB-key-sealed ciphertext at rest | **Remediate (below)**, then redeploy. Do NOT force the server up. |
| `phi-key-audit: connections query failed after N attempt(s)` | Audit couldn't run (DB unreachable/degraded) | Infra issue — restore Supabase; the host boots once the DB recovers. |
| `[phi-key-audit] SECURITY CONTROL CANNOT RUN: SUPABASE_SERVICE_ROLE_KEY is unset` | Misconfigured prod env | Set the service-role key; deliberate refusal, not a bug. |

**If the at-rest audit fails closed, remediate before re-booting — pick one:**
- **Scrub + reconnect (preferred).** Disconnect the offending provider so its secret
  columns clear (Connections portal → Disconnect), or
  `update connections set access_token_enc=null, refresh_token_enc=null, api_key_enc=null
  where provider in ('microsoft','docusign','qualtrics')`. Then, once the gate is
  legitimately open **with `CONNECTOR_ENC_KEY` set**, reconnect so the secret is freshly
  sealed under the env key.
- **Re-seal under the env key.** With `CONNECTOR_ENC_KEY` in force, decrypt each affected
  secret with the old DB key (`platform_secrets.connector_enc`) and re-`encryptSecret` it
  (now using the env key), then overwrite the column. Only viable while the DB key is still
  recoverable; otherwise use scrub + reconnect.

## 4. Data-handling controls (the technical layer)
- [ ] **De-identification boundary live:** tokenize/redact before any LLM call; mapping in a separate, short-TTL store; audit logs hold tokens only. (`redactPHI` exists; extend to a tokenization layer for case data.)
- [ ] **Identifiable vs aggregate split:** case-level data lands in a restricted schema/table with stricter RLS; only de-identified aggregates flow to dashboards/Hope/non-BAA vendors.
- [ ] **Audit every PHI read/write** (extend `app_events`); set retention; make tamper-evident.
- [ ] **Encrypted email intake:** confirm the ASP hotline email encryption type (Microsoft OME vs S/MIME vs gateway) and stand up the decrypt-on-receipt mail-flow rule (see INTEGRATION-ARCHITECTURE §F). Add `Mail.Read` to the Microsoft app scopes only at this point.
- [ ] **Incident-response, data-retention, access-review policies** written.

## 5. Flip the gate (only after 1–4 are done)
Once the infra + BAAs are in place:
1. **Provision `CONNECTOR_ENC_KEY` first**, then set **`PHI_GATE_READY=true`** in the (now BAA-covered) server env. Order matters: the startup invariant (`assertPhiKeyInvariant`) refuses to boot if the gate is on without the strong env key, so set the key before the gate. (The DB-key fallback stays valid only while the gate is closed, for non-PHI connectors.)
2. Per provider, the registry `phiGated` flag + `PHI_GATE_READY` together unblock it:
   - Microsoft, DocuSign, Qualtrics become connectable.
   - Build/verify each PHI connector against real data on the BAA host.
3. Add `Mail.Read` to the Microsoft scopes (email intake) and wire the Collaborate export normalizer.
4. Re-run the **compliance + security gates** on each PHI connector before it goes live.

## Status today
- ✅ Non-PHI connectors live now: **Bloomerang, Qgiv, QuickBooks, Asana** (connect + Sync now).
- 🔒 PHI connectors built but **gated**: **Microsoft 365, DocuSign, Qualtrics** (+ Collaborate/ARBEST/Guardify file paths). They show "PHI gate pending" until this checklist is complete and `PHI_GATE_READY=true`.
