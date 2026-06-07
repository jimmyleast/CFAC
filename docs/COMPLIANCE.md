# CFAC — HIPAA Compliance Posture

> **Status:** Pre-PHI. As of the date below, **only aggregate, non-PII metrics** flow to
> external services (LLMs, hosting, email). No client PII/PHI is stored in or transmitted
> to any third party yet. **Every vendor that could touch PHI must have a signed BAA (or,
> where PHI is structurally excluded, a DPA) on file before the first client-identifying
> record is added.**

_Last updated: 2026-06-07 · Owner: CFAC (admin@cfacbentonco.com)_

---

## 1. Scope & data classification

CFAC is a 501(c)(3) and a **HIPAA-covered entity** handling sensitive abuse-victim,
domestic-violence, and family data. The platform also touches VOCA and Arkansas state
confidentiality requirements.

| Class | Examples | May leave CFAC's trust boundary? |
|-------|----------|----------------------------------|
| **PHI / Client PII** | Names, DOB, addresses, case details, forensic-interview content, medical/mental-health notes | **Only to vendors with a signed BAA.** Never to LLMs as identifiable data. |
| **Aggregate / de-identified metrics** | Counts, rates, program totals, dashboard numbers | Yes — this is all that flows today. |
| **Staff/account data** | Staff email, login | Supabase (auth), Resend (transactional only) |

**Hard rule:** The Hope assistant reasons only over de-identified, role-scoped, aggregate
data. Client PII is never sent to any LLM and never written to an external memory store.

---

## 2. BAA / DPA tracker

Legend — **Status:** ☐ Not started · ◐ Requested / in progress · ☑ Signed & on file
**Agreement:** BAA = Business Associate Agreement · DPA = Data Processing Addendum

| # | Vendor | Role in stack | Touches PHI? | Agreement needed | Status | Plan/tier required | Contact / link | Notes |
|---|--------|---------------|--------------|------------------|--------|--------------------|----------------|-------|
| 1 | **Supabase** | Database + Auth (Postgres) | **Yes** (system of record once PHI added) | BAA | ☐ | HIPAA add-on requires **Team or Enterprise** plan | Dashboard → Support, or `sales@supabase.com` · https://supabase.com/docs/guides/security/hipaa-compliance · https://supabase.com/security | Confirm **encryption-at-rest** (default) and that HIPAA add-on is enabled on the project before PHI. |
| 2 | **Railway** | App hosting (Docker) | **Yes** (runs the app; PHI in transit/logs possible) | BAA / DPA | ☐ | TBD — confirm Railway will sign | `team@railway.app` / `security@railway.app` · https://railway.com/legal/dpa | ⚠️ **Risk:** Railway has not historically advertised HIPAA/BAA. If they decline, hosting must move to a HIPAA-eligible host (AWS/GCP/Azure, Render+BAA, Aptible, Fly.io). See §6. |
| 3 | **Anthropic** | Claude — LLM **generator** (primary) + critic | No today (aggregate only); guardrail-critical | BAA + **zero-retention** | ☐ | Commercial / Enterprise | `privacy@anthropic.com` / sales · https://www.anthropic.com/legal/commercial-terms · https://trust.anthropic.com | Request BAA **and** zero-data-retention (ZDR) so prompts aren't retained for training/abuse logging. |
| 4 | **OpenAI** | LLM **critic** (cross-model critique) | No today (aggregate only) | BAA + **ZDR** | ☐ | API platform (eligible accounts) | `privacy@openai.com` / sales · https://openai.com/policies/business-associate-agreement | Alternative if BAA/ZDR is slow: **Azure OpenAI** (covered under Microsoft's standard BAA). |
| 5 | **Google / Gemini** | LLM **critic** (cross-model critique) | No today (aggregate only) | BAA via **Vertex AI** | ☐ | **Vertex AI on Google Cloud** (not AI Studio) | Google Cloud sales · https://cloud.google.com/security/compliance/hipaa | ⚠️ Current code uses the **AI Studio** endpoint `generativelanguage.googleapis.com` ([lib/hope/providers.ts:60](../lib/hope/providers.ts)) which is **NOT HIPAA-eligible**. Migrate critic to **Vertex AI** under the GCP BAA, or **drop Gemini** as a critic. See §6. |
| 6 | **Resend** | Transactional email (auth/invite) | **Structurally no** if emails carry no PHI | DPA (BAA if any PHI possible) | ☐ | Confirm | `support@resend.com` · https://resend.com/legal/dpa | Mitigating control: keep PHI **out** of all email bodies/subjects (login links + non-identifying notices only). Obtain DPA; request BAA if a PHI path is ever introduced. |

---

## 3. Trust boundary (today)

```
Client PII/PHI ──► (NOT YET COLLECTED)
Aggregate metrics ──► Supabase ──► App (Railway) ──► Hope pipeline
                                                       ├─► Anthropic (generate)
                                                       ├─► Gemini  (critic)  ⚠ AI Studio = non-eligible
                                                       └─► OpenAI  (critic)
Auth / invites ──► Resend (no PHI in body)
```

## 4. Technical controls in place / planned

- De-identification at the query layer before any LLM call (aggregate-only today).
- No external memory store of client data; LLM calls are stateless.
- Role-scoped access (Supabase RLS) — verify policies before PHI.
- Encryption in transit (HTTPS) everywhere; encryption at rest to be confirmed per vendor (§2).

## 5. Sequencing rule

**No client PII/PHI may be added to the system until:**
1. Supabase BAA signed **and** HIPAA add-on enabled (#1), and
2. Railway BAA signed **or** hosting moved to a HIPAA-eligible host (#2), and
3. The Gemini critic is on Vertex AI under BAA **or** removed (#5), and
4. Anthropic + OpenAI BAAs with ZDR signed **or** those calls remain strictly aggregate (#3, #4), and
5. Resend DPA on file with PHI excluded from email by design (#6).

## 6. Open action items

- [ ] **Send BAA/DPA outreach to all 6 vendors.** Templates: [docs/baa-outreach-emails.md](baa-outreach-emails.md).
- [ ] **Supabase:** confirm encryption-at-rest + enable HIPAA add-on; upgrade to Team/Enterprise.
- [ ] **Railway:** confirm whether they sign a BAA. **If not, choose a HIPAA-eligible host and plan migration.** (Blocking for PHI.)
- [ ] **Anthropic:** execute BAA + enable zero-data-retention.
- [ ] **OpenAI:** execute BAA + ZDR; if delayed, evaluate Azure OpenAI as the critic path.
- [ ] **Gemini:** migrate critic from AI Studio (`generativelanguage.googleapis.com`) to **Vertex AI** under GCP BAA, **or drop Gemini** from `lib/hope/critique.ts`. (Blocking for PHI.)
- [ ] **Resend:** obtain DPA; assert "no PHI in email" as a design invariant (add a test/guard).
- [ ] File all signed agreements in the compliance vault; update §2 status + dates.
- [ ] Re-run a privacy review once PHI ingestion is designed.
