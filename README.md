# CFAC — Operations & Data Platform

Internal operations and data platform for the **Children & Family Advocacy Center (CFAC)**, a 501(c)(3) nonprofit in Benton County, Arkansas serving children who have experienced abuse, families in crisis, and women and children fleeing domestic violence.

This app replaces manual spreadsheet tracking with a single place to import data, see organizational dashboards, and ask **Hope** (the AI assistant) for answers and on-the-fly views.

## Features

- **Hope assistant** — AI helper grounded in CFAC's own data, with a generate → cross-model critique → verify pipeline so answers are factual and accurate. Trauma-informed; never exposes client PII.
- **Executive dashboard** — org pulse check across programs, services, reach, and financial health.
- **Data mini-app** — register data sources, import spreadsheets/CSV into a unified metrics model, and flag data-integrity issues.
- **Components covered** — Acute, Advocacy, Forensic Interviewing, Mental Health, Medical, Residential, Enrichment, Education, Community Relations, Development, Operations, Finance, HR, and Xaya (therapy dog).

## Tech stack

- **Frontend/Backend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Database/Auth**: Supabase (PostgreSQL)
- **AI**: Anthropic Claude (primary), with OpenAI + Gemini for cross-model critique
- **Email**: Resend
- **Hosting**: Railway (Docker)

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in keys (Supabase, Anthropic/OpenAI/Gemini, Resend).
3. Apply the schema: run `supabase/migrations/20260604000000_cfac_init.sql` in the Supabase SQL Editor.
4. `npm run dev` → http://localhost:3000

## Data handling

CFAC works with sensitive abuse-victim and family data. Client PII is never sent to external memory stores or exposed in AI responses; the assistant reasons over de-identified, role-scoped data. Confirm HIPAA/VOCA/state confidentiality requirements before connecting any client-identifying source.
