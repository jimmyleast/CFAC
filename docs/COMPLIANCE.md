# CFAC — HIPAA & SOC 2 Compliance Posture

CFAC handles child-abuse-victim and family-crisis data. This app **must** be HIPAA-compliant and SOC 2 compliant. This document is the source of truth for the compliance posture, the data-flow map, and the open action items. It doubles as evidence and as the one-pager for partner agencies.

> **Status: foundations in place; NOT yet certifiably compliant.** Do not represent the app as HIPAA/SOC 2 compliant until the action items below are closed. Per current decision, vendors are **treated as BAA-covered pending signature** while the BAAs are obtained (tracker below).

---

## 1. Data classification (today)
- **v1 data is aggregate, non-PII metrics only** (counts by program/period). No client names, DOB, addresses, case narratives, or clinical notes are stored or processed by this app yet.
- The AI assistant ("Hope") reasons over **only** these aggregate metrics. It is instructed and independently critiqued to never output client PII.
- **PHI gate:** before any client-PII/PHI table is added (clients, cases, mental-health, residential, Collaborate/MDT data), the controls in §5 must be in place.

## 2. Subprocessors & BAA tracker  ⬅️ ACTION REQUIRED (Jimmy)
A signed BAA is required with every vendor that could touch PHI. **Send each vendor their BAA/DPA and track signature here.**

| Vendor | Role | PHI exposure | BAA status |
|---|---|---|---|
| Supabase | Database, auth | Yes (when client tables added) | ☐ obtain |
| Railway | App hosting | Yes (in transit/logs) | ☐ obtain |
| Anthropic (Claude) | LLM generator + critic | Aggregate only today | ☐ obtain (Anthropic offers BAA + zero-retention) |
| OpenAI | LLM critic | Aggregate only today | ☐ obtain BAA + zero-retention, OR move to Azure OpenAI |
| Google (Gemini) | LLM critic | Aggregate only today | ⚠ AI Studio API is **NOT** HIPAA-eligible — move to **Vertex AI** (GCP) under BAA before any PHI |
| Resend | Transactional email | Minimal (addresses) | ☐ obtain DPA/BAA |

**LLM nuance:** today only aggregate non-PII reaches the models, so this is low-risk. Before PHI could flow to the critic, restrict cross-model critique to BAA-covered endpoints (Anthropic; Azure OpenAI; Vertex Gemini) — the critic provider is intended to be configurable for exactly this.

## 3. SOC 2 control mapping
| Trust criterion / control | Implemented | Gap / action |
|---|---|---|
| Encryption at rest | ✅ Supabase (AES-256) | document |
| Encryption in transit | ✅ TLS everywhere | document |
| Access control (RLS, least privilege) | ✅ RLS on all tables; anon blocked; service-role server-only | access reviews cadence |
| Authentication / **MFA (2-factor)** | ⚠ partial | **Enable MFA on Supabase, Railway, GitHub, and require it for staff app logins** |
| Audit logging | ⚠ partial (`app_events`) | extend to log PHI access; set retention; make tamper-evident |
| Monitoring / alerting | ⚠ partial | surface verified/unverified/blocked + freshness; alert on anomalies |
| Change management | ✅ the 6 review gates (`.claude/agents/`) + this compliance gate | run on every change (enforced) |
| Vendor management | ⚠ | the BAA tracker (§2) |
| Incident response / breach notification | ☐ | write policy |
| Data retention & disposal | ☐ | write policy |
| Key management / rotation | ⚠ | **rotate all keys before go-live** (some were shared in chat) |

## 4. De-identification & minimum-necessary
- Hope's grounding catalog selects **only** aggregate metric columns — never `import_rows.raw`, `metrics.dimension` free-text, or any client table.
- System prompt + the independent cross-model critique both forbid emitting client PII.
- When client-PII tables arrive: store identifiers in a restricted table behind stricter RLS; expose only de-identified case IDs + aggregates to the metrics/dashboard layer; add a redaction layer between the DB and any LLM call.

## 5. PHI gate (required before any client-PII table is created)
1. BAAs signed with every subprocessor in the data path (§2).
2. Cross-model critic restricted to BAA-covered endpoints.
3. Role/team-scoped RLS on the PHI tables (no blanket `authenticated` read).
4. Redaction/de-identification before any LLM call; never log raw PHI in `app_events`.
5. Access logging of every PHI read/write; retention + alerting.
6. MFA enforced; key rotation done.

## 6. Open action items (owner: Jimmy)
- [ ] Obtain & sign BAAs/DPAs for all vendors in §2.
- [ ] Enable MFA on Supabase, Railway, GitHub; require for app logins.
- [ ] Rotate all API keys / DB password.
- [ ] Move Gemini critic to Vertex AI (or drop Gemini) before any PHI.
- [ ] Write incident-response, data-retention, and access-review policies.
- [ ] Stand up monitoring/alerting on the Hope verification + data-freshness signals.
