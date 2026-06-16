# Implementation Plan — Agent Sims

## Checklist

**Phase 1 — Foundation**
- [ ] Step 1: DB schema migration (new tables: agents, squads, tasks with stages, user_profile)
- [ ] Step 2: Agent CRUD API (hire/fire/list with procedural personality generation)
- [ ] Step 3: Squad management API (create/list squads, assign agents + projects)
- [ ] Step 4: Task pipeline API (create task, stage state machine, approve/respond endpoints)

**Phase 2 — Pipeline Execution**
- [ ] Step 5: Stage-aware agent runner (model selection per job type, personality prompt injection)
- [ ] Step 6: Agent scheduler (idle agent → pick highest-priority task for stage + squad)
- [ ] Step 7: Stage handoff + human-review gate
- [ ] Step 8: Review loop guard (max 3 cycles → stuck)
- [ ] Step 9: XP service (agent XP + user XP, level-up events)

**Phase 3 — Git Workflow**
- [ ] Step 10: Worktree-per-task with pipeline branch naming
- [ ] Step 11: Auto-merge with conditions (CI + reviewer approved)
- [ ] Step 12: GitHub PR comment poller cron (new Implementer task on unresolved comment)
- [ ] Step 13: GitHub issue ingestion cron (open issues → queued tasks)

**Phase 4 — Office Canvas**
- [ ] Step 14: Station layout (LimeZu tiles — planning board, desks, meeting room, lounge, PR wall)
- [ ] Step 15: Agent sprites at stations (avatar assignment, idle animation per station)
- [ ] Step 16: Walk animation (agent lerps between stations before task starts)
- [ ] Step 17: Agent state badges (working / blocked / stuck / done overlays)
- [ ] Step 18: Meeting room (blocked agents route here, human-question UI)
- [ ] Step 19: Office level gates (desk slot count driven by user level)

**Phase 5 — UI Panels**
- [ ] Step 20: Agent roster panel (hire/fire flow, personality display, XP bar, level)
- [ ] Step 21: Task queue panel (create task form, pipeline column view)
- [ ] Step 22: Squad panel (create squad, assign agents + projects)
- [ ] Step 23: User HUD (level badge, XP progress bar, office capacity)
- [ ] Step 24: Side panel (transcript log for SDK tasks, xterm for PTY, question UI for blocked)

**Phase 6 — Polish + Maintenance**
- [ ] Step 25: Prioritizer agent (auto-scores queue, walks to Planning Board)
- [ ] Step 26: CHANGES.md auto-update on task completion
- [ ] Step 27: Settings panel (model per job type, cron intervals, auto-merge toggle per project)
- [ ] Step 28: PR Wall display (open PRs + CI status on canvas background)
- [ ] Step 29: Procedural personality cosmetics (agent name + trait card + rest behavior)
- [ ] Step 30: Agent leveling cosmetics (animation variants on level-up)

---

## Phase 1 — Foundation

### Step 1: DB schema migration
**Objective:** Replace existing SQLite schema with the new multi-table schema supporting agents, squads, pipeline tasks, and user profile.

- Drop old tables (`desks`, old `tasks` shape). Preserve `projects`, `worktrees`, `transcript_entries` with column additions.
- Create: `user_profile`, `agents`, `squads`, `squad_agents`, `task_stages`
- Alter `tasks`: add `stage`, `priority`, `requires_human_review`, `review_loop_count`, `source`, `github_issue_number`
- Seed `user_profile` row (level=1, xp=0)
- Migration script runs on server startup if schema version < target
- Tests: migration idempotency (run twice → no error), all new tables + columns present, old data in preserved tables intact
- **Demo:** `GET /health` returns `{ status: "ok", schemaVersion: 2 }`. SQLite browser shows new tables.

### Step 2: Agent CRUD API + procedural generation
**Objective:** Hire and fire persistent agents, with procedural personality generation.

