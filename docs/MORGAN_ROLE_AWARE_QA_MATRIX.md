# Morgan Role-Aware Q&A Matrix

Morgan must become the plain-language query layer for UHP-OPS, but every answer needs a declared domain and role scope. This file is the guardrail for future implementation.

## Answer Contract

For every read-only Morgan question:

1. Classify the domain.
2. Resolve the user's role, teams, and area scope.
3. Call a registered API/query for that domain.
4. Filter rows before summarization.
5. Return counts and short operational context.
6. If the data source is missing, say it is not wired yet.

Do not let Morgan invent metrics, bypass role rules, or query arbitrary tables from a model-generated SQL string.

## Priority Questions

### Admissions

- How many students are in the admissions pipeline?
- How many students are confirmed?
- How many are deposited/accepted/waiting on documents?
- Which prospects are stuck?
- How many starts are expected by cohort/date?

Required output: count, stage breakdown, trend if available, link/open admin path.

### Students / Cohorts

- How many active students are on campus?
- Who arrives this week?
- Which cohorts are missing onboarding?
- Who is absent or at risk?
- What milestones are overdue?

Required output: scoped counts first, names only when role permits.

### Ops Work

- What work orders are open?
- What is overdue?
- What is P1/P2?
- Who owns this work?
- What is unassigned?

Required output: priority breakdown, overdue count, assigned/unassigned count, top risks.

### Budget / Spend

- What is current Ops spend?
- How much has Grounds spent this month?
- What vendors are driving cost?
- Are projects over budget?

Required output: only from approved finance/project/vendor source. If not wired, Morgan should respond: "Budget spend is not wired into Morgan yet."

### Inventory

- What is below par?
- How many cases of water do we have?
- What Bloom was received this week?
- What maintenance supplies were used?
- What needs reorder approval?

Required output: VaultAIQ-backed counts, location, par/reorder context, and ambiguity handling.

### Grounds

- What zones are due today?
- Who owns Zone 1?
- What routines are overdue?
- What was completed this week?

Required output: zone/routine/task status.

### Equipment / PM

- What PMs are due this week?
- Which equipment is out of service?
- What service history exists for this asset?
- Who owns the next PM?

Required output: asset status, due date, owner, next action.

### Staff Tasks

- What are my tasks?
- What does my team owe?
- Which leader assignment requests are open?
- What did Morgan ask me to handle?

Required output: task counts by status, due date, priority.

## Suggested Implementation Order

1. Add a `lib/morgan/answerRegistry.ts` that maps question domains to allowed route/query handlers.
2. Add `/api/morgan/answers` for read-only questions with role-scoped responses.
3. Move admissions, ops dashboard, inventory checks, tasks, PM, and grounds summaries behind registered handlers.
4. Update `/api/morgan/unified` so analytics questions route to `/api/morgan/answers`.
5. Add tests for role scoping before exposing finance/spend answers.

## Non-Negotiables

- No unrestricted model-written SQL.
- No sensitive names when the user only has aggregate access.
- No spend/budget answers until the finance source and role rules are explicit.
- No "I think" answers for business metrics. Either data-backed or clearly not wired.
