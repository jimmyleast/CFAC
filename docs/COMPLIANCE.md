# CFAC — HIPAA & SOC 2 Compliance Posture

CFAC handles child-abuse-victim and family-crisis data. This app **must** be HIPAA-compliant and SOC 2 compliant. This document is the source of truth for the compliance posture, the data-flow map, and the open action items. It doubles as evidence and as the one-pager for partner agencies.

> **Status: foundations in place; NOT yet certifiably compliant.** Do not represent the app as HIPAA/SOC 2 compliant until the action items below are closed. Per current decision, vendors are **treated as BAA-covered pending signature** while the BAAs are obtained (tracker below).

---

## 1. Data classification (today)
- **v1 data is aggregate, non-PII metrics only** (counts by program/period). No client names, DOB, addresses, case narratives, or clinical notes are stored or processed by this app yet.
- The AI assistant ("Hope") reasons over **only** these aggregate metrics. It is instructed and independently critiqued to never output client PII.
- **PHI gate:** before any client-PII/PHI table is added (clients, cases, mental-health, residential, Collaborate/MDT data), the controls in §5 must be in place.

## 2. Subprocessors & BAA tracker  ⬅️ ACTION REQUIRED (Jimmy)
A signed BAA is required with every vendor that could touch PHI. **Send each vendor their BAA/DPA and track signature here.** Ready-to-send outreach emails (one per vendor, with the specific ask) live in [docs/baa-outreach-emails.md](baa-outreach-emails.md).

