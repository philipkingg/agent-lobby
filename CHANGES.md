# Agent Sims — Changes Log

This file tracks what has been built. Read it at the start of each new session for context.

---

## Phase 13 — PR-Based Review Flow [TODO]

**Goal:** Implementer creates a real GitHub PR when implementation is done. Reviewer reviews it by reading the actual PR diff and leaving inline comments via `gh`. Review feedback travels through the PR, not just through the agent prompt. Implementer is re-dispatched to address those comments.

### Current (broken) flow
- Implementer works on branch, commits, done
- Reviewer reads `git diff` and outputs text — no PR exists yet
- REQUEST_CHANGES loops implementer back with text feedback injected into prompt
- Merger creates the PR at the end

### Target flow
1. **Implementer finishes** → pushes branch → creates PR (`gh pr create`) → outputs `PR_READY: <url>`
2. **Pipeline runner** detects `PR_READY`, stores URL via `setTaskPrUrl`, advances to `queued:review`
3. **Reviewer** uses `gh pr view <number> --comments` + `gh pr diff <number>` to read the PR, then either:
   - `gh pr review <number> --approve` → outputs `APPROVE`
   - `gh pr review <number> --request-changes --body "..."` → outputs `REQUEST_CHANGES: <summary>`
4. **On REQUEST_CHANGES:** pipeline runner loops task back to `queued:implement`. Implementer prompt includes the PR URL and is told to read PR review comments (`gh pr view --comments`) and address them, then push new commits.
5. **On APPROVE:** advance to `queued:merge`. Merger does `gh pr merge --squash --auto`.

### Changes needed
- **`stage-prompts.ts`** — implementer prompt: after finishing, push branch and create PR, output `PR_READY: <url>`. Include PR URL + "read comments with `gh pr view --comments`" when `reviewLoopCount > 0`.
- **`stage-prompts.ts`** — reviewer prompt: use `gh pr view <number>` and `gh pr diff`, leave review via `gh pr review`, output `APPROVE` or `REQUEST_CHANGES`.
- **`pipeline-runner.ts`** — detect `PR_READY: <url>` in implementer result, call `setTaskPrUrl`, then advance stage normally.
- **`pipeline-runner.ts`** — pass PR URL to implementer on retry (already injected via `reviewFeedback`, but add explicit "go to PR: <url>" instruction).
- **`stage-prompts.ts`** — merger prompt simplifies: PR already exists, just do `gh pr merge --squash --auto`.

### Key decisions
- PR created by implementer, not merger — merger just merges
- Reviewer only reviews via PR (not raw git diff) — consistent with real code review
- PR wall gets populated earlier (after first implement pass, not after merge)

---

## Phase 12 — Task Lifecycle: New → Ready Gate [TODO]

**Goal:** Tasks created by the user start in `new` status and are invisible to the scheduler. User explicitly moves them to `ready` to allow agent pickup. Prevents agents from immediately grabbing half-formed tickets.

### What changes
- **`tasks.ts`** — add `"new"` and `"ready"` to `TaskStatus`. New tasks default to `status = 'new'`.
- **`tasks.ts`** — `nextQueuedTaskForJobType` only picks up tasks with `status = 'ready'` (not `'queued'`... wait, need to think this through). Actually: `new` = user hasn't released it. `ready` = user released it, scheduler can pick up. Once scheduler claims it → `running`. Keep existing `queued` as scheduler-visible state — rename meaning: `new` = draft, `ready` = released to queue, `queued` = in pipeline waiting for an agent, `running` = agent working.
  - Simpler: `new` status is scheduler-invisible. `POST /tasks/:id/ready` moves `new → queued:prioritize / status:queued`. Everything downstream unchanged.
- **`backend/src/app.ts`** — add `POST /tasks/:id/release` endpoint (moves `new → queued`).
- **`frontend/src/App.tsx`** — task creation always produces `status: 'new'`. Task row shows "Release" button for `new` tasks. `new` tasks shown in their own section or with a distinct badge.
- **DB migration** — `createTask` sets `status = 'new'` instead of `'queued'`. Old tasks already in queue unaffected.