- `POST /agents` body: `{ job_type }` → generate name (adjective + noun combo), pick avatar (Adam/Alex/Amelia/Bob), draw 3 traits from trait pool, compute `rest_seconds` from traits, set default model per job type
- Trait pool (min 20 traits with prompt snippets + modifiers + rest_delta): e.g. `cautious`, `swift`, `thorough`, `social`, `workaholic`, `relaxed`, `methodical`, `creative`
- `GET /agents` returns all non-fired agents with full personality
- `DELETE /agents/:id` — sets `fired_at`, moves `current_task_id` tasks to `stuck`
- Tests: trait generation never produces duplicates per agent, personality JSON validates against schema, fired agent excluded from GET, fire with active task sets task stuck
- **Demo:** POST to hire 3 agents of different job types, GET returns all with procedurally different names/traits/models. Fire one, confirm it disappears from GET and its task is stuck.

### Step 3: Squad management API
**Objective:** Group agents into squads scoped to specific projects.

- `POST /squads` body: `{ name, project_ids: [], agent_ids: [] }`
- `PUT /squads/:id` — update name/projects/agents
- `GET /squads` — list squads with agent + project details joined
- `POST /squads/:id/agents` / `DELETE /squads/:id/agents/:agentId` — add/remove agent from squad
- Agents not in any squad: pull from all projects (default behavior)
- Tests: agent in squad only matches tasks from squad's projects, agent in no squad matches any project, squad update reflects in scheduler filter
- **Demo:** Create 2 squads (frontend-team → frontend project, backend-team → api project). Show agents only pick tasks from their assigned project.

### Step 4: Task pipeline API
**Objective:** Create tasks and expose the stage state machine + human-review gate.

- `POST /tasks` body: `{ project_id, title, description, priority, requires_human_review }`
- Task starts at `stage: "queued:prioritize"`, `status: "queued"`
- `GET /tasks` with optional filters: `stage`, `status`, `project_id`
- `GET /tasks/:id` with full stage history from `task_stages`
- `POST /tasks/:id/approve` — advance past human-review pause to next stage (only valid when `status: "awaiting_approval"`)
- `POST /tasks/:id/respond` — deliver answer to blocked agent AskUser question
- `POST /tasks/:id/retry` — reset `stuck` task back to its last stage
- Tests: state machine rejects invalid transitions, approve only works at gate, respond only works when blocked, priority ordering (5 tasks created, GET returns in priority desc order)
- **Demo:** Create 3 tasks with different priorities. GET shows them ordered. Create one with `requires_human_review`, watch it reach `awaiting_approval` between stages, approve it to advance.

---

## Phase 2 — Pipeline Execution

### Step 5: Stage-aware agent runner
**Objective:** Each pipeline stage runs a Claude agent call with the right model + personality prompt.

- Refactor `agent-runner.ts`: `runStage(task, stage, agent)` function
- Build system prompt: base role prompt per stage + agent personality trait injections + stage-specific instructions (e.g. Planner: "Write a spec with subtasks", Reviewer: "Review the diff and list issues")
- Model selected from `agent.model` field (set at hire time, overridable in settings)
- Transcript entries stored to `task_stages` row, streamed over WS `task:<id>` channel
- On stage `done`: update `task_stages.status`, compute XP amount (base * priority), call XPService (Step 9)
- On stage `error`: task → `error`, agent freed
- Tests: mock Claude SDK generator for each stage type, verify correct model called, personality traits appear in captured prompt, transcript persisted, WS broadcast received
- **Demo:** Create a task, manually set it to `stage: "queued:plan"`, assign a Planner agent → watch live transcript in WS log, see plan output, stage transitions to `done`.

### Step 6: Agent scheduler
**Objective:** Idle agents automatically pick up the highest-priority task for their stage + squad.

