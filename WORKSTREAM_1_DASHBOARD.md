# Workstream 1 — Dashboard from existing spreadsheets

Goal: a working Executive + Data dashboard for CFAC, cloned from the UHP-OPS-Agent platform, reading CFAC's SharePoint spreadsheet data. Target: something demoable by next weekend.

Legend: **[CORE]** = needed for the next-weekend demo · **[STRETCH]** = nice-to-have once core works.

---

## 🔒 GUARDRAIL: never modify the UHP repo
`C:\Users\jhhea\.vscode\UHP-OPS-Agent` is **read-only / source-only** for this entire project.
- Only ever **copy FROM** UHP **TO** CFAC. UHP is never the destination of any operation.
- The `robocopy` in Phase A uses `/E` (copy) only. **Never** use `/MIR`, `/MOV`, or `/MOVE` with UHP as source — those delete/move source files.
- Run **no** git commands inside the UHP repo (no add/commit/checkout/clean). Reads like `git ls-files` are fine.
- Every delete/strip/edit step below targets **CFAC only**.
- Verified untouched at start: UHP `git status` clean, HEAD `8317ec6`.

---

## Phase A — Import the platform base
- [ ] **[CORE]** Copy the UHP tree into CFAC, preserving CFAC's `.git` and skipping junk:
  ```powershell
  robocopy "C:\Users\jhhea\.vscode\UHP-OPS-Agent" "C:\Users\jhhea\.vscode\CFAC" /E `
    /XD .git node_modules .next .understand-anything `
    /XF CODEBASE_MAP.md AUTH_403_DIAGNOSTICS.md RAILWAY_VAULTIQ_MORGAN_SETUP.md
  ```