### Key decisions
- GitHub issue ingestion: issues start `new` too — human must release them (or add a setting to auto-release)
- Epic children: start `new` or auto-release? Auto-release makes sense since the planner already decided to create them.
- Task panel: show "Release to queue" button for `new` tasks alongside delete

---

## Phase 11 — UI Improvements [TODO]

**Goal:** Several small but important UI fixes and additions.

### 1. Agent inspect panel position
Move agent detail panel ABOVE the agent list (not below). Currently clicking an agent appends the detail panel below the list — you have to scroll down to see it. Swap render order: detail panel renders first (when an agent is selected), list below.

- **`frontend/src/App.tsx`** — in the agents tab JSX, render `<AgentDetailPanel>` before `<AgentList>` / agent rows when `selectedAgent !== null`.

### 2. Task creation form — missing fields
Current form only has title + description + project. Missing:
- **Priority** — 1–5 number input or star/dot selector (default 3)
- **Human review** — checkbox (requires human approval at each stage gate)
- **Squad** — dropdown to associate task with a squad (optional; limits which agents can pick it up)

- **`frontend/src/App.tsx`** — add priority input, requiresHumanReview checkbox, squad dropdown to the new task form
- **`backend/src/app.ts`** — `POST /tasks` already accepts these fields; frontend just wasn't sending them

### 3. Epic collapsible sections in task list
Epics (tasks with `status = 'split'`) should render as collapsible headers in the task list. Children are shown indented under the parent when expanded. Epic row shows a ▶/▼ toggle.

- **`frontend/src/App.tsx`** — group tasks: epics + their children. Epic row has expand/collapse toggle state. Children render as indented rows under their epic when expanded. Non-epic, non-child tasks render normally.
- Collapsed by default; expand on click of the ▶ icon (not the whole row, which opens detail panel).

---

## Phase 10 — Auditor / Manager Agent [TODO]

**Goal:** A new `auditor` job type that observes completed work across all agent types, scores their efficiency, and proposes targeted edits to the `agents/{type}.md` knowledge files. Closes the feedback loop — the system improves its own agents over time.

### What the auditor does

1. **Reads performance signals** — for each recently-completed task stage:
   - How many review loops (reviewLoopCount) before merge?
   - Did the agent get stuck? How many times?
   - Did the planner split or not, and was the split appropriate?
   - Token cost proxy: transcript length
   - Time spent (completedAt − startedAt on task_stages)
2. **Reads the transcript** — looks at what the agent actually did, what it got wrong, what it had to re-do
3. **Reads the current `agents/{type}.md`** — understands what the agent was told
4. **Outputs a diff** — specific additions/removals to the knowledge file: new gotchas, corrected instructions, missing context, better output format examples
5. **Does NOT auto-apply** — presents the suggestion to the human (pending question / awaiting_approval flow). Human approves → auditor writes the file.

### New agent type

- `jobType: "auditor"` — add to the DB CHECK constraint and all relevant lists
- No specific stage in the pipeline — auditor is triggered differently (periodic cron, or after N tasks complete, or manually)
- Station: `audit-desk` (or reuse `planning` desk) in the office layout

### Trigger options (decide at implementation time)
- Manual: button in UI "Run Audit"
- Automatic: after every 5 tasks reach `done` status, trigger an audit pass
- Scheduled: cron job every X hours

### Data the auditor needs
- `GET /agents` filtered by job type
- `GET /tasks?status=done` (last N completed)
- `GET /tasks/:id/stages` for time/loop data
- `GET /tasks/:id/transcript` for qualitative review
- Read access to `agents/{type}.md` files
- Write access to propose changes (or a `POST /agents/knowledge/:type` endpoint)

