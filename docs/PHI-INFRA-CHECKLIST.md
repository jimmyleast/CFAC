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

## 4. Data-handling controls (the technical layer)
- [ ] **De-identification boundary live:** tokenize/redact before any LLM call; mapping in a separate, short-TTL store; audit logs hold tokens only. (`redactPHI` exists; extend to a tokenization layer for case data.)
- [ ] **Identifiable vs aggregate split:** case-level data lands in a restricted schema/table with stricter RLS; only de-identified aggregates flow to dashboards/Hope/non-BAA vendors.
- [ ] **Audit every PHI read/write** (extend `app_events`); set retention; make tamper-evident.
- [ ] **Encrypted email intake:** confirm the ASP hotline email encryption type (Microsoft OME vs S/MIME vs gateway) and stand up the decrypt-on-receipt mail-flow rule (see INTEGRATION-ARCHITECTURE §F). Add `Mail.Read` to the Microsoft app scopes only at this point.
- [ ] **Incident-response, data-retention, access-review policies** written.

## 5. Flip the gate (only after 1–4 are done)
Once the infra + BAAs are in place:
1. Set **`PHI_GATE_READY=true`** in the (now BAA-covered) server env.
2. Per provider, the registry `phiGated` flag + `PHI_GATE_READY` together unblock it:
   - Microsoft, DocuSign, Qualtrics become connectable.
   - Build/verify each PHI connector against real data on the BAA host.
3. Add `Mail.Read` to the Microsoft scopes (email intake) and wire the Collaborate export normalizer.
4. Re-run the **compliance + security gates** on each PHI connector before it goes live.

## Status today
- ✅ Non-PHI connectors live now: **Bloomerang, Qgiv, QuickBooks, Asana** (connect + Sync now).
- 🔒 PHI connectors built but **gated**: **Microsoft 365, DocuSign, Qualtrics** (+ Collaborate/ARBEST/Guardify file paths). They show "PHI gate pending" until this checklist is complete and `PHI_GATE_READY=true`.