- `AgentScheduler` tick (configurable interval, default 5s)
- For each agent where `current_task_id IS NULL` and `fired_at IS NULL`:
  - Find highest-priority task where `stage = "queued:{agent.job_type}"` and project in agent's squad scope
  - Claim task (set `task.status = "running"`, `agent.current_task_id = task.id`)
  - Dispatch to StationRouter (Step 16 for walk animation, stub for now: instant arrival)
  - On arrival: call `runStage`
- Concurrent cap: max active stages = user office level capacity
- Tests: 5 tasks queued, 2 idle implementers → both claim tasks (highest priority first), third task stays queued. Scheduler tick after one completes → third task claimed.
- **Demo:** Hire 2 Implementers, queue 3 implement-stage tasks with different priorities. Watch scheduler auto-dispatch agents, highest priority runs first, third starts when one finishes.

### Step 7: Stage handoff + human-review gate
**Objective:** On stage completion, task auto-advances to next stage queue (or pauses for human approval).

- Stage sequence map: `prioritize → plan → implement → review → merge → done`
- On stage `done`: if `requires_human_review = 1` → set `task.status = "awaiting_approval"`, broadcast WS `task:gate` event; else → advance `task.stage` to next, set `status: "queued"`
- `POST /tasks/:id/approve` clears gate, advances stage
- WS event `task:gate` triggers notification badge on task card in frontend
- Tests: non-review-flagged task auto-advances through all stages end-to-end (with mocked runners). Review-flagged task stops at each gate, approve resumes it.
- **Demo:** Create review-flagged task with all stages mocked to instant-complete. Watch it pause at each transition, approve each one, see it reach `done`.

### Step 8: Review loop guard
**Objective:** Reviewer requesting changes loops task back to Implement; max 3 loops before `stuck`.

- Reviewer agent output parsed for a structured "REQUEST_CHANGES" signal (a line matching `/^REQUEST_CHANGES:/` or a tool call)
- On REQUEST_CHANGES: increment `task.review_loop_count`, if count ≥ 3 → `status: "stuck"`, else → re-queue at `stage: "queued:implement"`
- WS event on stuck: badge on agent sprite + task card
- `POST /tasks/:id/retry` resets loop count and re-queues
- Tests: mock reviewer emitting REQUEST_CHANGES 3×, verify stuck on 4th; mock reviewer emitting APPROVE, verify advance to merge; retry from stuck re-queues correctly
- **Demo:** Task with a Reviewer mocked to always request changes → watch it cycle Implement→Review 3 times then hit `stuck` with badge.

### Step 9: XP service
**Objective:** Award XP to agents and user on stage/pipeline completion; handle level-ups.

- `XPService.awardAgentXP(agentId, taskId, stage)`: base XP per stage (prioritize=5, plan=20, implement=50, review=30, merge=15) * priority multiplier
- Level thresholds: 100xp → L2, 250 → L3, 500 → L4, 1000 → L5 (tune later)
- On level-up: emit WS `agent:levelup` event with new level + unlocked modifier
- `XPService.awardUserXP(taskId)`: called when task reaches `done`, base=100 * priority
- User level-up: emit WS `user:levelup`, check office capacity unlock
- Tests: XP accumulates correctly across stages, level thresholds trigger exactly once, user XP only awarded on full pipeline completion (not per stage)
- **Demo:** Complete a full pipeline (all stages mocked). Inspect DB: agent has XP on all 5 rows of task_stages, user_profile XP updated. Force level threshold → levelup event fires.

---

## Phase 3 — Git Workflow

### Step 10: Worktree-per-task with pipeline branch naming
**Objective:** Each task gets a dedicated git worktree + branch created at task creation time, reused across all pipeline stages.

- On `POST /tasks`: call `WorktreeManager.createWorktree(project, taskId)` → branch `agent/<taskId>`, path `{worktrees_root}/{taskId}`
- All stage executions use `cwd: worktreePath`
- Worktree path + branch stored on `tasks.worktree_path`, `tasks.branch`
- `WorktreeManager` unchanged from existing codebase
- Tests: worktree directory exists after task creation, branch name matches pattern, all stage runner calls receive correct cwd
- **Demo:** Create task, verify `{worktrees_root}/{taskId}` directory and `agent/{taskId}` branch exist on disk before any agent runs.