### Implementation steps
1. Add `auditor` to `jobType` CHECK constraint in DB schema (new migration)
2. Add `auditor` to hire form in UI
3. Create `agents/auditor.md` describing what to look for and how to format suggestions
4. Add `POST /audit/run` endpoint that picks the most-qualified idle auditor and dispatches an audit session
5. Build audit stage prompt: inject performance data + current knowledge files + task transcripts
6. Handle output: auditor outputs `KNOWLEDGE_UPDATE: {type}: {markdown diff}` → stored as pending suggestion
7. Frontend: show pending knowledge suggestions in a new "Audit" panel, with approve/reject per suggestion
8. On approval: write the file change, broadcast

### Key decisions to make
- Scope per audit run: audit one agent type at a time vs all types in one session
- How many tasks to review per audit (last 10? last 20 per type?)
- Whether to show the auditor's reasoning or just the proposed edit

---

## Phase 9 — Agent Knowledge Files [TODO]

**Goal:** Give each agent type a persistent knowledge file (`agent-{type}.md`) that is injected into their stage prompt. Acts like onboarding docs — common lookup patterns, codebase conventions, file structure, testing approach, gotchas. Agents stop wasting tokens re-discovering the same things every run.

### One file per job type

| File | Agent | Purpose |
|------|-------|---------|
| `agents/prioritizer.md` | Prioritizer | Scoring rubric, what signals raise/lower priority, output format rules |
| `agents/planner.md` | Planner | Codebase map (key files/dirs), how to read the repo before planning, SPLIT_EPIC format, PLAN_COMPLETE format, what makes a good vs bad subtask split |
| `agents/implementer.md` | Implementer | File structure conventions, how to find the right files, commit message style, conflict resolution steps, testing requirements, branch hygiene |
| `agents/reviewer.md` | Reviewer | What to check (correctness, tests, style, security), how to diff, APPROVE vs REQUEST_CHANGES format, what's a blocking vs non-blocking issue |
| `agents/merger.md` | Merger | PR creation steps, auto-merge flags, how to verify the branch is conflict-free before pushing, what to do when push is rejected |

### What each file should contain

- **Codebase map** (implementer/planner): top-level dirs, what lives where, key entry points
- **Conventions**: naming, file structure, import style, commit format
- **Common commands**: how to run tests, how to lint, how to build
- **Output format reminders**: exact keywords the pipeline runner looks for (PRIORITY: N, PLAN_COMPLETE, SPLIT_EPIC, APPROVE, REQUEST_CHANGES, MERGED)
- **Gotchas**: things that trip agents up — e.g. worktree is a sibling dir not the main repo, always pull before pushing, do not commit .env files
- **Testing**: how tests are run, where test files live, what coverage is expected

### Implementation steps

1. Create `agents/` directory at project root (sibling to `backend/` and `frontend/`)
2. Write each `.md` file with the above sections, tailored to the job type
3. In `stage-prompts.ts`, read the relevant `agent-{type}.md` file at prompt build time and append after the base prompt + personality (or prepend as a "system" section)
4. Cache the file reads — read once at startup, not per-stage invocation
5. Make files editable at runtime: if a file changes, the next stage invocation picks it up (no restart needed — just re-read on each `buildStagePrompt` call, OS caches the file anyway)

### Key decisions to make during implementation
- Where to mount the knowledge: prepend (agent reads it before task) vs append (task context first, then constraints) — likely prepend since it's "rules" not "context"
- Whether to version the files in git (yes — they are code, not config)
- Whether agents should be able to update their own knowledge files (interesting future feature — agents that improve their own docs — defer)

---

## Phase 8 — Squad Management UI [DONE]

**Goal:** Build the Squad tab so you can create squads, assign agents to them, and assign projects. Agents in a squad only pick up tasks for that squad's projects (enforced by AgentScheduler).

