# Agent Office

Local web app for running multiple Claude Code agents in parallel across
your projects, visualized as a pixel-art office — each task gets a desk,
and clicking a desk opens its live transcript or terminal.

## Requirements

- Node.js 20+
- `git`
- [`gh`](https://cli.github.com/) CLI, authenticated (`gh auth login`) — used to open PRs
  when a task completes
- An Anthropic API key available to the Claude Agent SDK (e.g. `ANTHROPIC_API_KEY`
  env var, or however your `claude` CLI is already authenticated)

## Setup

```bash
npm install
```

This installs both `backend` and `frontend` workspaces.

## Running

In two terminals:

```bash
# Backend (Fastify API + WS, port 3001)
cd backend && npm run dev

# Frontend (Vite dev server, port 5173, proxies /api and /ws to the backend)
cd frontend && npm run dev
```

Open http://localhost:5173.

## Using it

### 1. Add a project

In "Projects", register a repo either by:
- **local path** — path to an existing git repo on disk, or
- **git URL** — clones it into `~/.agent-office/projects/<name>` first.

### 2. Create a task

Pick the project, describe the task, and choose a mode:
- **sdk** — runs the Claude Agent SDK headlessly in a fresh git worktree
  (branch `agent/<task-id>`). View its live transcript by clicking its desk.
  If it calls `AskUser`, the task goes "blocked" and you can answer from the
  side panel.
- **pty** — runs `claude` interactively in a real terminal (via the side
  panel) in its own worktree. Use the "Stop" button to end the session.

Each task appears as a desk in the office. Desk color = agent status
(idle/working/blocked/error/done), badge = needs-input or error, and the
colored stripe identifies the project.

### 3. Completion & PRs

When an sdk/pty task finishes successfully, Agent Office pushes its branch
and opens a PR via `gh pr create`. If that fails (e.g. `gh` not configured),
the error is shown under "Completed" with a "Retry PR" button.

### 4. Failed / restarted tasks

If the backend restarts mid-task: sdk tasks resume automatically using their
saved session id; pty tasks (which can't be resumed) move to "Failed" with
a "Start Fresh Task" button to retry from scratch.

### 5. Cleanup

Completed/failed tasks show their worktree path with a "Remove Worktree"
button (`git worktree remove`) once you're done with them.

### 6. Concurrency

"Max concurrent agents" (top of the page, default 4, range 1–10) caps how
many tasks run at once — extra tasks queue and start automatically as
others finish.

## Testing & building

```bash
cd backend && npm run build && npm test
cd frontend && npm run build && npm test
```

## License

MIT
