# CFAC Data Model & Dashboard Spec

Authoritative blueprint distilled from the org's own design docs (`CFAC Data Points.docx`,
`CFAC Data Interactions.docx`, `Stakeholder Data`, `Component Data by Core Processes`).
**No PHI in this file** — field *names* and gating only. The actual case-level data lives
behind the PHI gate (Collaborate), never in the repo.

## The dashboard the org wants
Per the spec: *"insight in a moment of time [into] the health and active life cycle of the
organization."* Encoded as the **Org Health Snapshot** (`lib/dashboard/org-health-spec.ts`,
rendered on `/executive`). Tiles resolve to the aggregate metrics layer or honestly show
the source they still await.

| Section | Tile | Source today | Status |
|---|---|---|---|
| Clients & Services | Active Acute Clients (90-day) | Collaborate (case data) | 🔒 PHI-gated |
| | Children Served / FI / Medical / MH / Residential (W/C) | Impact history (annual) | live |
| | Overdue Clients (no 90-day follow-up) | Collaborate | 🔒 PHI-gated |
| People & Community | Reach / Volunteers / People Trained / Event Attendance / Tours | Impact history (annual) | live |
| | Active Donors | Bloomerang connector | awaiting connect |
| | PR Responses | marketing tools | awaiting |
| Operations | Maintenance Requests / On-Time / Fleet Trips / Miles | Maintenance + Fleet logs (monthly) | live |
| Finance & HR | Cash Flow | QuickBooks connector | awaiting connect |
| | Retention Rate / Open Positions | iSolved (HR) | awaiting |

The spec's live "active client" counts (caseloads, beds, waitlists, P1 counts, overdue)
all require the **Collaborate case feed**, which is PHI and stays gated until BAAs + the
Supabase HIPAA add-on (see `COMPLIANCE.md`, `PHI-INFRA-CHECKLIST.md`).

## PHI classification of the source spreadsheets (drives the gate)
**Case-level / PHI (gated — never ingest until the infra gate is met):**
- **Acute Services** — Client Name, Collab link, Age/Race/DOB, Alleged Offender, allegation
  type, relationship to AV, medical/FI/MH detail. Heavy PHI.
- **Mental Health** — client name, ACEs, CATS scores (90-day…18-month), treatment plan,
  discharge. PHI.
- **Residential** — resident name, case number, phases, discharge reason, inquiry PII. PHI.

**Aggregate / non-PHI (safe for the dashboard — counts derived from the above):**
- Impact-through-the-years (annual program totals) — **loaded**.
- Operations: Maintenance + Fleet logs → monthly aggregates (PII columns —
  requester/driver/staff names — are excluded at ingest) — **loaded**.
- Education, Community Engagement, Volunteers, Development → event/training/volunteer
  **counts** (the logs carry some contact PII; only aggregates are surfaced).

## Interaction → source-system lineage (`CFAC Data Interactions.docx`)
- **Client**: Outlook Calendar, Collab, Zoom, Outlook
- **Development / Donors**: Bloomerang, spreadsheet, Outlook, Zoom
- **Community Partners**: spreadsheets, Collab, Bloomerang, Outlook, Zoom, website
- **Operations**: spreadsheets, Outlook, Zoom
- **HR**: iSolved, Outlook, iHire, Zoom
- **Finance**: Outlook, Zoom (figures → QuickBooks)

## Definitions still open in the spec (org's own questions — resolve before ingest)
- Unique-volunteer-per-month vs per-year de-duplication (first-class duplicate prevention).
- Whether Collab is the single client system of record (so the spreadsheets can drop
  duplicated demographic columns).
- "Reach" boundary for HR (applicant vs interview) and Development (speaking = Education?).
- Household/family ID for multi-member MH/Residential cases.
