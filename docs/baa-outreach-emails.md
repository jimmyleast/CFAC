# BAA / DPA Outreach Emails

Ready-to-send templates, one per vendor. Fill the `{{...}}` placeholders before sending.
Tracker lives in [COMPLIANCE.md](COMPLIANCE.md) §2 (Subprocessors & BAA tracker).

**Shared context for all emails:** CFAC is a 501(c)(3) nonprofit and a HIPAA-covered
entity. We are pre-launch with respect to client data — today only aggregate, non-PII
metrics flow through your service — and we are putting agreements in place **before** any
protected health information (PHI) is added.

Suggested sender: `{{your name}}, {{title}}, Children & Family Advocacy Center`
Reply-to: `admin@cfacbentonco.com`

---

## 1. Supabase — Database + Auth

**To:** Supabase Support (dashboard) / sales@supabase.com
**Subject:** BAA request + HIPAA add-on — nonprofit (covered entity)

Hello Supabase team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We use Supabase as our primary database and auth provider.

We're preparing to store protected health information (PHI) and need the following before
any client data is loaded:

1. A signed **Business Associate Agreement (BAA)**.
2. Confirmation that our project has **encryption at rest** enabled (we understand this is
   default, but want it confirmed in writing).
3. Details on your **HIPAA offering** — which plan/tier is required (we understand the
   HIPAA add-on requires Team or Enterprise), how to enable it on our existing project,
   and any cost.

Could you point me to the BAA execution process and the steps to enable the HIPAA add-on?

Thank you,
{{name}}

---

## 2. Railway — App Hosting

**To:** team@railway.app / security@railway.app
**Subject:** BAA/DPA availability for a HIPAA-covered nonprofit

Hello Railway team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We host our application on Railway (Docker).

Before we process any protected health information (PHI), I need to confirm:

1. Whether Railway will execute a **Business Associate Agreement (BAA)** with us, and the
   process to do so.
2. A copy of your **Data Processing Addendum (DPA)** for our records.
3. Any HIPAA-related controls or documentation you can share (encryption, logging,
   data-handling practices).

If a BAA is not something Railway offers, please just let me know — that's important for
our planning. Appreciate a quick yes/no on the BAA either way.

Thank you,
{{name}}

---

## 3. Anthropic — Claude (LLM generator + critic)

**To:** privacy@anthropic.com (or your sales contact)
**Subject:** BAA + zero-data-retention request — HIPAA-covered nonprofit

Hello Anthropic team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We use the Claude API as the primary model in our assistant.

Ahead of any protected health information (PHI) entering our workflows, we'd like to put
the right agreements in place:

1. A signed **Business Associate Agreement (BAA)**.
2. **Zero data retention (ZDR)** on our API traffic, so prompts/outputs are not retained
   for training or abuse logging.

Could you share the BAA process and how to enable zero-retention on our account, plus any
plan/tier requirements?

Thank you,
{{name}}

---

## 4. OpenAI — LLM critic

**To:** privacy@openai.com (or your sales contact)
**Subject:** BAA + zero-data-retention request — HIPAA-covered nonprofit

Hello OpenAI team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We use the OpenAI API as a cross-model critic in our assistant.

Before any protected health information (PHI) is involved, we'd like to arrange:

1. A signed **Business Associate Agreement (BAA)**.
2. **Zero data retention (ZDR)** for our API usage.

Could you share the BAA eligibility requirements (plan/tier) and the process to enable
zero-retention? If there's a typical timeline, that would help our planning — we may use
Azure OpenAI as an interim path if needed.

Thank you,
{{name}}

---

## 5. Google Cloud — Gemini critic (Vertex AI)

**To:** Google Cloud sales / your GCP account contact
**Subject:** HIPAA BAA + moving Gemini usage to Vertex AI

Hello Google Cloud team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We currently call the Gemini API via **AI Studio**
(`generativelanguage.googleapis.com`) as a cross-model critic.

My understanding is that the AI Studio / Generative Language API is **not** covered under
the Google Cloud HIPAA BAA, but that **Vertex AI** on Google Cloud is HIPAA-eligible.
Before any protected health information (PHI) is involved, I'd like to:

1. Execute a **Google Cloud BAA**.
2. Get guidance on **migrating our Gemini usage to Vertex AI** so it falls under the BAA —
   covered services, setup, and any prerequisites.

Could you confirm the above and point me to the BAA and Vertex AI onboarding steps?

Thank you,
{{name}}

---

## 6. Resend — Transactional Email

**To:** support@resend.com
**Subject:** DPA (and BAA availability) — HIPAA-covered nonprofit

Hello Resend team,

I'm with the Children & Family Advocacy Center (CFAC), a 501(c)(3) nonprofit and a
HIPAA-covered entity. We use Resend for transactional email (authentication and invite
messages).

Our emails are designed to contain **no protected health information (PHI)** — login links
and non-identifying notices only. To document our data-handling, I'd like:

1. A copy of / signature on your **Data Processing Addendum (DPA)**.
2. Confirmation of whether Resend offers a **Business Associate Agreement (BAA)**, in case
   we ever need to cover a PHI path.

Could you share the DPA and let me know on the BAA?

Thank you,
{{name}}