### What changed
- `frontend/src/useGameState.ts` — added `Squad` interface (`id, name, projectIds: string`), `squads: Squad[]` state, `fetchSquads`, `refetchSquads` exposed in return value.
- `frontend/src/App.tsx` — added `'squads'` to `Tab` type. Added `SquadsTab` component: create-squad form (name + project multi-select), squad card per squad (name, toggle projects, agent pills with × remove, "Add agent" dropdown). Squad badge (purple pill) on `AgentRow` showing squad name. Settings tab label changed to ⚙ to make tab bar fit. `squadById` map built from squads list. `App` destructures `squads` + `refetchSquads`.
- `frontend/src/App.css` — added `.squads-tab`, `.squad-card`, `.squad-card-header`, `.squad-name`, `.squad-agent-pill` styles.
- `backend/src/tasks.ts` — wrapped children cascade query in try/catch so `deleteTask` doesn't throw when `parentTaskId` column doesn't exist (schema migration timing guard). Frontend delete now checks `res.ok` and shows error alert on failure.

### Key decisions
- Agents with no squad pick up tasks from any project (existing scheduler behavior)
- Project assignment in squads is toggle-based (click to add/remove) — no save button needed
- "Add agent" dropdown only shows agents NOT already in this squad
- Squad badge on agent row shows at a glance which squad each agent belongs to

---

## Phase 7 — Epic / Ticket Splitting [DONE]

**Goal:** Planners can split complex tasks into multiple subtasks (Jira-style epics). Each subtask goes through the full pipeline independently. Parent task is marked `split` and shows children in the UI.

### What changed
- `backend/src/db.ts` — bumped `SCHEMA_VERSION` to 3. Added `parentTaskId TEXT` column to tasks table in `applyV2Schema` and `migrateV1ToV2`. Added `migrateV2ToV3` (runs `ALTER TABLE tasks ADD COLUMN parentTaskId TEXT`). Updated `createDb` migration branching.
- `backend/src/tasks.ts` — added `"split"` to `TaskStatus`. Added `parentTaskId: string | null` to `Task` interface + `CreateTaskInput`. Updated `createTask` INSERT to include `parentTaskId`. Added `listChildTasks(db, parentTaskId)`. Added `splitTask(db, parentId, subtasks[])`: creates child tasks with `parentTaskId` set, then sets parent `status = 'split', stage = 'done'`. Updated `deleteTask` to cascade delete children.
- `backend/src/stage-prompts.ts` — updated `queued:plan` prompt to explain `SPLIT_EPIC:` output format. Planner outputs `SPLIT_EPIC: [{title, description}, ...]` for complex tasks; writes `PLAN_COMPLETE` for simple ones.
- `backend/src/pipeline-runner.ts` — imported `splitTask`, `setTaskWorktree`, `getProject`, `createWorktree`, `branchName`. In `onStageSuccess`, when `stage === 'queued:plan'`, parses `SPLIT_EPIC:` JSON from result text (bracket-matching parser). If valid array with ≥2 entries: awards XP, calls `splitTask`, creates worktrees for each child, broadcasts `status: 'split'`, frees agent. Falls through to normal advance if JSON malformed.
- `backend/src/app.ts` — imported `listChildTasks`. Added `GET /tasks/:id/children` endpoint.
- `frontend/src/useGameState.ts` — added `parentTaskId: string | null` and `prUrl: string | null` to `GameTask` interface.
- `frontend/src/App.tsx` — added `'split': '#9c27b0'` to `STATUS_COLOR`. Updated `TaskRow` to show purple `EPIC` badge for split tasks and `↳` prefix for child tasks. Updated `TaskDetailPanel`: fetches children for epic tasks (via `/tasks/:id/children`), fetches parent task info for child tasks (via `/tasks/:parentId`). Shows subtask list with clickable rows. Shows "Part of epic" link for children. Added `onSelectTask` prop to navigate between parent/child.

### Key decisions
- Planner decides complexity: the model decides whether to split based on task scope — no heuristic needed.
- Children start at `queued:prioritize`: full pipeline runs (prioritizer sets score, planner creates implementation plan from the split description, implementer does the work). Clean, no special-casing.
- Parent status `split`, stage `done`: scheduler ignores it, it shows in "active" task list with EPIC badge.
- Bracket-matching JSON parser (not regex) for `SPLIT_EPIC:` value — handles nested objects in descriptions.
- Cascade delete: deleting an epic deletes all children.
- Worktrees created immediately for children (same as normal task creation).

---