| Vendor | Role | PHI exposure | BAA status | Contact / link & notes |
|---|---|---|---|---|
| Supabase | Database, auth | Yes (when client tables added) | ☐ obtain | `sales@supabase.com` / dashboard support · [HIPAA docs](https://supabase.com/docs/guides/security/hipaa-compliance) — needs **Team/Enterprise + HIPAA add-on**; confirm encryption-at-rest |
| Railway | App hosting | Yes (in transit/logs) | ☐ obtain | `team@railway.app` / `security@railway.app` · [DPA](https://railway.com/legal/dpa) — ⚠ may not sign a BAA; if not, move hosting to a HIPAA-eligible host |
| Anthropic (Claude) | LLM generator + critic | Aggregate only today | ☐ obtain (BAA + zero-retention) | `privacy@anthropic.com` / sales · [trust.anthropic.com](https://trust.anthropic.com) |
| OpenAI | LLM critic | Aggregate only today | ☐ obtain BAA + zero-retention, OR move to Azure OpenAI | `privacy@openai.com` / sales · [BAA policy](https://openai.com/policies/business-associate-agreement) — ⚠ Azure OpenAI path makes **Microsoft** a business associate under its own BAA |
| Google (Gemini) | LLM critic | Aggregate only today | ⚠ AI Studio API is **NOT** HIPAA-eligible — move to **Vertex AI** (GCP) under BAA before any PHI | Google Cloud sales · [GCP HIPAA](https://cloud.google.com/security/compliance/hipaa) — code currently calls `generativelanguage.googleapis.com` at `lib/hope/providers.ts:60` |
| Resend | Transactional email | Minimal (addresses) | ☐ obtain DPA/BAA | `support@resend.com` · [DPA](https://resend.com/legal/dpa) — mitigate by keeping PHI out of all email bodies/subjects by design |

**LLM nuance:** today only aggregate non-PII reaches the models, so this is low-risk. Before PHI could flow to the critic, restrict cross-model critique to BAA-covered endpoints (Anthropic; Azure OpenAI; Vertex Gemini) — the critic provider is intended to be configurable for exactly this.

## 3. SOC 2 control mapping
| Trust criterion / control | Implemented | Gap / action |
|---|---|---|
| Encryption at rest | ✅ Supabase (AES-256) | document |
| Encryption in transit | ✅ TLS everywhere | document |
| Access control (RLS, least privilege) | ✅ RLS on all tables; anon blocked; service-role server-only | access reviews cadence |
| Authentication / **MFA (2-factor)** | ✅ app | TOTP enroll (`/settings/security`); **enforced server-side** (AAL2 gate on all data/admin routes, not just UI); challenge at `/auth/mfa`. Still: enable MFA on Supabase/Railway/GitHub consoles. |
| Audit logging | ⚠ partial (`app_events`) | extend to log PHI access; set retention; make tamper-evident. MFA admin-resets are logged (`auth.mfa.admin_reset`). |
| Monitoring / alerting | ⚠ partial | surface verified/unverified/blocked + freshness; alert on anomalies |
| Change management | ✅ the 6 review gates (`.claude/agents/`) + this compliance gate | run on every change (enforced) |
| Vendor management | ⚠ | the BAA tracker (§2) |
| Incident response / breach notification | ☐ | write policy |
| Data retention & disposal | ☐ | write policy |
| Key management / rotation | ⚠ | **rotate all keys before go-live** (some were shared in chat). Connector-secret key is auto-provisioned to `platform_secrets` (DB) at soft launch for **non-PHI** connectors only — must move to `CONNECTOR_ENC_KEY` env / KMS before any PHI (see [PHI-INFRA-CHECKLIST.md](PHI-INFRA-CHECKLIST.md) §3). |

## 4. De-identification & minimum-necessary
- Hope's grounding catalog selects **only** aggregate metric columns — never `import_rows.raw`, `metrics.dimension` free-text, or any client table.
- System prompt + the independent cross-model critique both forbid emitting client PII.
- When client-PII tables arrive: store identifiers in a restricted table behind stricter RLS; expose only de-identified case IDs + aggregates to the metrics/dashboard layer; add a redaction layer between the DB and any LLM call.
- **File uploads (connect portal):** the import pipeline runs `redactPHI` over every verbatim cell before it lands in `import_rows.raw` (strips email/SSN/DOB/phone/address — defense-in-depth). The upload UI requires an explicit **non-PHI acknowledgment** and warns that case-level exports (Collaborate client data, MDT, forensic/medical/MH records) must NOT be uploaded until the §5 HIPAA infra is in place. Redaction does NOT catch free-text names, so the acknowledgment + the §5 gate remain the real control for case data.

## 5. PHI gate (required before any client-PII table is created)
1. BAAs signed with every subprocessor in the data path (§2).
2. Cross-model critic restricted to BAA-covered endpoints.
3. Role/team-scoped RLS on the PHI tables (no blanket `authenticated` read).
4. Redaction/de-identification before any LLM call; never log raw PHI in `app_events`.
5. Access logging of every PHI read/write; retention + alerting.
6. MFA enforced; key rotation done.

## 5a. MFA enforcement & recovery (runbook)
- **Enrollment:** staff enroll a TOTP authenticator at `/settings/security`.
- **Server-side enforcement:** every sensitive route (`/api/hope/unified`, `/api/data/*`, `/api/executive/summary`, `/api/admin/*`) resolves the session via `getRequestAuth`/`requireUserMfa` and returns **403 `mfa_required`** when the user has a verified factor but the session is not AAL2 (cookie sessions use `getAuthenticatorAssuranceLevel`; bearer tokens use the JWT `aal` claim). `/api/me` is intentionally exempt so the chrome can detect AAL1 and redirect to `/auth/mfa` without a login loop.
- **Recovery (lost device):** there are **no self-service backup codes** in v1. An admin recovers a locked-out user from **People → Reset 2FA**, which calls `POST /api/admin/users/reset-mfa` (admin-only, requires the acting admin's own session to be AAL2). It removes the user's factors so they can sign in at AAL1 and re-enroll. Each reset is logged to `app_events` as `auth.mfa.admin_reset` with the target user id. **Verify the user's identity out-of-band before resetting.**
- **Follow-up:** add self-service recovery codes before scaling staff count.

## 6. Open action items (owner: Jimmy)
- [ ] Obtain & sign BAAs/DPAs for all vendors in §2 — outreach templates ready in [docs/baa-outreach-emails.md](baa-outreach-emails.md).
- [ ] Enable MFA on Supabase, Railway, GitHub; require for app logins.
- [ ] Rotate all API keys / DB password.
- [ ] Move Gemini critic to Vertex AI (or drop Gemini) before any PHI.
- [ ] Write incident-response, data-retention, and access-review policies.
- [ ] Stand up monitoring/alerting on the Hope verification + data-freshness signals.