### Step 11: Auto-merge with conditions
**Objective:** Merger agent merges to default branch when CI passes and Reviewer approved — no human click needed.

- `PRService.autoMerge(task)`: check `gh pr view --json statusCheckRollup,reviewDecision` — proceed only if `statusCheckRollup` = SUCCESS and `reviewDecision` = APPROVED (internal Reviewer stage completion sets a PR label `agent-reviewed`)
- If CI pending: re-queue merge attempt after 10min (configurable)
- If CI failed: task → `error` with detail, agent freed
- If repo has `auto_merge = 0`: skip merge, leave PR open, task → `done`
- `gh pr merge --squash --delete-branch` on success
- Tests: mock `gh` calls — CI pass + reviewed → merge called; CI pending → retry scheduled; CI fail → error; auto_merge=0 → merge not called
- **Demo:** Run task to Merger stage with a real or mocked PR. Verify `gh pr merge` is called (or skipped for no-auto-merge repo).

### Step 12: GitHub PR comment poller
**Objective:** Server cron detects new human comments on open agent PRs; creates Implementer task to address them.

- `node-cron` job (default every 5min, configurable)
- `gh pr list --search "author:app/github-actions" --json number,url,headRefName` to find agent PRs
- For each open agent PR: `gh pr view {number} --json comments` — check for comments not by the agent (human comments), compare against stored `last_seen_comment_id` in DB
- New human comment found → create new task `{ stage: "queued:implement", description: "Address PR review comment: {comment_body}", worktree_path: existing }` (reuses same worktree)
- Tests: cron detects new comment, creates task with correct description and worktree path; no duplicate tasks for already-seen comments
- **Demo:** Manually post a comment on an open agent PR, wait for cron tick (or trigger manually via `POST /cron/poll-prs`), see new Implementer task appear in queue.

### Step 13: GitHub issue ingestion cron
**Objective:** Server cron imports open GitHub issues as queued tasks.

- `node-cron` job (default every 15min)
- For each project with `github_url` set: `gh issue list --repo {owner/repo} --state open --json number,title,body,labels,milestone`
- Filter: skip issues already imported (`github_issue_number` exists in tasks)
- Create task per issue: title from issue title, description from body, priority derived from labels (`priority:high`=5, `priority:low`=1, default=3)
- Manual trigger: `POST /cron/ingest-issues`
- Tests: issues imported with correct priority mapping, duplicate suppression, only projects with github_url processed
- **Demo:** Trigger `POST /cron/ingest-issues` for a repo with open issues. Verify tasks appear in queue with correct priority and `source: "github_issue"`.

---

## Phase 4 — Office Canvas

### Step 14: Station layout with LimeZu tiles
**Objective:** Render the pixel-art office with all stations using existing LimeZu Modern Interiors assets.

- PixiJS canvas with LimeZu `Room_Builder_free_16x16.png` as tilemap for walls/floors
- `Interiors_free_16x16.png` for furniture: desk, planning board, couch/lounge, meeting table
- Define station zones: bounding rectangles for Planning Board, Work Desks (N slots based on office level), Meeting Room, Relaxation Area
- PR Wall: right edge of canvas, static display area (content added Step 28)
- JSON config `office-layout.json`: station zones, desk slot positions, walk paths
- Tests: all station zones non-overlapping, desk slot count matches user level, sprites render without texture errors
- **Demo:** Launch app — see pixel-art office with distinct areas labeled. No agents yet, just the environment.

### Step 15: Agent sprites at stations
**Objective:** Each hired agent appears in the office at their current station with correct idle animation.