## Phases 5 & 6 — UI Panels + Backend Enrichment [DONE]

**Goal:** Task/agent detail panels, respond-to-question UI, PR wall, priority extraction, PR URL capture, personality display, project management, delete/restart tasks.

### What changed (summary)
- Phase 5: `TaskDetailPanel` (respond, approve, retry, delete, restart), `AgentDetailPanel` (fire, traits, level title, transcript toggle), `TranscriptView`, `PrWallTab`, `SettingsTab` with project add/delete + zoom sensitivity slider, canvas zoom overlay.
- Phase 6: `setTaskPriority` via `PRIORITY: N` extraction in prioritize stage, `setTaskPrUrl` via GitHub PR URL regex in merge stage, personality trait pills, zoom sensitivity stored in state + passed as prop, `restartTask` clears agent station.
- `backend/src/server.ts` — `autoStartScheduler: true` so scheduler runs on boot.

### Key decisions
- `restartTask` resets `stage='queued:prioritize', status='queued', reviewLoopCount=0, pendingQuestion=NULL, error=NULL` and clears agent `currentTaskId`/`currentStation` to relaxation.
- Auto-start scheduler eliminates need for manual start on each `tsx watch` restart.

---

## Phase 4 — Office Canvas Frontend (Steps 14–19) [DONE]

**Goal:** Full UI rewrite — pixel-art office with station zones, animated character sprites, walk animation, real-time game state.

### What changed
- `backend/src/pipeline-runner.ts` — Added `freeAgent(agentId, taskId)` private helper (calls `assignAgentTask(null)` + `updateAgentStation("relaxation")` + broadcasts `agent:update`). Replaced inline free-agent code in `onStageSuccess` with `this.freeAgent(...)`.
- `backend/src/scheduler.ts` — `STATION_FOR_JOB` map assigns agents to station matching their jobType when they claim a task.
- `frontend/src/office-layout.ts` — NEW. Defines canvas geometry (900×540), 5 station zones (planning, desks, meeting, relaxation, pr-wall) with absolute slot positions, per-station animation type, `getAgentSlot(agentId, stationId, agentsAtStation)` for stable slot assignment.
- `frontend/src/useGameState.ts` — NEW. `useGameState()` hook: initial REST fetch of `/api/agents`, `/api/tasks`, `/api/profile`, `/api/projects`; WebSocket at `/ws/events` for real-time `agent:update`, `agent:xp`, `user:xp`, `status` events; auto-reconnect on disconnect.
- `frontend/src/OfficeCanvas.tsx` — Full rewrite. PixiJS v8 + @pixi/react v8 canvas: floor checkerboard, station zone backgrounds (colored + labeled), per-agent `AgentSprite` with `AnimatedSprite` (LimeZu characters), walk lerp toward slot positions, direction-aware run animation (up/down rows), badge overlays (💬 blocked, 🚩 awaiting_approval, ⚠ stuck).
- `frontend/src/App.tsx` — Full rewrite. Layout: top HUD (title + user XP bar + stats), canvas section, right panel with Agents/Tasks/Settings tabs. Agent panel: hire form + agent list + agent detail (XP bar, current task). Tasks panel: new task form + active/done task lists. Settings panel: scheduler start/stop, manual cron triggers.
- `frontend/src/App.css` — Full rewrite. Responsive shell layout, HUD styles, XP bar, tab bar, agent/task row components, utility classes.

