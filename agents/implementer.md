# Implementer Agent — Knowledge File

## Your job
Implement the task in the assigned git worktree, commit your changes, then sync with the default branch.

## Working directory
- You work in a **git worktree**, not the main repo. The worktree is a sibling directory of the project repo (e.g., `../project-worktrees/<taskId>`).
- Your branch is already created and checked out. Do not create a new branch.
- The main repo and other worktrees share the same `.git` objects — do not modify `.git` directly.

## Workflow

### 1. Explore before coding
Read the relevant files before writing code. Use `find`, `cat`, or read key entry points to understand structure.

### 2. Implement in small commits
Commit as you go — don't save one giant commit for the end. Commit message style:
```
feat: add X to Y
fix: handle edge case in Z
```

### 3. Sync, push, and create PR (MANDATORY)
Before you consider yourself done, run in order:
```bash
git fetch origin <defaultBranch>
git merge origin/<defaultBranch>
# resolve any merge conflicts and commit them

git push -u origin <branch>

# Create the PR (safe to run even if PR already exists)
gh pr create --base <defaultBranch> --title "<task title>" --body "<task description>" 2>/dev/null || true

# Get the PR URL and output it
gh pr view --json url --jq .url
```
Output the PR URL on its own line: `PR_URL: <url>`

### 4. Run tests if they exist
For backend changes: `cd backend && npm test`
For frontend changes: `cd frontend && npm run build` (catches TypeScript errors)

## Codebase map (agent-lobby repo)

```
backend/src/
  app.ts             — All HTTP routes; add new endpoints here
  db.ts              — Schema migrations; bump SCHEMA_VERSION when adding columns
  tasks.ts           — Task CRUD + TaskStatus + TaskStage types
  agents.ts          — Agent types and CRUD
  pipeline-runner.ts — Stage execution; touch only if changing pipeline behavior
  stage-prompts.ts   — Prompt per stage; touch to change what agents are told
  scheduler.ts       — Agent dispatch loop (5s tick)

frontend/src/
  App.tsx            — All UI components and tabs
  useGameState.ts    — State management + WebSocket
  App.css            — All styles
```

## Backend conventions
- Node.js built-in SQLite (`DatabaseSync` from `node:sqlite`) — no external SQLite package
- ESM modules (`"type": "module"`) — use `.js` extensions in imports even for `.ts` files
- Fastify for HTTP — use `app.get/post/delete` to add routes
- When adding a DB column: add to `applyV2Schema`, the relevant migration, AND add a `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ADD COLUMN` at the end of `createDb` as a safety net
- WebSocket events: call `broadcast("global", {...})` for global events, `broadcast(\`task:${id}\`, {...})` for task events

## Frontend conventions
- React 18 + TypeScript + Vite
- PixiJS v8 + `@pixi/react` v8 for the canvas
- No external state library — state lives in `useGameState.ts` hook
- Add styles to `App.css`

## Things to NEVER do
- Never commit `.env` files or secrets
- Never modify `.git` directory directly
- Never `npm install` new packages without a clear need
- Never checkout a different branch — work on the assigned branch only
- Never force push (`git push --force`)

## Common mistakes to avoid
- Forgetting the `git merge origin/<defaultBranch>` sync step
- Using `require()` instead of `import` (project is ESM)
- Importing from `./file` instead of `./file.js` in backend TypeScript
- Modifying the main repo path instead of the worktree path
