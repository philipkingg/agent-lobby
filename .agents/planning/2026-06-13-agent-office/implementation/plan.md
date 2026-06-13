# Implementation Plan — Agent Office

## Checklist
- [x] Step 1: Project scaffold (backend + frontend, health check)
- [x] Step 2: Project Registry (SQLite + add/list local projects)
- [x] Step 3: Worktree Manager + Task creation
- [x] Step 4: SDK Agent Runner + transcript + live updates
- [x] Step 5: AskUser / blocked-question flow
- [x] Step 6: PTY Manager + attach/detach terminal
- [x] Step 7: Office Canvas (PixiJS sprites + states)
- [x] Step 8: PR Service + completion flow
- [x] Step 9: Concurrency limit + queueing
- [x] Step 10: Persistence & resume on restart
- [x] Step 11: Worktree cleanup UI + git URL project registration
- [x] Step 12: Art assets + polish

---

### Step 1: Project scaffold
**Objective:** Stand up a Fastify (TS) backend and a React+Vite frontend in a monorepo, with a basic health check round trip.

- Backend: `GET /health` returns `{ status: "ok" }`.
- Frontend: minimal page that fetches `/health` on load and displays the result.
- Test requirement: backend unit test for `/health` (e.g. using Fastify's `inject`).
- Integration: frontend dev server proxies API calls to backend.
- **Demo:** Run both servers; load the frontend page and see "Backend status: ok" — proves the full stack wiring works.

### Step 2: Project Registry
**Objective:** Persist and manage registered projects (local path only for now).

- SQLite schema for `projects` table (per data model in design doc).
- `POST /projects` (local path only — validate it's a git repo, derive `name`, `defaultBranch`, `worktreesRoot`), `GET /projects`.
- Frontend: "Add Project" form (path input) + project list view.
- Test requirement: unit tests for project validation (rejects non-git path) and DB CRUD; integration test for `POST`/`GET /projects`.
- Integrates with Step 1's server/DB setup.
- **Demo:** Add a local repo path via the UI, see it appear in the project list, persisted across page reload.

### Step 3: Worktree Manager + Task creation
**Objective:** Creating a task spins up an isolated git worktree + branch for it.

- Worktree Manager module: `createWorktree(project, taskId)` / `removeWorktree(project, taskId)` wrapping `git worktree add/remove`.
- `tasks` table; `POST /projects/:id/tasks` creates a `Task` row (`status: "queued"`), immediately transitions to `running` by calling Worktree Manager (agent execution comes in Step 4 — for now task just sits at `running` with worktree created).
- `GET /tasks`, `GET /tasks/:id`.
- Frontend: "New Task" form (project + description + mode); basic task list showing status and worktree path.
- Test requirement: Worktree Manager unit tests mocking `child_process` (success, collision, dirty-tree error paths); integration test that `POST /tasks` creates a worktree directory and DB row.
- Integrates with Step 2's project registry.
- **Demo:** Create a task from the UI; verify a new worktree directory and branch exist on disk for the target repo, and the task shows up in the task list with status `running`.

### Step 4: SDK Agent Runner + transcript + live updates
**Objective:** Tasks actually run via the Claude Agent SDK, with live status/transcript streamed to the browser.

- Agent Runner: on task `running`, call `query()` with `cwd: worktreePath`, `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`.
- `transcript_entries` table; persist each `SDKMessage` (assistant/tool_progress/result).
- WebSocket gateway: clients subscribe to `task:<id>`, receive transcript entries + status changes in real time.
- On `result` (success/error), update `Task.status` to `done`/`error`, store `sessionId`.
- Frontend: Side Panel component — clicking a task opens a log view rendering the live transcript via WS.
- Test requirement: Agent Runner integration test using a mocked `query()` async generator (assistant + tool_progress + result messages) verifying transcript persistence, status transitions, and WS broadcast payloads.
- Integrates with Step 3 (runs in the created worktree).
- **Demo:** Create a real task with a simple description (e.g. "create a file named hello.txt with 'hi'"); watch the live transcript stream in the side panel, see status flip to `done`, and confirm the file exists in the worktree.

### Step 5: AskUser / blocked-question flow
**Objective:** Agent can pause and ask the human a question; user can respond and the agent continues.

- Register a custom `AskUser(question: string)` tool with the SDK session.
- On `AskUser` invocation: set `Task.status = "blocked"`, store `pendingQuestion`, broadcast over WS.
- `POST /tasks/:id/respond` — delivers the user's reply back into the SDK's async-iterable prompt stream, flips status back to `running`.
- Frontend: Side Panel shows the pending question + a reply input when `status === "blocked"`.
- Test requirement: Agent Runner test extended with a mocked `AskUser` tool call mid-stream, verifying `blocked` state, then `respond` resumes the stream and reaches `done`.
- Integrates with Step 4's runner and transcript/WS plumbing.
- **Demo:** Create a task whose prompt instructs it to ask a clarifying question via `AskUser`; observe `blocked` status + question in the panel, type a reply, watch the task resume and complete.

### Step 6: PTY Manager + attach/detach terminal
**Objective:** Support `mode: "pty"` tasks — a real interactive `claude` session in a worktree, viewable/attachable via a terminal.

- PTY Manager: spawn `claude` via `node-pty` with `cwd: worktreePath`; multiplex stdout to subscribed WS clients; write browser input to stdin.
- `Task.mode = "pty"` path in Task creation (Step 3) routes here instead of the SDK runner.
- Detach (WS close) does not kill the process; `/tasks/:id/stop` does.
- Frontend: Side Panel renders `xterm.js` bound to the task's WS stream for `pty` tasks (vs the log view from Step 4 for `sdk` tasks).
- Test requirement: PTY Manager test using a simple shell command (echo loop) verifying multiplex to multiple subscribers, write-to-stdin, and that closing one WS doesn't kill the process; `/stop` does kill it.
- Integrates with Step 3 (worktree) and Step 4's WS gateway (shared subscription mechanism).
- **Demo:** Create a `pty` task, see a live terminal in the side panel, type a command, close and reopen the panel (process persists), then stop it via UI.

### Step 7: Office Canvas (PixiJS sprites + states)
**Objective:** Visualize all tasks as sprites at desks on a shared office floor, reflecting live state.

- JSON desk-layout config (grid of desk positions on a static background image).
- `@pixi/react` canvas component: one sprite per active task, positioned at its assigned desk (first-available slot), texture/animation chosen by derived `AgentState` (`idle | working | blocked | error | done`).
- Badge overlay sprite for `blocked`/`error`.
- Office state derived from `tasks` table + WS status updates (Step 4/5/6).
- Clicking a desk opens the Side Panel for that task (from Steps 4-6).
- Test requirement: unit test for the pure `Task.status → AgentState → texture/badge` mapping function across all states; desk-assignment allocation/free logic test.
- Integrates with all prior steps' status data.
- **Demo:** With 2-3 tasks running (mix of sdk/pty, one triggering `AskUser`), see distinct desks with sprites showing working/blocked-with-badge states; click a desk to open its panel.

### Step 8: PR Service + completion flow
**Objective:** On task success, push the branch and open a PR; reflect "done" visually and in a Completed list.

- PR Service: `git push -u origin agent/<taskId>` then `gh pr create --base <defaultBranch> --head agent/<taskId> ...`; store `prUrl` on the Task.
- Triggered automatically when Agent Runner/PTY reaches `done`.
- Frontend: `done` tasks get the "slacking off" idle animation on their sprite (Step 7) and appear in a "Completed" list showing description + PR link.
- Test requirement: PR Service unit tests mocking `git`/`gh` invocations (success and failure — e.g. `gh` not authenticated, surfaced as a retryable error on the Task).
- Integrates with Step 4/6 completion events and Step 7's canvas.
- **Demo:** Run a task to completion; see its sprite switch to the slacking-off animation, and find it in the Completed list with a working PR link (or a retry button if `gh` fails).

### Step 9: Concurrency limit + queueing
**Objective:** Cap concurrent running agents (configurable, default 4, max 10); extra tasks queue and auto-start as slots free.

- Config value `maxConcurrentAgents` (default 4, validated 1-10) — simple settings endpoint/UI.
- Task Manager: tasks beyond the limit stay `queued`; on any task reaching `done`/`error`/`stopped`, start the next `queued` task (worktree creation + runner dispatch from Steps 3/4/6).
- Frontend: queued tasks shown distinctly (e.g. greyed desk or "waiting" list) and settings UI to adjust the limit.
- Test requirement: Task Manager unit test simulating N task creations > limit, verifying only `limit` run concurrently and queued ones start on completion of running ones.
- Integrates with Steps 3-8 (wraps the dispatch logic already built).
- **Demo:** Set limit to 2, create 4 tasks; see 2 running + 2 queued, and watch a queued one start automatically when a running one completes.

### Step 10: Persistence & resume on restart
**Objective:** Server restart resumes in-progress SDK tasks via session id; failures are surfaced clearly.

- On startup, Task Manager scans `tasks` for `status IN (running, blocked)`, and for `mode: "sdk"` calls `query()` with `options.resume: sessionId`; for `mode: "pty"`, mark as `failed` (PTY processes can't be resumed) with a clear "needs-attention" status.
- On SDK resume failure, set `status: "failed"` with error detail.
- Frontend: `failed` tasks shown with worktree path and a "start fresh task in this worktree" action.
- Test requirement: integration test that creates a task, persists state, re-instantiates the Task Manager against the same DB (simulating restart), and verifies `resume` is called with the stored `sessionId`; separate test for the resume-failure path setting `failed`.
- Integrates with Step 4's SDK runner and Step 9's dispatch queue (resumed tasks count toward the concurrency limit).
- **Demo:** Start a long-running task, restart the backend process, confirm the task resumes (transcript continues) or shows `failed` with a clear message if resume isn't possible.

### Step 11: Worktree cleanup UI + git URL project registration
**Objective:** Round out project registration (clone via URL) and manual worktree cleanup.

- `POST /projects` supports `source: "url"` — clones the repo into a managed directory before registering.
- `DELETE /tasks/:id/worktree` — removes the worktree via Worktree Manager (only allowed for `done`/`error`/`stopped`/`failed` tasks); UI exposes disk path + a "remove worktree" button on Completed/Failed tasks.
- Test requirement: unit test for URL clone path (mock `git clone`) and for the cleanup endpoint's status guard (rejects removal of `running`/`blocked` tasks).
- Integrates with Step 2 (registry) and Step 3 (worktree manager).
- **Demo:** Register a project by pasting a GitHub URL (clones locally), run a task to completion, then remove its worktree via the UI and confirm the directory is gone.

### Step 12: Art assets + polish
**Objective:** Replace placeholder sprites/background with CC0 Kenney assets and finalize animations for all states.

- Integrate Kenney "Tiny Town" tiles for office floor/desks and "Mini Characters"/"Isometric Prototypes" for agent sprites; build `idle`, `working`, `blocked`, `error`, `done` (slacking-off) animation frame-sets per the Step 7 texture-mapping function.
- Visual polish pass: badge icons, project color-coding on desks (per Q4), loading/empty states for project & task lists.
- Test requirement: update Step 7's texture-mapping unit test fixtures to cover all final frame-sets (no missing-state fallback rendering).
- Integrates with Step 7's canvas (swaps placeholder textures for final assets — no structural changes).
- **Demo:** Full end-to-end walkthrough — add project, create multiple tasks (sdk + pty), see them animate through working → blocked (respond) → done with final art, PR opens, completed list populated, worktree cleanup works.