### Key decisions
- Walk animation: agent `visualPos` lerps toward `targetPos` per tick (4px/frame); `run` animation shown while distance > 2px
- Sprite sheet: 16×16px frames, 3× scale (48px). Row 0 = facing south, row 1 = facing north.
- Slot assignment: agents sorted by id for stability within each station → `slots[idx % slots.length]`
- `pixiAnimatedSprite` ref callback calls `.play()` on mount; `useEffect` re-calls `.play()` when animation key changes (Pixi's textures setter stops the animation)
- Agents with no `currentStation` are rendered in the relaxation zone

### Still TODO (Phase 5 — UI Panels)
- Agent detail side panel with transcript view
- Task detail panel (transcript, respond-to-question UI)
- Squad management panel
- Awaiting-approval confirmation UI
- Stuck task retry UI
- Agent fire/hire UI polish
- PR Wall display (merged PRs feed)

---

## Phase 3 — Git Workflow (Steps 10–13) [DONE]

**Goal:** Worktrees per task, GitHub PR comment polling, issue ingestion.

### What changed
- `backend/src/app.ts` — `POST /tasks` now calls `createWorktree(project, task.id, task.title)` immediately after task creation, stores `worktreePath` + `branch` via `setTaskWorktree`. Fails silently if not a git repo (safe for tests). Added `POST /cron/poll-prs` and `POST /cron/ingest-issues` manual trigger endpoints. `CronService` wired into `buildApp`; `autoStartCron` option (default false). `onClose` hook stops cron.
- `backend/src/cron-service.ts` — NEW. `pollPrComments(db, broadcast, execFn)`: lists open agent PRs via `gh pr list --search head:agent/`, matches to tasks by branch, creates Implementer tasks for unseen human comments (skips `github-actions[bot]`), tracks `pr_comment_seen:{prNumber}` in settings table. `ingestGithubIssues(db, execFn)`: lists open issues via `gh issue list`, maps `priority:*` labels to 1-5 scale, skips already-imported (by `githubIssueNumber`). `CronService` class wraps both with configurable `setInterval`.

### Key decisions
- Worktree creation is best-effort: silently skipped on failure (allows test repos without `origin`)
- PR comment dedup: stores max seen comment ID per PR in `settings` table (`pr_comment_seen:{prNumber}`)
- Issue dedup: `githubIssueNumber` column on tasks table
- Priority label mapping: `priority:critical`=5, `priority:high`=4, `priority:low`=2, `priority:trivial`=1, default=3
- Cron defaults off (`autoStartCron: false`) so tests don't auto-start it

### Still TODO (Phase 4 — Office Canvas)
- Station layout with LimeZu tiles (Step 14)
- Agent sprites at stations (Step 15)
- Walk animation (Step 16)
- Agent state badges (Step 17)
- Meeting room (Step 18)
- Office level gates (Step 19)

---

## Phase 2 — Pipeline Execution (Steps 5–9) [DONE]

**Goal:** Idle agents automatically pick tasks, run Claude SDK per stage with personality, advance stages, award XP.

### What changed
- `backend/src/xp-service.ts` — NEW. `awardStageXp(db, agentId, stage, priority, broadcast)` computes base XP per stage × priority multiplier, calls `addAgentXp`, broadcasts `agent:xp`. `awardUserXp(db, amount, broadcast)` updates `user_profile`, broadcasts `user:xp`. Level thresholds: `[0, 100, 250, 500, 1000, 2000, 5000, 10000]`.
- `backend/src/stage-prompts.ts` — NEW. `buildStagePrompt(task, project, agent)` returns stage-specific prompt + appended personality traits. `detectReviewOutcome(resultText)` returns `"approve" | "request_changes" | "unknown"` by scanning for `APPROVE`/`REQUEST_CHANGES` keywords.
- `backend/src/pipeline-runner.ts` — NEW. `PipelineRunner` class. `runStage(task, project, agent)`: creates `task_stages` record, streams SDK call with `agent.model` + stage prompt + personality, handles AskUser blocking, on success calls `onStageSuccess` (stage advance, XP award), on reviewer `REQUEST_CHANGES` calls `loopTaskToImplement`, awards `task:gate` event on human-review gate, frees agent (`currentTaskId = null`) on completion.
- `backend/src/scheduler.ts` — NEW. `AgentScheduler` class. `tick()`: for each idle agent (no `currentTaskId`, not fired), find highest-priority queued task for matching stage + squad scope, claim task (`status="running"`, `agent.currentTaskId=taskId`), fire-and-forget `runStage`. Guards against concurrent ticks.
- `backend/src/app.ts` — UPDATED. Imports `PipelineRunner`, `AgentScheduler`. Creates scheduler in `buildApp`. New endpoints: `POST /scheduler/start|stop|tick`. `autoStartScheduler` option (default false). `onClose` hook stops scheduler.

### Key decisions
- Scheduler fires-and-forgets `runStage` (task is claimed so no double-dispatch)
- `onStageSuccess` re-fetches task from DB to avoid stale `requiresHumanReview` state
- Reviewer REQUEST_CHANGES → `loopTaskToImplement`; APPROVE (or unknown) → `advanceTaskStage`
- Scheduler defaults off (`autoStartScheduler: false`) so tests don't auto-start it

### Still TODO (Phase 3)
- Worktree-per-task with pipeline branch naming (Step 10)
- Auto-merge with conditions (Step 11)
- GitHub PR comment poller cron (Step 12)
- GitHub issue ingestion cron (Step 13)

---

## Phase 1 — Foundation (Steps 1–4) [DONE]

**Goal:** New DB schema + agent/squad/task pipeline APIs. No execution yet — agents queue tasks but don't run them until Phase 2.

### What changed
- `backend/src/db.ts` — complete rewrite. Versioned migration (v1 → v2). New tables: `user_profile`, `agents`, `squads`, `squad_agents`, `task_stages`. Altered: `tasks` (pipeline stages, priority, requiresHumanReview), `projects` (githubUrl, autoMerge). Dropped: old `tasks` columns (mode, deskIndex, pendingQuestion, sessionId, branchName, worktreeRemoved, error, prError).
- `backend/src/tasks.ts` — rewritten for pipeline stage model. Stages: queued:prioritize → queued:plan → queued:implement → queued:review → queued:merge → done. Removed old kanban flow (draft/start/close).
- `backend/src/agents.ts` — new file. Agent CRUD (hire/fire/list) + procedural personality generation (name, traits, avatar, rest time, behavioral modifiers).
- `backend/src/squads.ts` — new file. Squad CRUD + agent/project assignment.
- `backend/src/projects.ts` — added `githubUrl`, `autoMerge` fields.
- `backend/src/app.ts` — rewritten. New routes: `/agents`, `/squads`, `/tasks` (pipeline model). Removed old kanban routes (`/tasks/:id/start`, `/tasks/:id/close`). Runner dispatch removed (comes in Phase 2).
- `backend/src/ws-events.ts` — extended with agent/user XP and level-up event types.
- Deleted: `backend/src/desks.ts`, `backend/src/desks.test.ts`, `backend/src/task-manager.ts`, `backend/src/task-manager.test.ts`

### Key decisions
- Schema versioning via `settings` table (`schemaVersion` key)
- Agents are persistent entities with procedurally generated personalities (20-trait pool, adjective+noun names, Adam/Alex/Amelia/Bob avatars)
- Task pipeline: 5 stages, each assigned to a specific agent job type + Claude model
- `requiresHumanReview` flag pauses task at each stage transition for human approval
- Review loop max = 3 cycles before task → `stuck`
- Squads scope agents to specific project subsets

### Still TODO (Phase 2)
- Agent scheduler (idle agent → pick task → dispatch to runner)
- Stage-aware agent runner (Claude SDK call with personality prompt + model per stage)
- XP service (award on stage completion)

---

## Prior work (before this rewrite)

The repo previously had a working implementation of Steps 1–12 from the 2026-06-13 plan (single-agent kanban flow, PixiJS canvas, worktrees, PR service, PTY terminal). That implementation was scrapped in favor of the Sims-like pipeline architecture described above.

Preserved from old codebase:
- `backend/src/worktrees.ts` — git worktree management (unchanged)
- `backend/src/pr-service.ts` — PR creation via `gh` CLI (unchanged, will be updated in Phase 3)
- `backend/src/pty-runner.ts` — PTY session management (unchanged)
- `backend/src/transcripts.ts` — transcript entry storage (minor update)
- `frontend/` — will be fully rewritten in Phase 4
- `assets/` — LimeZu Modern Interiors + character sprites (reused in Phase 4)
