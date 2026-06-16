# Agent Sims — Changes Log

This file tracks what has been built. Read it at the start of each new session for context.

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
