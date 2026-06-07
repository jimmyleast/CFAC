# CFAC Integration & Connector Architecture

**The hard part of this platform is not dashboards — it is pulling trustworthy data out of ~20 systems that each authenticate differently.** This document is the master plan for that layer: how to log into and pull data from every system CFAC uses, where the legal/compliance walls are, and the build order. It is grounded in source research (vendor docs, Microsoft Learn, RFC 9700, OWASP, NIST) — see citations inline.

Treat this as binding alongside `docs/COMPLIANCE.md` and the review gates.

---

## 0. The five findings that shape everything

1. **You cannot read an encrypted (OME/RMS-protected) email body through Microsoft Graph.** Graph returns a "this message is protected" stub, not plaintext. The Arkansas State Police P1/P2 hotline intakes are the whole point of the email connector, so this is decisive. The only sane path is an **Exchange mail-flow rule that removes encryption on receipt** into a monitored mailbox — *and that only works if ASP's encryption is Microsoft OME (tenant-removable), not S/MIME or a third-party gateway.* **Action: get one real sample and confirm the encryption type before designing this.**

2. **"Collaborate" = Network Ninja's Collaborate, the AR statewide CAC system — and it has no public API.** Data comes out as 1-click PDFs and report exports (the "poorly-formatted exports" Jimmy described). There is no OAuth, no REST. Ingestion is **scheduled export-drop + messy-normalization** (default) or **authorized browser automation** (only with the agency's written blessing). This is the single biggest engineering problem and must be designed for, not wished away.

3. **The current infra (Railway + free/pro Supabase) cannot legally hold case-level PHI.** Railway does not offer a broad HIPAA BAA; Supabase covers PHI **only** with its HIPAA add-on (~$350/mo, Team plan + signed BAA). This is *fine today* — the live app holds only aggregate metrics. But the moment we ingest Collaborate/email/clients-services data, we need an infra upgrade. This is exactly the PHI gate we've been holding.

4. **BAA availability splits the vendors into PHI-allowed and PHI-forbidden.** Allowed: Microsoft 365 (auto via DPA), DocuSign, Qualtrics. **Forbidden (no BAA): QuickBooks/Intuit, Asana, Railway.** These must carry *non-PHI data only*, enforced by design. Several others (Bloomerang, Qgiv, iSolved, Predictive Index) are unconfirmed — verify before any sensitive data flows.

5. **Token custody is governed by RFC 9700 (Jan 2025).** Every OAuth connection: auth-code + PKCE, exact-match redirect URIs, session-bound `state`, refresh-token rotation, server-only token exchange, no plaintext tokens at rest. Non-negotiable for the connect-button broker.

---

## 1. The connector-broker architecture ("Connect Button")

```
  Staff ── Entra ID SSO ──► Next.js app (Railway, NON-PHI only)
                               │  renders "Connect" buttons + dashboards
                               ▼
                 ┌─────────────────────────────────┐
                 │  OAuth broker (server-only)      │  ← /oauth/callback + token exchange
                 │  PKCE · state · token vault      │     (client secret never hits browser)
                 └─────────────────────────────────┘
                               │
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                            ▼
  Sync workers           No-API lane                 Encrypted-email lane
  (queue, scheduled,     (export-drop parser,        (decrypt-on-receipt →
   incremental,           authorized Playwright)      Graph Mail.Read → parse)
   idempotent)
        │                      │                            │
        └──────────────────────┼───────────────────────────┘
                               ▼
        ┌───────────────────────────────────────────────────┐
        │  PHI LANDING ZONE  (identifiable case data)        │  ← BAA-covered infra only
        │  raw → normalized   ·  RLS-locked  ·  audited      │     (Supabase HIPAA add-on +
        └───────────────────────────────────────────────────┘     PHI worker host)
                               │  de-identify / aggregate (tokenize, drop mapping)
                               ▼
        ┌───────────────────────────────────────────────────┐
        │  REPORTING ZONE  (de-identified aggregates)        │  ← what dashboards, the Hope
        │  metrics · components · computed impact views      │     agent, and non-BAA systems see
        └───────────────────────────────────────────────────┘
```

**Two walls maintained throughout (from the build spec §2 + §8):**
- **Raw → normalized → aggregate.** No dashboard ever reads a raw cell; everything flows source → mapped metric → display.
- **Identifiable case data → reporting aggregates.** Only de-identified aggregates cross into dashboards, the Hope agent (LLM), and any non-BAA vendor.