- PixiJS `AnimatedSprite` per agent, texture from `{avatar}_idle_anim_16x16.png`
- Agent placed at station position from `office-layout.json`
- WS `agent:update` events → update sprite position + animation
- Idle at lounge: `{avatar}_sit_16x16.png` or `{avatar}_idle_anim_16x16.png`
- Working at desk/board: `{avatar}_sit2_16x16.png` (seated working pose)
- Tests: sprite renders for each avatar type, station position maps to correct pixel coordinate, WS update changes sprite position
- **Demo:** Hire Adam (Implementer) and Alex (Planner). Both appear in office at Relaxation Area. Working agent moves to desk.

### Step 16: Walk animation between stations
**Objective:** Agent sprite walks from current station to target station before task execution begins.

- `StationRouter.walkTo(agentId, targetStation)`: compute path (direct line for now, no pathfinding complexity), emit WS position ticks over walk duration (walk speed: ~32px/s)
- WS `agent:walk` event stream with `{ agentId, x, y, direction }` — frontend lerps sprite position
- Walking uses `{avatar}_run_16x16.png` animation frames
- Task execution begins only after `agent:arrived` WS event
- Walk duration gated by personality: `swift` agents walk faster
- Tests: walk completes before runner dispatched (mock runner, verify no call until arrived), walk positions interpolate between station centers, direction flips sprite horizontally for right/left movement
- **Demo:** Queue a task for an idle Planner at lounge. Watch sprite walk to Planning Board, then "start working" (sitting animation) only after arrival.

### Step 17: Agent state badges
**Objective:** Visual overlays on sprites for blocked / stuck / done states.

- Small badge sprite overlaid on agent sprite (top-right corner)
- States → badges:
  - `blocked` (awaiting AskUser): thought-bubble or `?` badge
  - `stuck` (review loop max): `!` badge, red tint
  - `awaiting_approval` (human-review gate): hand/flag badge
  - `done` (task pipeline complete): checkmark badge, then agent walks to lounge
- WS `agent:state` events trigger badge show/hide
- Tests: each status emits correct badge type, badge clears on state change to running
- **Demo:** Force a task to `blocked` → see badge appear on agent sprite. Respond to question → badge clears, working animation resumes.

### Step 18: Meeting room for blocked agents
**Objective:** Blocked agents walk to Meeting Room and wait there for human input.

- On `task.status → "blocked"`: StationRouter routes agent to Meeting Room
- Agent plays `{avatar}_sit3_16x16.png` or phone animation in Meeting Room
- Clicking agent in Meeting Room → opens SidePanel with question + reply input (Step 24)
- Multiple agents can be in Meeting Room simultaneously (seats at meeting table)
- On question answered: agent walks back to work station, resumes task
- Tests: blocked agent ends up at Meeting Room coordinates, multiple blocked agents stack seats, answer → walk back to desk
- **Demo:** Two agents block simultaneously (mock AskUser). Both walk to Meeting Room. Answer one → it walks back. Other stays.

### Step 19: Office level gates on desk slots
**Objective:** Available desk slots in the canvas reflect user office level.

- `office-layout.json` defines desk slots per level tier (level 1: 2, level 3: 4, level 5: 6, level 8: 10)
- Canvas renders only unlocked desk slots (others shown as locked/grayed furniture)
- WS `user:levelup` → canvas adds newly unlocked desk slots with animation (new desk appears)
- Scheduler respects capacity: won't dispatch more agents than available desk slots
- Meeting Room unlocks at level 5 (before: blocked agents just stand in place)
- Tests: level 1 user can't have more than 2 tasks running concurrently, level-up event triggers slot unlock, locked slots rendered differently
- **Demo:** Start at level 1 (2 desks). Earn XP to level 3. Watch 2 new desk slots appear in canvas.

---

## Phase 5 — UI Panels

### Step 20: Agent roster panel
**Objective:** View, hire, and fire all agents with personality + progression display.

