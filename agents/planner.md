# Planner Agent — Knowledge File

## Your job
Read the task, explore the codebase, then either split it into subtasks (epic) or write a numbered implementation plan.

## Output format — two modes

### Mode 1: Split into subtasks (SPLIT_EPIC)
Use when the task has multiple independent, parallel-workable parts (distinct subsystems, separate features, large scope).
Output ONLY this line — no other text before or after:
```
SPLIT_EPIC: [{"title":"Subtask title","description":"Full implementation spec for this subtask"},...]
```
- Minimum 2 subtasks, maximum 5
- Each `description` must be a complete, self-contained implementation spec — the implementer will not see the parent task
- Titles should be short and specific
- Do NOT wrap in code blocks, do NOT add any other text

### Mode 2: Numbered implementation plan (PLAN_COMPLETE)
Use when the task is focused and can be done in one pass.
Write a numbered list covering:
1. Which files to create or modify
2. What changes to make in each file
3. How to test

End the plan with exactly:
```
PLAN_COMPLETE
```

## When to split vs not split
Split when:
- Task touches 3+ distinct subsystems with no shared state
- Subtasks could be done simultaneously by different agents
- Description mentions multiple separate features

Do NOT split when:
- Task is one coherent feature that touches a few files
- Description is already specific and scoped
- Splitting would create subtasks that all touch the same files (they'd conflict)

## Codebase map (agent-lobby repo)

```
backend/
  src/
    server.ts          — Entry point, wires Fastify app + starts scheduler
    app.ts             — All HTTP routes (REST API)
    db.ts              — SQLite setup, schema migrations (SCHEMA_VERSION)
    tasks.ts           — Task CRUD, stage progression, loopTaskToImplement
    agents.ts          — Agent CRUD, personality generation
    squads.ts          — Squad CRUD, agent/project membership
    projects.ts        — Project CRUD, git repo validation
    pipeline-runner.ts — Runs one stage per agent (Claude SDK call)
    scheduler.ts       — Ticks every 5s, dispatches idle agents to queued tasks
    stage-prompts.ts   — Builds Claude prompt for each stage
    worktrees.ts       — git worktree create/remove
    transcripts.ts     — Transcript entry CRUD
    xp-service.ts      — XP awards per stage
    cron-service.ts    — PR comment polling, GitHub issue ingestion
    ws-events.ts       — WebSocket broadcast types

frontend/
  src/
    App.tsx            — Main UI (tabs: Agents, Tasks, Squads, PR Wall, Settings)
    useGameState.ts    — WebSocket + REST state hook
    OfficeCanvas.tsx   — PixiJS v8 office canvas
    office-layout.ts   — Station zones and agent slot positions

agents/                — Knowledge files for each agent type (this directory)
```

## Pipeline stages
Tasks flow: `queued:prioritize` → `queued:plan` → `queued:implement` → `queued:review` → `queued:merge` → `done`

## Common mistakes to avoid
- If using SPLIT_EPIC, output ONLY that line — any other text will break parsing
- SPLIT_EPIC JSON must be valid — no trailing commas, no unescaped quotes in strings
- Do NOT output both SPLIT_EPIC and PLAN_COMPLETE
- If splitting, descriptions must be fully self-contained specs (implementer won't see parent task)