**Build vs buy:** self-host **Nango** for the OAuth plumbing/refresh across the ~20 systems (its self-hosted build makes no HIPAA claim and can't rotate keys, so we own key custody and set `NANGO_ENCRYPTION_KEY` from day one) — and **build our own** sync, normalization, de-identification, and audit. Do **not** route PHI through any vendor's multi-tenant cloud (Nango Cloud, Paragon, Airbyte Cloud). Alternative: build the OAuth dances ourselves (more effort, full control). Decision deferred to the connector phase.

---

## 2. Login / connection method — per system

### 2.0 Tech stack reality (CFAC Tech Stack 2025) + data-value tiering

Ground truth from CFAC's own tech-stack doc. **~37 M365 users — a small org**, which supports "export-drop default, RPA only where justified" (low volume). The **internal owner** is who controls each system's credentials/authorization — coordinate the connector rollout through them, not generically.

**Tier 1 — core data worth pulling first**
| System | Use | Owner | PHI? | Connector path |
|---|---|---|---|---|
| **M365 / SharePoint / OneDrive** | the 12 reporting spreadsheets (today's source of truth), email, Forms | Dir of Finance | mixed (mostly aggregate) | **Graph Excel API — the wedge** (BAA ✅) |
| **Collaborate** (Network Ninja) | case tracking | Dir of Programs | **YES** | export-drop / authorized RPA (no API) |
| **ARBEST** (UAMS) | MH client tracking | Dir of Programs | **YES** | UAMS extract / export (no API) |
| **OMS = Qualtrics** | outcome/feedback (service-delivery, CATS-type) | Dir of Ops | maybe | API token (BAA ✅) |
| **Guardify** | storing/sharing FIs (video) | Dir of Programs | **YES** | partner API |
| **iRecord** | recording/storing FIs | Dir of Programs | **YES** | via Guardify / file drop |
| **DocuSign** | **Mental Health intake** | Dir of Ops | YES (BAA ✅) | OAuth |
| **Bloomerang** | donor mgmt | Dir of Development | no | OAuth/API key |
| **Qgiv / Text2Give** | event + text donations | Event Coordinator | no | API token |

**Tier 2 — ops/finance/HR (non-PHI, after the wedge)**
| System | Use | Owner | Connector |
|---|---|---|---|
| **QuickBooks** | budget/finance | Dir of Finance | OAuth (no BAA → non-PHI) |
| **iSolved** | HR/payroll/people | Operations | partner OAuth |
| **Predictive Index** | hiring/people mgmt | Dir of Ops | api-key |
| **Asana** | project mgmt | Dir of Ops | OAuth (no BAA → non-PHI) |
| **EOS One** | EOS/operating system, scorecards | Dir of Ops | **no API** → manual CSV |
| **Raptor** | sex-offender screening | Operations Coordinator | partner API |
| **SurveyPlanet** | form mgmt | Development | OAuth/API key |

**Tier 3 — content/marketing/web (low data value — skip for the data platform):** HeyOrca (social), Canva, Adobe Pro, Blue Zoo (web design), GoDaddy (domain/hosting), WordPress (site), Salsa Booth (events), Zoom, Propio (translation, billed-per-use). These produce no structured reporting data worth ingesting now.

**The wedge:** the **12 SharePoint Excel spreadsheets are the current source of truth** — every metric is hand-keyed into them today. Pulling them via the Graph Excel API is the highest-value *first* connector: it's mostly aggregate (low PHI), already under the Microsoft BAA, and immediately replaces the fragile manual layer the whole project exists to kill. Start there, not with the hard PHI systems.

---

Grouped by auth pattern. "PHI?" = may this carry case-level PHI given BAA status.

### Pattern A — Microsoft Entra ID (one app registration covers the M365 surface)
CFAC is Microsoft-centric, so Entra is both the **staff login** and the **biggest data connector**.

| Target | How | Scopes / mode | PHI? | Notes |
|---|---|---|---|---|
| **Staff login (SSO)** | Entra OIDC/SAML enterprise SSO → Supabase Auth (coexists with email/pw); group claims → app roles → RLS | delegated OIDC | n/a | Central deprovisioning + MFA at Entra; add SCIM later |
| **SharePoint/OneDrive — the 12 sheets** | Graph **Excel REST API** (read ranges/tables live, no download) | app-only, **`Sites.Selected`** granted per-site | maybe | Least-privilege: zero access until admin grants the one site |
| **Outlook shared mailbox (hotline intake)** | Graph `Mail.Read` + `/subscriptions` webhook (`created`) | app-only `Mail.Read` (NOT `Mail.Read.Shared`) | **YES** | Pair with decrypt-on-receipt rule; renew subscription ≤3 days |
| **Microsoft Forms** | Route responses → Excel/SharePoint List → read via Graph | inherits Excel scopes | maybe | No supported Forms Graph endpoint exists |

App registration: **one confidential client, certificate credential (not secret), admin-consented.** BAA: ✅ auto via Microsoft DPA.

### Pattern B — Per-vendor OAuth2 (auth-code + PKCE) — the "Connect" button
| System | Data | BAA | PHI? | Notes |
|---|---|---|---|---|
| **QuickBooks Online** | finance (invoices, P&L, payments) | ❌ none | **NO** | Finance only; block PHI. Webhooks + CDC available |
| **DocuSign** | intake forms / e-sign envelopes + tab data | ✅ yes | YES (ok) | OAuth auth-code or JWT; Connect webhooks |
| **Asana** | project/ops tasks | ❌ none | **NO** | Ops only; block PHI. OAuth + PAT; HMAC webhooks |
| **Bloomerang** | donor CRM (constituents, gifts) | ❓ verify | low | OAuth **or** API key; donor data |

### Pattern C — API key / token (no redirect dance)
| System | Data | BAA | PHI? | Notes |
|---|---|---|---|---|
| **Qgiv / Text2Give** | donations (one integration; Text2Give is a Qgiv feature) | ❓ verify | low | Per-form API token; webhooks |
| **Qualtrics** | survey responses, contacts | ✅ yes | YES (ok) | `X-API-TOKEN`; event subscriptions |
| **Predictive Index** | hiring assessments | ❓ verify | HR | `api-key` header; PI must enable API access |

### Pattern D — Partner-gated (lead time + a partnership agreement)
| System | Data | Auth | Notes |
|---|---|---|---|
| **iSolved** (HR/payroll) | census, time, payroll | OAuth client-credentials | Must be approved Marketplace partner first |
| **Guardify** (FI video) | media + case metadata | partner token | "Guardify Partner API"; already integrates NCATrak |
| **Raptor** (screening) | visitor logs, offender screening | partner program | "Raptor Connect" API; confirm which data is exposed |

### Pattern E — No API → scheduled export-drop (default) or authorized RPA
| System | Reality | Strategy |
|---|---|---|
| **Collaborate** (case data — CRITICAL) | Network Ninja; no public API; PDF/report exports | **Export-drop + messy-normalization** as a first-class subsystem; authorized Playwright only with ASP/agency written permission |
| **ARBEST** (MH) | UAMS internal app, SQL Server backend, no API | Ask UAMS IT for a server-side extract; else export/RPA |
| **iRecord** (FI video) | recording appliance; push-to-Guardify only | Pipe through Guardify, or pick up MP4 files |
| **EOS One** | no public API | Manual CSV export |

### Pattern F — Encrypted email transport (the hotline intake)
ASP P1/P2 intakes arrive **encrypted**. Path: **Exchange mail-flow rule removes OME/rights protection on receipt** → lands decrypted in a monitored shared mailbox → Graph `Mail.Read` reads it → parser extracts structured rows into the PHI landing zone. **Do not** build the MIP-SDK super-user decryptor (tenant-wide decrypt power = huge HIPAA blast radius) unless decrypt-on-receipt is proven impossible. **Verify the encryption is Microsoft OME first** — S/MIME or a third-party gateway would not be removable this way and forces a different design.

---

## 3. Token custody & security checklist (RFC 9700 / OWASP)

- [ ] Auth-code **+ PKCE** for every provider; **exact-match** redirect URIs; session-bound, single-use **`state`**.
- [ ] Client secret + `code_verifier` **never reach the browser**; callback + exchange run server-side in the BAA boundary.
- [ ] **Minimum-necessary scopes** per source (HIPAA 45 CFR 164.502(b)); request `offline_access` only where a long-lived pull needs a refresh token.
- [ ] Tokens **encrypted at rest, never plaintext.** Prefer **app-level envelope encryption** (per-record data key, KMS master key) for rotation; Supabase **Vault** over the deprecating pgsodium; disable statement logging on secret writes.
- [ ] **Refresh-token rotation** (new token each use, old invalidated, reuse = compromise). Short-lived access tokens refreshed by the worker, not cached in the browser. Sender-constrained tokens (DPoP/mTLS) where supported.
- [ ] **Audit-log every external pull** (who/what/when/source/scope/row count, `request_id`-correlated, append-only) — 45 CFR 164.312(b).
- [ ] **BAA on file per PHI subprocessor**; QuickBooks/Asana/Railway explicitly flagged **non-PHI** and PHI fields blocked from flowing to them.

---

## 4. Sync architecture

- **Scheduler + durable queue** on the PHI worker host: pg-boss (Postgres-backed, no extra infra) or BullMQ (Redis). Cron triggers periodic pulls.
- **At-least-once + idempotent consumers**: idempotency key = `source + window + content-hash`; retries yield identical final state.
- **Incremental sync**: per-source **watermark** (updated-since cursor / delta token) in the source registry; pull only changes since last success.
- **Failure handling**: exponential backoff + jitter, dead-letter queue, transactional outbox where a row-commit must coincide with a downstream event.
- **Import health**: source registry row tracks `last_success_at`, `last_error`, consecutive-failure count, rows-ingested, health (green/stale/failing) — surfaced on the Data Integrity dashboard. Every run writes an audit entry.

---

## 5. What must happen before any PHI flows (the gate)

This is the upgrade from "aggregate dashboard app" to "case-data platform." All required:

1. **Supabase HIPAA add-on + signed BAA** (Team plan). The free/pro project cannot hold PHI.
2. **PHI workers off bare Railway** — host the connector/sync workers on a BAA-covered platform (AWS/GCP/Azure under BAA, or Aptible/Fly with BAA). Railway stays for the non-PHI app tier only.
3. **BAAs**: confirm Microsoft (auto via DPA), DocuSign, Qualtrics; obtain/verify Bloomerang, Qgiv, iSolved, PI. Mark QuickBooks/Asana/Railway non-PHI permanently.
4. **Agency authorization for Collaborate/ARBEST** — written confirmation from ASP/DHS/UAMS that automated export with CFAC's own credentials is permitted, before any RPA. Otherwise manual export-drop only. Counsel reviews the case-system agreement.
5. **One real encrypted ASP email sample** — confirm OME vs S/MIME vs gateway to design the email connector.
6. **De-identification boundary live** — tokenize before any LLM call, mapping in a separate short-TTL store, audit logs hold tokens only.

Until 1–6 are satisfied, the connector layer ships **non-PHI connectors only** (QuickBooks finance, Asana ops, the aggregate-only SharePoint reporting sheets) to prove the pattern.

---

## 6. Reconciliation with the build spec & current app

The master spec (`CFAC_Platform_Build_Spec.md`) assumed a greenfield Prisma/SQLite prototype with a stubbed role switcher. **We are further along and on a stronger stack** — keep it:
- **Stack deviation (intentional):** Supabase/Postgres + real Supabase Auth + RLS + MFA, deployed on Railway. *Not* Prisma/SQLite/auth-stub. This satisfies the spec's "migrate to Postgres" and "design for SSO" goals early.
- **Phase 6 (Agent) already built** — Hope (generate→critique→verify) + on-the-fly grounded views.
- **Phase 2 (Exec dashboard) partial**, **Phase 1 (import + source registry) partial** (data_sources, import, integrity page exist).
- **Real gaps vs spec (next, all non-PHI):** the three impact metrics as **computed views** with the exact §4 operational definitions + duplicate-client rule; the **Operational Definitions library**; the **Metric Mapping tool**; the **Exception engine** (import-time validation → exception rows); the **clients/services/cases** model (synthetic until the PHI gate).
- **Connector layer = spec Phases 4/5/7** — gated on §5 above.

---

## 7. Build order (revised, reconciled)

| # | Build | Touches PHI? | Gated on |
|---|---|---|---|
| A | Impact metrics as computed views (Reach / Clients Served / Services Provided) + Operational Definitions library + Metric Mapping + Exception engine | No (synthetic) | — build now |
| B | Connector **scaffolding**: `connections` table (encrypted tokens), source-registry health, "Connect" button UI, broker callback pattern | No | vendor app registrations |
| C | First **non-PHI** connectors: QuickBooks (finance), M365 SharePoint Excel (aggregate sheets) | No | Entra app reg, QBO app |
| D | Infra PHI upgrade (Supabase HIPAA add-on, PHI worker host, BAAs) | — | Jimmy + legal |
| E | Email intake connector (decrypt-on-receipt → Graph → parse) | **Yes** | D + email sample |
| F | Collaborate ingestion (export-drop normalizer; authorized RPA) | **Yes** | D + agency auth |
| G | Case Review transformer + agenda builder (spec Phases 4/5) | **Yes** | D + F |

---

*Sources: Microsoft Learn (Graph auth, Excel REST, Sites.Selected, change notifications, OME/MIP, HIPAA DPA), Network Ninja / Collaborate, UAMS ARBEST, Guardify, Raptor, Intuit/Bloomerang/Qgiv/iSolved/PI/Asana/DocuSign/Qualtrics developer docs, RFC 9700, OWASP OAuth2 Cheat Sheet, Supabase HIPAA/Vault/SSO docs, Aptible HIPAA/PHI de-id. Full URLs captured in the research session that produced this doc.*