- Panel slides in from left or top-bar toggle
- Agent cards: avatar sprite preview, name, job type badge, level number, XP progress bar, current status (idle/working/blocked), personality traits as chips
- "Hire Agent" button → job type selector → system generates + displays candidate (name, traits, avatar) → confirm to hire
- "Fire" button with confirmation dialog
- Squad assignment dropdown per agent
- Tests: hire flow generates unique names, fire updates DB + removes from canvas, XP bar reflects correct percentage to next level
- **Demo:** Hire 4 agents of different types, view their trait cards, fire one. Confirm canvas updates.

### Step 21: Task queue panel
**Objective:** Create tasks and view the full pipeline with per-stage columns.

- Pipeline view: 6 columns (Prioritize / Plan / Implement / Review / Merge / Done)
- Task cards in each column: title, priority badge (1-5 colored), assigned agent avatar, `requires_human_review` lock icon, loop count badge for review cycles
- "New Task" button → form: project selector, title, description textarea, priority slider, human-review toggle
- Tasks draggable to re-prioritize within column (updates `priority` field)
- Click task card → SidePanel opens for that task
- Tests: tasks appear in correct column by stage, priority slider saves correctly, drag reorder updates DB
- **Demo:** Create 5 tasks across 2 projects. See them flow through pipeline columns as agents work.

### Step 22: Squad panel
**Objective:** Create and manage squads for project-scoped agent teams.

- Squad list with agent avatars + project chips per squad
- "Create Squad" button → name input + multi-select agents + multi-select projects
- Drag agents between squads (or unassigned pool)
- Visual indicator on agent cards in roster showing squad membership
- Tests: agents moved to squad only pick tasks from squad's projects, unassigned agents pick any
- **Demo:** Create "Frontend Squad" with 2 Implementers scoped to frontend project. Create "API Squad" with 1 Implementer scoped to backend project. Queue tasks for both projects — watch correct agents claim correct tasks.

### Step 23: User HUD
**Objective:** Persistent header bar showing user level, XP, and office capacity.

- Fixed top bar: level badge (e.g. "Office Manager Lv.3"), XP progress bar to next level, active agents / capacity (e.g. "4/6 agents working"), open tasks count
- Level-up: animated confetti burst + level badge increments
- Clicking level badge → office history (total PRs merged, tasks completed, XP earned lifetime)
- Tests: XP bar updates on `user:xp` WS event, capacity counter reflects running task count, level-up animation triggers exactly on threshold
- **Demo:** Complete a task pipeline → watch XP bar fill. Hit level threshold → confetti + level increments.

### Step 24: Side panel (transcript / terminal / question)
**Objective:** Click any agent or task to open a detail panel showing live output and controls.

- Panel slides in from right
- SDK task: scrollable transcript log with role-colored bubbles (assistant=blue, tool=gray, result=green)
- PTY task: xterm.js terminal bound to task WS stream
- Blocked task (`status: "blocked"`): question text displayed prominently + text input + Send button
- `awaiting_approval` task: stage summary + Approve / Reject buttons
- `stuck` task: review history + Retry button
- Minimizable, persists last-viewed task on re-open
- Tests: transcript entries render in correct order, blocked question input calls POST /tasks/:id/respond, approval calls POST /tasks/:id/approve
- **Demo:** Open panel for a running Implementer task — watch live transcript stream. Open a blocked agent — see question, type response, watch agent resume.

---

## Phase 6 — Polish + Maintenance

### Step 25: Prioritizer agent activation
**Objective:** Prioritizer agents sit at the Planning Board and periodically re-score the task queue.

- Prioritizer runs on scheduler tick: if no `queued:prioritize` tasks, Prioritizer wanders to Planning Board and runs a "scan queue" task
- Scan queue task: agent reads all `status=queued` tasks (titles + descriptions), outputs a priority re-scoring JSON, system updates `priority` fields
- Prioritizer XP: awarded per batch of tasks scored
- Visual: Prioritizer sprite at Planning Board with a "thinking" animation during scan
- Tests: priority scores updated in DB after Prioritizer run, XP awarded per batch, Prioritizer doesn't block other stages while scoring
- **Demo:** Queue 6 tasks with manual priority=3. Wait for Prioritizer → watch priorities update in task panel.

