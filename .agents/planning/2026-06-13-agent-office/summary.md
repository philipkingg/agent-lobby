# Summary — Agent Office

## Artifacts created
- `rough-idea.md` — original concept
- `idea-honing.md` — 13 Q&A rounds covering environment, agent control (SDK+PTY), visualization style, layout, states/notifications, stack, git worktree+PR flow, permissions, persistence/resume, project registration, art assets, question detection, concurrency, cleanup
- `research/`
  - `claude-agent-sdk.md` — query()/resume/session APIs, message types, permission modes, AskUser-tool approach for question detection
  - `pty-terminal.md` — node-pty + xterm.js attach pattern, multiplex/detach semantics
  - `pixijs-frontend.md` — @pixi/react setup, static-bg + JSON desk layout, sprite state mapping
  - `assets-and-worktrees.md` — Kenney CC0 packs (Tiny Town, Mini Characters), git worktree-per-task automation pattern
- `design/detailed-design.md` — full design: architecture diagram, components/interfaces, ERD data model, error handling, testing strategy, appendices (tech choices, alternatives, open items)
- `implementation/plan.md` — 12-step TDD implementation plan with checklist, each step demoable

## Overview
A local web app: register git projects, create free-text tasks, each task gets an isolated git worktree+branch and runs a Claude Agent SDK headless session (or attached `claude` PTY session) with full permissions. Agents are shown as animated pixel-art sprites at desks in a PixiJS office; clicking a desk opens a side-panel terminal/log. Agents call a custom `AskUser` tool to pause for human input (badge + notification). On success, agent pushes branch + opens PR via `gh`. SQLite persists everything; restarts resume in-progress SDK sessions.

## Next steps
1. Review `design/detailed-design.md` and `implementation/plan.md`.
2. Start with Step 1 (scaffold) — straightforward to begin implementation immediately.
3. Areas likely needing refinement as you build: exact Kenney asset frame availability (Step 12), worktree dependency-install latency (flagged as future optimization), and whether `AskUser` tool registration syntax matches the latest SDK version when implementing Step 5.

Ready to start implementation whenever you are.
