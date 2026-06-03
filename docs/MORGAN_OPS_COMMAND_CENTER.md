# Morgan Ops Command Center

Morgan is the staff-facing command layer for UHP-OPS. Staff should not need to know whether a request belongs in UHP-OPS, VaultAIQ, or a future system. Morgan should collect the missing details, preview the action, require confirmation for writes, then update the correct source of truth.

## Source-of-Truth Boundaries

- UHP-OPS owns staff, work orders, staff tasks, grounds zones/routines, assets, preventive maintenance, dashboards, notifications, and assignment workflows.
- VaultAIQ owns inventory products, stock movements, receiving documents, suppliers, locations, par levels, pallet/case quantities, and reorder approvals.
- Morgan owns the conversation contract: classify, ask one clear clarification when needed, preview, confirm, commit, audit, and report the result.

## Command Families

### Role-Aware Questions

Morgan is also the staff Q&A layer for UHP. It must answer business and campus questions from approved data domains, filtered by the user's role, team, and area.

Examples:

- "How many students are in the admissions pipeline?"
- "How many are confirmed?"
- "How many students arrive next week?"
- "What is Ops spend against budget?"
- "What work orders are overdue?"
- "What inventory is below par?"
- "What PMs are due this week?"
- "What is my team's open workload?"

Morgan must never use unrestricted free-form database access for answers. Every answerable metric should be represented by a named data domain, an allowed role scope, and a tested query/API route.

### Inventory

Route through VaultAIQ with the supported Morgan intents only:

- `receive`: add stock, receive cases/pallets, create new product drafts when needed.
- `issue`: decrement stock when items are used, handed out, consumed, or moved out.
- `adjustment`: correct a count.
- `check`: lookup stock, par, reorder, supplier, or location status.

UHP-OPS may display richer words like "move" or "reorder", but the bridge must translate them into the VaultAIQ contract unless VaultAIQ adds first-class support.

### Work Orders

UHP-OPS owns work orders and assignments. Morgan must support:

- Create/report a work order.
- Assign a work order to a person, team, vendor, or leader for routing.
- Update status, priority, due date, next action, and notes.
- Create child tasks when a work order requires multiple steps.

### Staff Tasks

Staff tasks are the shared catch-all for operational follow-through:

- Ask a leader to assign a person.
- Assign a task directly to a staff member or team.
- Track due date, priority, status, source command, and linked entity.
- Surface on dashboards and "my work" views.

### Grounds

Grounds lives in UHP-OPS:

- Zones define the work area.
- Routines define recurring work such as mowing, weed eating, roads, checks, or cleanup.
- Staff tasks are generated or created for assignments and completion follow-up.

### Equipment And PM

Assets and preventive maintenance live in UHP-OPS:

- Assets represent equipment, vehicles, facilities equipment, tools, and systems.
- PM schedules define cadence, next due date, instructions, priority, and owner.
- PM execution should create staff tasks and optionally work orders.
- Consumable parts used during PM are issued through VaultAIQ.

## Morgan Behavior Rules

1. If the request is read-only, answer directly with source data.
2. If the request writes data, create a preview card first.
3. If a required detail is missing, ask one specific question.
4. If multiple records match, ask the user to choose.
5. On confirmation, write the data and store an audit record.
6. If an external system fails, leave the UHP action in `failed` with the error.
7. Never silently overwrite or delete operational records.
8. For read-only analytics, apply the user's role/team/area scope before summarizing.
9. If the user asks for restricted data, explain the access boundary and offer the nearest allowed summary.
10. If a metric is not yet registered, say that it is not wired yet and create a staff/admin task only if the user asks.

## Role-Aware Answer Domains

Morgan's read-only Q&A should be built around these domains:

| Domain | Example questions | Source of truth | Default scope |
| --- | --- | --- | --- |
| Admissions | Pipeline count, confirmed count, next starts, stuck prospects | HubSpot-backed admissions tables/API | Admissions, Executive |
| Students / SIS | Active students, attendance, milestones, cohorts, arrivals | SIS tables/API | Program teams, Admissions, Executive |
| Ops Work | Work orders, overdue work, assignments, P1/P2 risk | UHP-OPS work order tables/API | Team-visible areas, Ops, Executive |
| Staff Tasks | My tasks, team tasks, leader assignment requests | `staff_tasks` | Assignee/team/leader scope |
| Inventory | Stock, below par, recent receives/issues, reorder approvals | VaultAIQ | Ops, Culinary, Maintenance, area owners |
| Budget / Spend | Ops spend, vendor spend, project cost, budget burn | Finance/vendor/project tables once wired | Finance, Ops leadership, Executive |
| Grounds | Zones, routines due, completion status, assignments | UHP-OPS grounds tables/API | Grounds, Ops, Executive |
| Equipment / PM | Assets, PM due, service history, out-of-service equipment | UHP-OPS assets/PM tables/API | Ops/Maintenance/area owners |
| Scheduling | Shifts, facility use, conflicts, coverage | Scheduling tables/API | User/team scope, Ops, Executive |
| Documents | Uploaded docs, summaries, source documents | UHP-OPS documents/storage | Owner/team/admin scope |

Budget/spend is intentionally listed as a required domain even if the current finance source is incomplete. It needs a first-class route before Morgan should answer spend questions with confidence.

## Access Principles

- Executive/Admin: campus-wide operational summaries.
- Department lead: their department plus shared cross-functional work.
- Staff: own tasks, own assignments, and approved team-visible records.
- Student-facing roles: student/cohort data only where the role already has permission.
- Inventory users: inventory visibility follows operational area and VaultAIQ permissions.
- Finance/spend: restricted until a finance role or explicit leadership permission is available.

When in doubt, Morgan should be useful without leaking: answer at a higher level, omit sensitive rows, or ask the user to open the proper admin view.

## Minimum Viable Staff Flow

Examples Morgan must handle:

- "Add a pallet of Bloom to the cooler."
- "Use 3 toilet seats for cabin repairs."
- "Assign work order 8F4A21C0 to Kyle."
- "Ask the grounds lead to assign Zone 1 mowing."
- "Assign Zone 1 mowing to Jason every Monday."
- "Create a PM for the zero-turn mower every 30 days."
- "Add the new pressure washer as equipment."

The user should see one simple Morgan experience; the system should decide where the data belongs.
