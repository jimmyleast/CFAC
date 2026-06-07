# CFAC Data Platform — Working Agreement (read first, every session)

Internal data & operations platform for **CFAC** (Children & Family Advocacy Center), a Benton County, Arkansas nonprofit serving child-abuse victims and families in crisis. Replaces a fragile web of ~12 manual SharePoint spreadsheets with one trustworthy data layer powering dashboards, data-quality checks, the MDT case-review workflow, and the **Hope** AI assistant.

This file is binding. Companion docs: `docs/INTEGRATION-ARCHITECTURE.md` (the connector plan), `docs/COMPLIANCE.md` (HIPAA/SOC2), `.claude/agents/*` (the 7 review gates), and the build spec `CFAC_Platform_Build_Spec.md`.

## Non-negotiable constraints (build-spec §2)
1. **Highly sensitive PII.** Child-abuse case data: alleged victims/offenders, forensic interviews, medical/MH records. Treat ALL case-level data as PHI.
2. **Synthetic data only in the repo.** Never commit real client data. Build/test against fake records matching the schema.
3. **Never send case-level PII to an external API** (LLM, web search, any vendor) without a documented, human-approved, de-identified path. AI operates on aggregates/derived data or requires redaction first. Flag every place AI touches data.
4. **Two hard walls, always:** (a) raw import → normalized → aggregate (no dashboard reads a raw cell); (b) identifiable case data ↔ reporting aggregates kept separate. Dashboards, Hope, and non-BAA vendors see aggregates only.
5. **Human-in-the-loop.** Anything AI-generated or auto-derived (agendas, extracted fields, case-status moves, summaries) is reviewable + overridable before it's final. No silent automation of case decisions.
6. **Microsoft-centric future.** ~37-user M365/Entra ID org. Design for Entra ID SSO; don't paint into a corner that blocks it.

## The three data principles (the org's own framework — the design contract)
- **Governance** — every value traceable to a source; clear rules for collection/storage/sharing.
- **Integrity** — accurate, consistent, **one operational definition per metric, enforced**; no silent duplication or loss.
- **Quality** — complete, consistent, current; surface staleness and gaps, never hide them.

## The three impact metrics (encode as COMPUTED VIEWS, not stored counts — build-spec §4)
- **Reach** — broadest community impact (sum of distinct populations: advocacy intakes/inquiries, residents, MH referrals/inquiries, donors, tour/event attendees, volunteers, trainees, interns, applicants, partnerships/MDT). Goal: 15% of Benton County by 2040.
- **Clients Served** — **unique individuals, counted once.** Org total = advocacy + residential + external-MH-referral ONLY (to avoid double-counting). **Duplicate-client prevention is first-class.**
- **Services Provided** — total interactions delivered (one client → many).

## Compliance reality (from research — drives the PHI gate)
- **BAA available (PHI OK):** Microsoft 365 (auto via DPA), DocuSign, Qualtrics.
- **NO BAA (non-PHI ONLY, enforce by design):** QuickBooks/Intuit, Asana, **Railway**.
- **Supabase:** PHI requires the **HIPAA add-on + signed BAA** (Team plan). The current free/pro project is **aggregate-only**.
- **Therefore:** the live app today holds aggregate metrics only — correct. Ingesting case-level data (Collaborate, email intake, clients/services) requires the infra upgrade in `INTEGRATION-ARCHITECTURE.md` §5 FIRST.
- **Encrypted email:** Graph cannot read OME-encrypted bodies — use a decrypt-on-receipt Exchange rule; confirm the ASP encryption type with a real sample first.
- **Collaborate has no API** — ingest via export-drop/authorized RPA; messy-export normalization is a first-class subsystem.

## Current stack (intentional deviation from the spec's Prisma/SQLite/auth-stub)
Next.js 14 (App Router) + TypeScript + Supabase (Postgres, Auth, RLS) + Railway, GitHub `jimmyleast/CFAC`. Real Supabase Auth + **server-enforced MFA** (not a stub). RLS deny-all; all data via the service-role client server-side. **Hope** AI = cross-model **generate → critique → verify (block-until-pass)**, grounded in aggregate data, PHI-redacted before any model call, on-the-fly grounded view cards. LLMs: Anthropic (generator) + OpenAI/Gemini (critics).

## Process (every change)
- **Run all 7 review gates** (`.claude/agents/`): security, sql-data, reliability, test-gap, observability, product-acceptance, compliance. Blockers are resolved by a human, never dismissed.
- `verify` = lint + test + build green before pushing. Always `npm run build` (runs ESLint), not just tsc.
- New client-side pages: create the Supabase browser client lazily (`useState(() => typeof window==='undefined' ? null : createClient())`), never at render top-level (static prerender crashes the Railway build otherwise).
- `.env.local` secrets are gitignored — never commit. Railway holds the deployed env (NEXT_PUBLIC_SUPABASE_* must be build-available).
- This was forked from a prior project ("UHP") and is **100% standalone** — never reference or touch UHP.

## Build order (reconciled — see INTEGRATION-ARCHITECTURE.md §7)
Done: auth/RLS/MFA, Hope agent + on-the-fly views, executive dashboard (partial), per-component tiles, data import + integrity (partial).
Next (non-PHI): impact metrics as computed views + Operational Definitions library + Metric Mapping + Exception engine → connector scaffolding → first non-PHI connector (SharePoint Excel "wedge", QuickBooks).
Gated on the PHI infra upgrade + BAAs + agency authorization: email intake, Collaborate ingestion, case-review transformer/agenda builder.