- [ ] **[CORE]** Delete UHP meta/docs that don't apply: `*_MLP_CHECKLIST_AND_HISTORY.md`, `admissions/`, `UHP_OPS_FULL_AUDIT_AND_MLP.md`, `PHASE_2_VALIDATION_GUIDE.md`.
- [ ] **[CORE]** `npm install`, then `npm run dev` to confirm it boots. (Build may warn until env is set in Phase C — that's fine.)
- [ ] **[CORE]** First commit to the CFAC repo = "Import UHP-OPS-Agent platform base".

## Phase B — Strip to the shell
- [ ] **[CORE]** Delete UHP domain verticals (pages **and** their API routes): `app/admin/{kitchen,rooms,scheduling,admissions,badges,trades,programs,cohorts,onboarding,intake,graduation,placement,alumni,...}` and matching `app/api/*`.
- [ ] **[CORE]** Delete UHP-only `lib/*`: `hostfully`, `bunk-optimizer`, `hubspot*`, `pre-arrival-sms`, `programs`, `graduation`, `badge-vendor`, `program-imports`, etc. Keep: `admin.ts`, `auth/*`, `supabase/*`, `nav-config.ts`, `pagination.ts`, `anthropic/*`, `telemetry/*`, `morgan/schemaGuard.ts`, `email*`, `google-sheets.ts`, `notifications`.
- [ ] **[CORE]** Remove HeyGen: delete `components/agent/MorganAvatar.tsx` + its two usages (`app/process/[id]/page.tsx`, `app/requests/page.tsx`), delete `app/api/morgan/token/route.ts`, drop deps `@heygen/streaming-avatar` + `livekit-client`, remove `HEYGEN_*` env.
- [ ] **[CORE]** Remove external memory: delete `lib/operative/memory.ts` and all `OPERATIVE_*` env (strict data-handling rule).
- [ ] **[CORE]** Reduce `lib/nav-config.ts` to two dropdowns: **Executive** and **Data**. Remove cross-app URLs (`NEXT_PUBLIC_FIELD_EXEC_URL`, `NEXT_PUBLIC_STUDENT_APP_URL`).
- [ ] **[CORE]** Confirm `npm run dev` still boots with the shell. Commit "Strip to platform shell".
- [ ] **[STRETCH]** Trim unused deps (`twilio`, `qrcode`, `mammoth`, `jszip`, `@react-pdf/renderer`) once everything compiles.

## Phase C — Fresh infra + identity
- [ ] **[CORE]** New Supabase project. Put keys in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **[CORE]** New `ANTHROPIC_API_KEY`. (BAA/enterprise tier before any real client data — see data-handling memory.)
- [ ] **[CORE]** Rewrite `.env.example` to the kept vars only (App, Supabase, Anthropic, Resend, Auth). Set `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAIL` for CFAC.
- [ ] **[CORE]** Rebrand: `package.json` (name=cfac), `app/layout.tsx` metadata, `public/manifest.json` + icons, `tailwind.config.js` color tokens.
- [ ] **[CORE]** New Railway project from the CFAC repo (reuse `Dockerfile` + `railway.toml`); re-point or delete the UHP GitHub Actions in `.github/workflows/`.

## Phase D — CFAC Data schema (schema-first)
- [ ] **[CORE]** Replace `supabase/migrations/*` with a CFAC migration. Pragmatic v1 model:
  - `data_sources` — one row per spreadsheet/source (name, owner, sheet type, last_imported_at).
  - `metrics` — long/tidy table: (source_id, metric_key, period, value, dimension fields). One flexible table covers the pulse-check + reach + org-impact + financial tiles without a table per sheet.
  - `import_rows` — raw staging of each imported row (for the integrity/exceptions view).
  - Use each spreadsheet's **operational-definitions tab** as the field contract for `metric_key`.
- [ ] **[CORE]** RLS ON for every table; admins/leaders only for v1. (No client PII in v1 — dashboard is aggregate metrics.)
- [ ] **[CORE]** Apply via existing `scripts/run-staging-migration.mjs`. Commit "CFAC Data schema v1".

## Phase E — Spreadsheet importer
> ⛔ Blocker: need Melanie/Chloe to send the SharePoint spreadsheets (CSV/xlsx export, **values not formulas**). Chase this first — everything downstream waits on it.
- [ ] **[CORE]** Build a Data-mini-app import endpoint (clone the `app/api/import/*` pattern). Accept an uploaded CSV/xlsx, map columns → `metrics` rows, stamp `data_sources.last_imported_at`.
- [ ] **[CORE]** One mapping config per sheet (sheet → metric_keys), driven by the operational-definitions tab.
- [ ] **[STRETCH]** Direct-source connectors later (QuickBooks API for finance, etc.) — workstream 4, not now.

## Phase F — Executive + Data dashboards
- [ ] **[CORE]** **Data mini app** (under admin tab): list `data_sources`, upload/import UI, last-imported status.
- [ ] **[CORE]** **Executive dashboard**: pulse-check tiles reading from `metrics` (active residents/clients/volunteers, trauma-assessment trend, cases in, residential status, reach, organizational impact = services-not-clients, financial health). Clone the UHP dashboard page/component pattern.
- [ ] **[STRETCH]** **Exceptions / integrity view**: flag missing entries, mismatches, stale sources — the "don't comb 12 sheets" ask.
- [ ] **[STRETCH]** **Agent on-the-fly views**: wire the chat agent so "build me a view of X" generates a dashboard from `metrics` — the wow moment from the call. (Keep `schemaGuard` + critique loop for accuracy.)

## Phase G — Deploy + demo
- [ ] **[CORE]** Deploy to Railway; `npm run test:e2e:smoke`.
- [ ] **[CORE]** Load real imported data; verify a couple of tiles against Melanie's current Excel dashboard.
- [ ] **[CORE]** Share the URL for the meeting.

---

## Critical path for "by next weekend"
A → B → C(min) → **get spreadsheets** → D(min) → E → F(read-only Executive + Data). The exceptions view and on-the-fly agent views are stretch — land the read-only dashboard first.

## Top risks / blockers
1. **Spreadsheet handoff** (Phase E) is the long pole — request it today.
2. **Anthropic BAA** before real client data touches the model (data-handling rule).
3. Don't leave half-stripped UHP modules around — they carry UHP table names and will break. Delete to the shell.