### Step 26: CHANGES.md auto-update
**Objective:** Maintain a human-readable CHANGES.md in the project root tracking what agents have done.

- On task pipeline `done`: append entry to `/CHANGES.md`:
  ```
  ## {date} — {task.title}
  - Project: {project.name}
  - Branch: {branch}
  - PR: {pr_url}
  - Agents: {planner.name} (plan) → {implementer.name} (impl) → {reviewer.name} (review) → {merger.name} (merge)
  - XP earned: {total_xp}
  ```
- `GET /changelog` returns last N entries
- Changelog panel in UI (accessible from user HUD)
- Tests: entry appended after done status, format matches template, multiple concurrent completions don't corrupt file (queue writes)
- **Demo:** Complete 3 pipelines. Open CHANGES.md — see 3 entries with correct agent attribution.

### Step 27: Settings panel
**Objective:** Configure models per job type, cron intervals, auto-merge toggle, and concurrency limits.

- Settings panel (gear icon): sections for Agents, Git, Crons, Office
- Agent settings: default model per job type (dropdown with Claude model IDs)
- Git settings: auto-merge toggle per project, CI wait interval
- Cron settings: PR poll interval, issue ingestion interval (enable/disable per project)
- Office settings: scheduler tick interval, max loops before stuck
- All settings persisted to `settings` table in SQLite
- Tests: settings changes reflected in next scheduler tick, model override applied to next agent runner call
- **Demo:** Change Implementer model from Sonnet to Opus, trigger a task → verify Opus is called in transcript.

### Step 28: PR Wall display
**Objective:** Show open agent PRs and CI status on the canvas PR Wall area.

- Right side of canvas: scrolling list of open PRs from all registered projects
- Each PR card: branch name, task title, CI status badge (pending/pass/fail), PR number
- Data from `gh pr list` polled on the same cron as PR comment poller
- Click PR card → opens GitHub PR URL in new tab
- CI fail → red badge on PR Wall card + matching task gets attention badge
- Tests: PR cards update on cron cycle, CI status mapped correctly to badge color
- **Demo:** Open agent PRs visible on PR Wall with live CI status. CI failure turns badge red.

### Step 29: Procedural personality cosmetics
**Objective:** Full personality display: trait names, behavioral modifier descriptions, rest behavior visualization.

- Each trait has: `name` (display), `prompt_injection` (hidden), `modifiers` (visible effects list), `rest_delta_seconds`
- Agent card in roster shows: trait chips with tooltips ("Cautious: +20% test coverage target, +10s rest")
- Hire candidate preview shows generated traits before confirm
- Rest timer visualization in canvas: small sand-timer or ZZZ animation over agent at lounge, depletes as rest_seconds counts down
- Tests: rest timer duration reflects personality rest_seconds, trait tooltip content matches trait definition
- **Demo:** Hire agent, view traits in roster. Watch hired agent at lounge with rest timer visible.

### Step 30: Agent leveling cosmetics
**Objective:** Visual rewards on agent level-up — new animation variants, level badge on sprite.

- Level badge overlaid on agent sprite (small number, styled per level tier)
- Level-up event: sprite flashes, star burst animation, level badge increments
- Level 3+ unlocks alternate animation frame (e.g. `{avatar}_phone_16x16.png` as "victory" idle)
- Level 5+ unlocks golden border on agent card in roster
- Agent profile card (click agent in roster): full stat history — tasks completed per stage, XP timeline, current modifiers active
- Tests: level badge renders at correct position, level-up animation fires exactly once, unlock conditions check correct level
- **Demo:** Force agent to level 3 via XP grant. Watch badge appear, alternate idle animation unlock.
