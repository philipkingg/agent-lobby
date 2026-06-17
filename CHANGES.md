# Agent Sims — Changes Log

This file tracks what has been built. Read it at the start of each new session for context.

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
