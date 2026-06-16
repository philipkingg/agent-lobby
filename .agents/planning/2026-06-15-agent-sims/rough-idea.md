# Rough Idea — Agent Sims

Game-like Sims experience for managing AI agents.

- Agents have personalities and jobs
- Task queue system — agents autonomously pick up and complete tasks
- Agents live in a cute pixel art office (use existing LimeZu Modern Interiors assets in repo)
- Office stations: planning board, work desks, relaxation area, other office things
- Agents can look at git repos, make their own branches, make their own PRs, maintain them, merge them
- Agents act autonomously — no need to assign tasks manually
- Maintain a plan/changes file to track what's happening
- Starting mostly fresh — reuse what fits from the existing codebase, scrap what doesn't

## Existing codebase (2026-06-15)
- Backend: Fastify + TypeScript, SQLite, worktree manager, task manager, agent runner (Claude SDK), PTY runner, PR service, WebSocket
- Frontend: React + Vite + PixiJS office canvas, side panel, kanban board
- Art assets: LimeZu Modern Interiors (16x16/32x32/48x48) + character sprites (Adam, Alex, Amelia, Bob — idle, run, sit, phone animations)
- Prior PDD plan: `.agents/planning/2026-06-13-agent-office/` (all 12 steps complete)
